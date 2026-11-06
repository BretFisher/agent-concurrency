import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup } from '../src/cleanup.ts';
import { policy } from '../src/policy.ts';
import { summary } from '../src/summary.ts';
import { pull as parsePull, run as parseRun } from '../src/api.ts';
import type { Api, Config, Job, Pull, Run, Stack, Workflow } from '../src/model.ts';
const sha = 'a'.repeat(40);
const source = 'name: Unit Tests\nenv:\n  ALLOW_STACK_CLEANUP: "yes"\njobs: {}\n';
const pr = (number: number): Pull => ({number, state: 'open', head: {sha: `sha${number}`, ref: `branch${number}`, repo: {id: 1}}, stack: {number: 7, position: number, size: 3}});
const run = (id: number, number: number, workflow = 9): Run => ({id, workflow_id: workflow, run_number: id, run_attempt: 1,
  event: 'pull_request', status: 'in_progress', conclusion: null, created_at: '2026-11-06T10:00:00Z',
  head_sha: `sha${number}`, head_branch: `branch${number}`, head_repository: {id: 1}, pull_requests: [{number}],
  html_url: `https://github.com/o/r/actions/runs/${id}`});
const config = (): Config => ({repositoryId: 1, cleanupRunId: 100, event: 'pull_request', action: 'stacked', triggerPr: 1,
  triggerRepoId: 1, defaultBranch: 'main', dryRun: false, warnMissing: false, serverUrl: 'https://github.com', repository: 'o/r'});
