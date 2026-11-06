import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
test('bundled action writes a summary and outputs without API work on a manual event', () => {
  const folder = mkdtempSync(join(tmpdir(), 'stack-cleanup-smoke-'));
  try {
    writeFileSync(join(folder, 'event.json'), JSON.stringify({repository: {id: 1, default_branch: 'main'}}));
    for (const file of ['summary', 'output']) writeFileSync(join(folder, file), '');
    const result = spawnSync(process.execPath, ['dist/index.cjs'], {encoding: 'utf8', timeout: 15000,
      env: {...process.env, INPUT_TOKEN: 'fake-smoke-token', GITHUB_EVENT_PATH: join(folder, 'event.json'),
        GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '1',
        GITHUB_STEP_SUMMARY: join(folder, 'summary'), GITHUB_OUTPUT: join(folder, 'output')}});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(readFileSync(join(folder, 'summary'), 'utf8'), /Only pull_request.stacked initiates cleanup/);
    const output = readFileSync(join(folder, 'output'), 'utf8');
    assert.match(output, /accepted-count/); assert.match(output, /pending-count/);
    assert.match(result.stdout, /"entries":\[\]/);
  } finally {rmSync(folder, {recursive: true, force: true});}
});
