import { activeOrSuccessful, allowedEvent, onPr, sameRun, stackKey } from './model.ts';
import type { Api, Config, Entry, Pull, Report, Run, Stack, Workflow } from './model.ts';
import { policy } from './policy.ts';

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
export async function cleanup(api: Api, config: Config, wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)), now = () => new Date()): Promise<Report> {
  const report: Report = {trigger: `${config.serverUrl}/${config.repository}/actions/runs/${config.cleanupRunId}`, policies: [], entries: [], notes: [], errors: []};
  try {
    if (config.event !== 'pull_request' || config.action !== 'stacked') {
      report.notes.push('Only pull_request.stacked initiates cleanup.'); return report;
    }
    if (config.triggerRepoId !== config.repositoryId) {
      report.notes.push('The triggering PR is not from this repository.'); return report;
    }
    const current = await api.run(config.cleanupRunId);
    const cutoff = Date.parse(current.created_at);
    if (!Number.isFinite(cutoff)) throw new Error('Cleanup run has no valid creation time.');
    const trigger = await api.pull(config.triggerPr);
    if (trigger.state !== 'open' || !trigger.stack || trigger.head.repo.id !== config.repositoryId) {
      report.notes.push('The triggering PR is not an open member of a same-repository stack.'); return report;
    }
    const stack = await api.stack(trigger.stack.number);
    report.stack = stack;
    const members = stack.pull_requests;
    if (members.length < 2 || members.length !== trigger.stack.size ||
        new Set(members.map(p => p.number)).size !== members.length ||
        !members.some(p => p.number === trigger.number) ||
        members.some(p => p.state !== 'open' || p.head.repo.id !== config.repositoryId)) {
      throw new Error('Stack members are inconsistent; no cancellation is safe.');
    }
    const top = members.at(-1)!;
    const topPull = await api.pull(top.number);
    if (topPull.stack?.number !== stack.number || topPull.stack.position !== members.length ||
        topPull.stack.size !== members.length || topPull.head.sha !== top.head.sha) {
      throw new Error('The current top PR disagrees with the stack response.');
    }
    for (const lower of members.slice(0, -1)) {
      if (!['ahead', 'identical'].includes(await api.compare(lower.head.sha, top.head.sha))) {
        report.notes.push('The top PR does not contain every current lower head. All lower runs are preserved.'); return report;
      }
    }
    if (config.policyRef && !/^[a-f0-9]{40}$/.test(config.policyRef)) throw new Error('policy-ref must be a full trusted commit SHA.');
    report.policySha = await api.resolve(config.policyRef || config.defaultBranch);
    if (!/^[a-f0-9]{40}$/.test(report.policySha)) throw new Error('Could not resolve policy to an immutable commit.');
    for (const workflow of await api.workflows()) {
      if (workflow.state !== 'active' || workflow.id === current.workflow_id) continue;
      if (!/^\.github\/workflows\/[^/]+\.ya?ml$/.test(workflow.path)) {
        report.policies.push({workflow, policy: 'no', detail: 'GitHub-managed or unsupported workflow path; excluded.'}); continue;
      }
      try {
        await inspectWorkflow(api, config, report, stack, top, workflow, cutoff, wait, now);
      } catch (error) {
        report.errors.push(`${workflow.name}: ${message(error)}`);
        // Changed stack state invalidates all later decisions.
        if (stackKey(await api.stack(stack.number)) !== stackKey(stack)) break;
      }
    }
  } catch (error) { report.errors.push(message(error)); }
  // Request all cancellations before checking asynchronous outcomes.
  for (const entry of report.entries.filter(e => e.outcome === 'accepted; pending')) {
    try {
      const final = await api.run(entry.run.id);
      entry.outcome = final.status === 'completed' ? `finished: ${final.conclusion}` : 'accepted; pending';
      entry.jobs = await api.jobs(entry.run.id, entry.run.run_attempt);
    } catch (error) { report.errors.push(`Could not confirm run ${entry.run.id}: ${message(error)}`); }
  }
  return report;
}

async function associated(api: Api, run: Run, pr: Pull, repo: number): Promise<boolean> {
  if (!onPr(run, pr, repo)) return false;
  if (run.pull_requests.length) return run.pull_requests.length === 1 && run.pull_requests[0].number === pr.number;
  return (await api.associated(run.head_sha)).some(p => p.number === pr.number && p.head.repo.id === repo);
}

