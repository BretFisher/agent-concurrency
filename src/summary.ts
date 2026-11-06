import type { Config, Report } from './model.ts';
const esc = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]!));
const link = (url: string, text: string) => /^https?:\/\//.test(url) ? `<a href="${esc(url)}">${esc(text)}</a>` : esc(text);
export function summary(report: Report, config: Config): string {
  const root = `${config.serverUrl}/${config.repository}`;
  const rows = report.entries.map(entry => {
    const jobs = entry.jobs.map(job => `<li>${link(job.html_url, job.name)}: ${esc(job.conclusion || job.status)}</li>`).join('');
    return `<tr><td>${esc(entry.workflow.name)}</td><td>${link(`${root}/pull/${entry.lower.number}`, `PR ${entry.lower.number}`)}<br>${esc(entry.run.head_branch)}<br>${link(`${root}/commit/${entry.run.head_sha}`, entry.run.head_sha.slice(0, 12))}</td><td>${link(entry.run.html_url, `Run ${entry.run.id}, attempt ${entry.run.run_attempt}`)}</td><td>${link(entry.replacement.html_url, `Top run ${entry.replacement.id}`)}</td><td>${esc(entry.outcome)}<br>${esc(entry.requestedAt || 'No accepted request')}</td><td>${esc(entry.reason)}<details><summary>Observed job states</summary><ul>${jobs || '<li>No jobs recorded for this attempt.</li>'}</ul></details></td></tr>`;
  }).join('\n');
  const policyRows = report.policies.filter(p => p.policy !== 'missing' || config.warnMissing).map(({workflow, policy, detail}) =>
    `<tr><td>${link(`${root}/blob/${report.policySha}/${workflow.path}`, workflow.name)}</td><td>${esc(policy)}</td><td>${esc(detail)}</td></tr>`).join('\n');
  const missing = report.policies.filter(p => p.policy === 'missing').length;
  return `# Stack prune\n\n${link(report.trigger, 'Prune invocation')} · ${esc(config.event)}.${esc(config.action)} · ${esc(config.dryRun ? 'Dry run' : 'Cancellation enabled')} · Joining ${link(`${root}/pull/${config.triggerPr}`, `PR ${config.triggerPr}`)}\n\n` +
    (report.stack ? `Stack ${esc(report.stack.number)} · Top ${link(`${root}/pull/${report.stack.pull_requests.at(-1)!.number}`, `PR ${report.stack.pull_requests.at(-1)!.number}`)}\n\n` : '') +
    (report.policySha ? `Policy revision: ${link(`${root}/commit/${report.policySha}`, report.policySha)}\n\n` : '') +
    `## Cancellation requests and observed outcomes\n\nA request being accepted does not prove a run or job stopped. Job states below are observations, not an assertion that prune caused every cancellation. Completed jobs are not canceled retroactively.\n\n` +
    (rows ? `<table><tr><th>Workflow</th><th>Lower PR / branch / commit</th><th>Target</th><th>Replacement</th><th>Outcome / request time</th><th>Reason / jobs</th></tr>${rows}</table>\n\n` : 'No cancellation requests or proposals.\n\n') +
    `## Workflow selection\n\nMissing opt-in means no. ${missing} workflows have no declaration.\n\n` +
    (policyRows ? `<table><tr><th>Workflow</th><th>Opt-in</th><th>Decision</th></tr>${policyRows}</table>\n\n` : '') +
    (config.warnMissing && missing ? `Warning: ${missing} workflows have no ALLOW_STACK_WORKFLOW_PRUNE declaration; their runs were preserved.\n\n` : '') +
    `## Notes\n\n${report.notes.map(note => `- ${esc(note)}`).join('\n') || 'No additional skips.'}\n\n` +
    (report.errors.length ? `## Errors\n\n${report.errors.map(error => `- ${esc(error)}`).join('\n')}\n` : '');
}