class Fake implements Api {
  stackValue: Stack = {number: 7, base: {ref: 'main'}, pull_requests: [pr(1), pr(2), pr(3)]};
  workflowValues: Workflow[] = [{id: 9, name: 'Unit Tests', path: '.github/workflows/unit.yaml', state: 'active'}];
  runValues = new Map<number, Run>([[10, run(10, 1)], [20, run(20, 2)], [30, run(30, 3)], [100, {...run(100, 3, 99), created_at: '2026-11-06T10:00:10Z'}]]);
  sourceValue = source; sourceFor = new Map<string, string>(); lists: Run[][] | undefined;
  listCalls = 0; stackCalls = 0; mutateStackAt = Infinity;
  cancelError = false; pending = false; failCompare = false; failSource = false; compareValue = 'ahead';
  calls: string[] = []; cancelled: number[] = []; associations: Pull[] = [pr(1), pr(2), pr(3)]; sourceRefs: string[] = [];
  clone<T>(value: T): T {return structuredClone(value);}
  async pull(id: number) {return this.clone(this.stackValue.pull_requests.find(p => p.number === id) || pr(id));}
  async stack() {
    this.stackCalls++; const value = this.clone(this.stackValue);
    if (this.stackCalls >= this.mutateStackAt) value.pull_requests[0].head.sha = 'changed';
    return value;
  }
  async workflows() {return this.clone(this.workflowValues);}
  async resolve(ref: string) {this.calls.push(`resolve:${ref}`); return sha;}
  async source(path: string, ref: string) {
    this.sourceRefs.push(ref); if (this.failSource) throw new Error('Source API failed');
    return this.sourceFor.get(`${path}@${ref}`) ?? this.sourceValue;
  }
  async run(id: number) {
    this.calls.push(`run:${id}`); const value = this.clone(this.runValues.get(id)!);
    if (this.cancelled.includes(id) && !this.pending) {value.status = 'completed'; value.conclusion = 'cancelled';}
    return value;
  }
  async runs(workflow: number) {
    this.listCalls++;
    return this.clone(this.lists?.[Math.min(this.listCalls - 1, this.lists.length - 1)] || [...this.runValues.values()].filter(r => r.workflow_id === workflow));
  }
  async associated() {return this.clone(this.associations);}
  async compare() {if (this.failCompare) throw new Error('Compare API failed'); return this.compareValue;}
  async jobs(id: number, attempt: number): Promise<Job[]> {
    this.calls.push(`jobs:${id}:${attempt}`);
    return [{id: id * 10, name: 'Unit <test>', status: this.cancelled.includes(id) && !this.pending ? 'completed' : 'in_progress',
      conclusion: this.cancelled.includes(id) && !this.pending ? 'cancelled' : null, html_url: `https://github.com/o/r/actions/runs/${id}/job/${id * 10}`}];
  }
  async cancel(id: number) {
    this.calls.push(`cancel:${id}`); if (this.cancelError) throw new Error('Cancellation rejected');
    if (!this.cancelled.includes(id)) this.cancelled.push(id);
  }
}
const execute = (api = new Fake(), change: Partial<Config> = {}) => cleanup(api, {...config(), ...change}, async () => {}, () => new Date('2026-11-06T10:00:11Z'));
test('creation cancels lower runs in opted-in workflow, not cleanup or top', async () => {
  const api = new Fake(), report = await execute(api);
  assert.deepEqual(api.cancelled, [10, 20]); assert.deepEqual(report.errors, []);
  assert.ok(report.entries.every(e => e.outcome === 'finished: cancelled' && e.replacement.id === 30));
});
test('joining lower PR event discovers current top', async () => {
  const api = new Fake(); await execute(api, {triggerPr: 2}); assert.deepEqual(api.cancelled, [10, 20]);
});
test('extension cancels former top without another commit', async () => {
  const api = new Fake(); api.stackValue.pull_requests.push(pr(4));
  api.stackValue.pull_requests.forEach(p => {p.stack!.size = 4;});
  api.runValues.set(40, run(40, 4)); await execute(api, {triggerPr: 4}); assert.deepEqual(api.cancelled, [10, 20, 30]);
});
test('multiple opted-in workflows are handled independently', async () => {
  const api = new Fake(); api.workflowValues.push({id: 8, name: 'Integration', path: '.github/workflows/integration.yaml', state: 'active'});
  api.runValues.set(11, run(11, 1, 8)); api.runValues.set(12, run(12, 3, 8));
  await execute(api); assert.deepEqual(api.cancelled, [10, 20, 11]);
});
for (const declaration of ['no', undefined, '${{ vars.ALLOW }}', 'YES', true]) test(`preserve policy ${String(declaration)}`, async () => {
  const api = new Fake(); api.sourceValue = declaration === undefined ? 'name: No policy' : `env:\n  ALLOW_STACK_CLEANUP: ${JSON.stringify(declaration)}\n`;
  const report = await execute(api); assert.deepEqual(api.cancelled, []); assert.equal(report.policies.length, 1);
});
test('missing warning is optional and does not alter eligibility', async () => {
  const api = new Fake(); api.sourceValue = 'name: Missing'; const report = await execute(api, {warnMissing: true});
  assert.match(summary(report, {...config(), warnMissing: true}), /Warning: 1/);
  assert.doesNotMatch(summary(report, config()), /Warning: 1/); assert.deepEqual(api.cancelled, []);
});
test('only stacked can initiate cleanup', async () => {
  for (const change of [{action: 'opened'}, {action: 'synchronize'}, {event: 'workflow_dispatch'}]) {
    const api = new Fake(); await execute(api, change); assert.deepEqual(api.cancelled, []); assert.equal(api.calls.length, 0);
  }
});
test('foreign triggering repository cannot cancel', async () => {
  const api = new Fake(); await execute(api, {triggerRepoId: 2}); assert.deepEqual(api.cancelled, []);
});
test('incomplete top or failed ancestry API preserves lower work', async () => {
  for (const failure of ['diverged', 'error']) {
    const api = new Fake(); if (failure === 'error') api.failCompare = true; else api.compareValue = failure;
    await execute(api); assert.deepEqual(api.cancelled, []);
  }
});
test('policy resolves once to immutable trusted commit', async () => {
  const api = new Fake(); await execute(api); assert.deepEqual(api.calls.filter(c => c.startsWith('resolve:')), ['resolve:main']);
  assert.ok(api.sourceRefs.includes(sha)); assert.ok(!api.sourceRefs.includes('main'));
});
test('explicit trusted SHA supported; mutable override rejected', async () => {
  const api = new Fake(); await execute(api, {policyRef: 'feature'}); assert.deepEqual(api.cancelled, []);
  const good = new Fake(); await execute(good, {policyRef: 'b'.repeat(40)}); assert.ok(good.calls.includes(`resolve:${'b'.repeat(40)}`));
});
test('changed top workflow preserved', async () => {
  const api = new Fake(); api.sourceFor.set('.github/workflows/unit.yaml@sha3', 'name: changed'); await execute(api); assert.deepEqual(api.cancelled, []);
});
test('changed lower workflow preserved', async () => {
  const api = new Fake(); api.sourceFor.set('.github/workflows/unit.yaml@sha1', 'name: changed'); await execute(api); assert.deepEqual(api.cancelled, [20]);
});
test('missing workflow source cannot authorize cancellation', async () => {
  const api = new Fake(); api.failSource = true; const report = await execute(api); assert.deepEqual(api.cancelled, []); assert.equal(report.errors.length, 1);
});
test('manual, unrelated, foreign, completed, and post-cleanup runs preserved', async () => {
  for (const change of [{event: 'workflow_dispatch'}, {pull_requests: [{number: 77}]}, {head_repository: {id: 2}},
      {status: 'completed', conclusion: 'success'}, {created_at: '2026-11-06T10:00:11Z'}, {head_branch: 'unrelated'}]) {
    const api = new Fake(); Object.assign(api.runValues.get(10)!, change); await execute(api); assert.deepEqual(api.cancelled, [20]);
  }
});
test('push needs commit-to-PR association', async () => {
  const api = new Fake(); Object.assign(api.runValues.get(10)!, {event: 'push', pull_requests: []}); await execute(api); assert.deepEqual(api.cancelled, [10, 20]);
  const other = new Fake(); Object.assign(other.runValues.get(10)!, {event: 'push', pull_requests: []}); other.associations = [];
  await execute(other); assert.deepEqual(other.cancelled, [20]);
});
test('failed or canceled top is not replacement', async () => {
  for (const conclusion of ['failure', 'cancelled']) {
    const api = new Fake(); Object.assign(api.runValues.get(30)!, {status: 'completed', conclusion}); await execute(api);
    assert.deepEqual(api.cancelled, []); assert.equal(api.listCalls, 3);
  }
});
test('successful completed top replaces lower work', async () => {
  const api = new Fake(); Object.assign(api.runValues.get(30)!, {status: 'completed', conclusion: 'success'}); await execute(api); assert.deepEqual(api.cancelled, [10, 20]);
});
test('bounded retry discovers delayed top', async () => {
  const api = new Fake(); api.lists = [[run(10, 1), run(20, 2)], [...api.runValues.values()].filter(r => r.workflow_id === 9)];
  await execute(api); assert.equal(api.listCalls, 2); assert.deepEqual(api.cancelled, [10, 20]);
});
test('missing top gives up after three scans', async () => {
  const api = new Fake(); api.runValues.delete(30); const report = await execute(api);
  assert.equal(api.listCalls, 3); assert.deepEqual(api.cancelled, []); assert.ok(report.notes.some(n => n.includes('no suitable run')));
});
test('stack change stops writes', async () => {
  const api = new Fake(); api.mutateStackAt = 2; const report = await execute(api);
  assert.deepEqual(api.cancelled, []); assert.ok(report.errors.some(n => n.includes('Stack changed')));
});
test('rerun attempt race preserved', async () => {
  const api = new Fake(), original = api.run.bind(api);
  api.run = async id => ({...await original(id), ...(id === 10 ? {run_attempt: 2} : {})}); await execute(api); assert.deepEqual(api.cancelled, [20]);
});
test('dry run never writes', async () => {
  const api = new Fake(), report = await execute(api, {dryRun: true});
  assert.deepEqual(api.cancelled, []); assert.equal(report.entries.length, 2); assert.ok(report.entries.every(e => e.outcome.startsWith('dry run')));
});
test('accepted pending requests are not confirmed; all requests precede confirmation', async () => {
  const api = new Fake(); api.pending = true; const report = await execute(api);
  assert.ok(report.entries.every(e => e.outcome === 'accepted; pending')); assert.ok(api.calls.indexOf('cancel:20') < api.calls.lastIndexOf('run:10'));
});
test('rejection is an error', async () => {
  const api = new Fake(); api.cancelError = true; const report = await execute(api); assert.equal(report.errors.length, 2);
  assert.ok(report.entries.every(e => e.outcome === 'request failed'));
});
test('repeated invocation does not repeat cancellations', async () => {
  const api = new Fake(); await execute(api); await execute(api); assert.deepEqual(api.cancelled, [10, 20]);
});
test('summary contains trace links, attempt, reason, jobs, time and escaped text', async () => {
  const report = await execute(), text = summary(report, config());
  for (const detail of ['PR 1', 'branch1', 'sha1', 'attempt 1', 'Top run 30', '2026-11-06T10:00:11.000Z', 'Workflow opted in', 'Unit &lt;test&gt;', '/job/100', 'Observed job states']) assert.ok(text.includes(detail), detail);
});
test('invalid YAML and job-level variable never opt in', () => {
  for (const text of ['env: [broken', 'env:\n  ALLOW_STACK_CLEANUP: yes\n  ALLOW_STACK_CLEANUP: no', 'env: "${{ vars.ALL }}"']) assert.equal(policy(text).value, 'invalid');
  assert.equal(policy('jobs:\n  unit:\n    env:\n      ALLOW_STACK_CLEANUP: "yes"').value, 'missing');
});
test('malformed API shapes fail validation', () => {
  assert.throws(() => parsePull({number: 1})); assert.throws(() => parseRun({id: 1}));
});