async function inspectWorkflow(api: Api, config: Config, report: Report, stack: Stack, top: Pull, workflow: Workflow, cutoff: number, wait: (ms: number) => Promise<void>, now: () => Date): Promise<void> {
  const trustedSource = await api.source(workflow.path, report.policySha!);
  const declaration = policy(trustedSource);
  report.policies.push({workflow, policy: declaration.value, detail: declaration.detail});
  if (declaration.value !== 'yes') return;
  // Changes to workflow jobs can change whether top work replaces lower work.
  if (await api.source(workflow.path, top.head.sha) !== trustedSource) {
    report.notes.push(`${workflow.name}: top workflow differs from trusted policy revision; preserved.`); return;
  }
  let runs: Run[] = [];
  let replacement: Run | undefined;
  // Three scans, two seconds apart: bounded API visibility retry, not a scheduler.
  for (let scan = 0; scan < 3; scan++) {
    runs = await api.runs(workflow.id);
    for (const run of runs.filter(r => r.workflow_id === workflow.id && allowedEvent(r.event) &&
      r.head_sha === top.head.sha && activeOrSuccessful(r)).sort((a, b) => b.run_number - a.run_number)) {
      if (await associated(api, run, top, config.repositoryId)) { replacement = run; break; }
    }
    if (replacement) break;
    if (scan < 2) await wait(2000);
  }
  if (!replacement) { report.notes.push(`${workflow.name}: no suitable run for the current top commit after three scans; preserved. A later stacked event can retry.`); return; }
  const lower = stack.pull_requests.slice(0, -1);
  const seen = new Set<number>();
  for (const candidate of runs) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    if (candidate.workflow_id !== workflow.id || !allowedEvent(candidate.event) || candidate.status === 'completed' ||
        !Number.isFinite(Date.parse(candidate.created_at)) || Date.parse(candidate.created_at) >= cutoff) continue;
    const matching = lower.filter(pr => onPr(candidate, pr, config.repositoryId));
    if (matching.length !== 1 || !await associated(api, candidate, matching[0], config.repositoryId)) continue;
    const pr = matching[0];
    if (await api.source(workflow.path, candidate.head_sha) !== trustedSource) {
      report.notes.push(`${workflow.name}: lower run ${candidate.id} uses different workflow content; preserved.`); continue;
    }
    if (stackKey(await api.stack(stack.number)) !== stackKey(stack)) throw new Error('Stack changed; stopped further cancellation.');
    const freshTop = await api.run(replacement.id);
    if (!sameRun(replacement, freshTop) || !activeOrSuccessful(freshTop)) throw new Error('Replacement run changed or is no longer suitable.');
    const fresh = await api.run(candidate.id);
    if (!sameRun(candidate, fresh)) {
      report.notes.push(`${workflow.name}: run ${candidate.id} changed or was rerun; preserved.`); continue;
    }
    const entry: Entry = {workflow, lower: pr, run: fresh, replacement: freshTop,
      reason: 'Workflow opted in; current top contains all lower heads and has a matching run; this lower run predates cleanup.',
      outcome: 'not requested; validation interrupted', jobs: await api.jobs(fresh.id, fresh.run_attempt)};
    report.entries.push(entry);
    if (fresh.status === 'completed') { entry.outcome = `already finished: ${fresh.conclusion}`; continue; }
    if (config.dryRun) { entry.outcome = 'dry run; would request cancellation'; continue; }
    // Recheck after collecting jobs, before the write.
    if (stackKey(await api.stack(stack.number)) !== stackKey(stack)) throw new Error('Stack changed; stopped further cancellation.');
    const latest = await api.run(fresh.id);
    const latestTop = await api.run(freshTop.id);
    if (!sameRun(fresh, latest) || !sameRun(freshTop, latestTop) || !activeOrSuccessful(latestTop)) {
      entry.outcome = 'not requested; run or replacement changed'; continue;
    }
    if (latest.status === 'completed') { entry.outcome = `already finished: ${latest.conclusion}`; continue; }
    try {
      await api.cancel(fresh.id);
      entry.requestedAt = now().toISOString();
      entry.outcome = 'accepted; pending';
    } catch (error) {
      const result = await api.run(fresh.id);
      if (result.status === 'completed') entry.outcome = `already finished: ${result.conclusion}`;
      else { entry.outcome = 'request failed'; report.errors.push(`Run ${fresh.id}: ${message(error)}`); }
    }
  }
}
