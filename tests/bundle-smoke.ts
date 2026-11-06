import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
test('bundled action writes a summary and outputs without API work on a manual event', () => {
  const folder = mkdtempSync(join(tmpdir(), 'stack-prune-smoke-'));
  try {
    writeFileSync(join(folder, 'event.json'), JSON.stringify({repository: {id: 1, default_branch: 'main'}}));
    for (const file of ['summary', 'output']) writeFileSync(join(folder, file), '');
    const result = spawnSync(process.execPath, ['dist/index.cjs'], {encoding: 'utf8', timeout: 15000,
      env: {...process.env, INPUT_TOKEN: 'fake-smoke-token', GITHUB_EVENT_PATH: join(folder, 'event.json'),
        GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '1',
        GITHUB_STEP_SUMMARY: join(folder, 'summary'), GITHUB_OUTPUT: join(folder, 'output')}});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(readFileSync(join(folder, 'summary'), 'utf8'), /Only pull_request.stacked initiates pruning/);
    const output = readFileSync(join(folder, 'output'), 'utf8');
    assert.match(output, /accepted-count/); assert.match(output, /pending-count/);
    assert.match(result.stdout, /"entries":\[\]/);
  } finally {rmSync(folder, {recursive: true, force: true});}
});

test('bundled action reads the renamed opt-in and cancels only the eligible lower run', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'stack-prune-api-'));
  let canceled = false;
  const calls: string[] = [];
  const member = (number: number) => ({number, state: 'open', head: {sha: `sha${number}`, ref: `branch${number}`, repo: {id: 1}}, stack: {number: 7, size: 2, position: number}});
  const run = (id: number, pr: number, workflow = 9) => ({id, workflow_id: workflow, run_number: id, run_attempt: 1, event: 'pull_request',
    status: id === 10 && canceled ? 'completed' : 'in_progress', conclusion: id === 10 && canceled ? 'cancelled' : null,
    created_at: id === 100 ? '2026-11-06T10:00:10Z' : '2026-11-06T10:00:00Z',
    head_sha: `sha${pr}`, head_branch: `branch${pr}`, head_repository: {id: 1}, pull_requests: [{number: pr}], html_url: `https://github.com/o/r/actions/runs/${id}`});
  const server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://localhost').pathname.replace('/repos/o/r/', '');
    calls.push(`${req.method} ${path}`);
    res.setHeader('Content-Type', 'application/json');
    let body: unknown;
    if (req.method === 'POST' && path === 'actions/runs/10/cancel') {canceled = true; res.writeHead(202); body = {};}
    else if (/^actions\/runs\/(10|20|100)$/.test(path)) {const id = Number(path.split('/').at(-1)); body = run(id, id === 10 ? 1 : 2, id === 100 ? 99 : 9);}
    else if (/^pulls\/[12]$/.test(path)) body = member(Number(path.at(-1)));
    else if (path === 'stacks/7') body = {number: 7, base: {ref: 'main'}, pull_requests: [member(1), member(2)]};
    else if (path === 'compare/sha1...sha2') body = {status: 'ahead'};
    else if (path === 'commits/main') body = {sha: 'a'.repeat(40)};
    else if (path === 'actions/workflows') body = {total_count: 1, workflows: [{id: 9, name: 'Unit Tests', path: '.github/workflows/unit.yaml', state: 'active'}]};
    else if (path === 'actions/workflows/9/runs') body = {total_count: 2, workflow_runs: [run(20, 2), run(10, 1)]};
    else if (path.startsWith('contents/')) body = {encoding: 'base64', content: Buffer.from('env:\n  ALLOW_STACK_WORKFLOW_PRUNE: "yes"\n').toString('base64')};
    else if (path === 'actions/runs/10/attempts/1/jobs') body = {total_count: 1, jobs: [{id: 110, name: 'Unit Test Job', status: canceled ? 'completed' : 'in_progress', conclusion: canceled ? 'cancelled' : null, html_url: 'https://github.com/o/r/job/110'}]};
    else {res.writeHead(404); body = {message: `Unexpected test path ${path}`};}
    res.end(JSON.stringify(body));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    writeFileSync(join(folder, 'event.json'), JSON.stringify({action: 'stacked', repository: {id: 1, default_branch: 'main'}, pull_request: member(1)}));
    for (const file of ['summary', 'output']) writeFileSync(join(folder, file), '');
    const result = await new Promise<{code: number | null; stdout: string; stderr: string}>((resolve, reject) => {
      const child = spawn(process.execPath, ['dist/index.cjs'], {timeout: 15000, env: {...process.env,
        INPUT_TOKEN: 'fake-smoke-token', 'INPUT_DRY-RUN': 'no', 'INPUT_POLICY-REF': '',
        GITHUB_API_URL: `http://127.0.0.1:${(server.address() as {port: number}).port}`,
        GITHUB_EVENT_PATH: join(folder, 'event.json'), GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '100', GITHUB_STEP_SUMMARY: join(folder, 'summary'), GITHUB_OUTPUT: join(folder, 'output')}});
      let stdout = '', stderr = '';
      child.stdout.on('data', data => {stdout += data;}); child.stderr.on('data', data => {stderr += data;});
      child.on('error', reject); child.on('close', code => resolve({code, stdout, stderr}));
    });
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.equal(canceled, true);
    assert.deepEqual(calls.filter(call => call.startsWith('POST')), ['POST actions/runs/10/cancel']);
    const text = readFileSync(join(folder, 'summary'), 'utf8');
    assert.match(text, /Stack prune/); assert.match(text, /Unit Test Job/); assert.match(text, /finished: cancelled/);
    assert.match(result.stdout, /"policy":"yes"/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    rmSync(folder, {recursive: true, force: true});
  }
});
