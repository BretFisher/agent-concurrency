import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { GitHubApi } from '../src/api.ts';

test('real API adapter follows pagination, caches immutable sources, and posts cancellation', async () => {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost'); seen.push(`${req.method} ${url.pathname}${url.search}`);
    res.setHeader('Content-Type', 'application/json');
    const page = Number(url.searchParams.get('page') || 1);
    const port = (server.address() as {port: number}).port;
    if (url.pathname.endsWith('/workflows')) {
      if (page === 1) res.setHeader('Link', `<http://127.0.0.1:${port}/repos/o/r/actions/workflows?page=2>; rel="next"`);
      res.end(JSON.stringify({total_count: 2, workflows: [{id: page, name: `Flow ${page}`, path: `.github/workflows/${page}.yaml`, state: 'active'}]}));
    } else if (url.pathname.includes('/contents/')) {
      res.end(JSON.stringify({encoding: 'base64', content: Buffer.from('env:\n  ALLOW_STACK_CLEANUP: "yes"').toString('base64')}));
    } else if (url.pathname.endsWith('/cancel')) {
      assert.equal(req.method, 'POST'); res.writeHead(202); res.end('{}');
    } else if (url.pathname.endsWith('/attempts/2/jobs')) {
      if (page === 1) res.setHeader('Link', `<http://127.0.0.1:${port}/repos/o/r/actions/runs/10/attempts/2/jobs?page=2>; rel="next"`);
      res.end(JSON.stringify({total_count: 2, jobs: [{id: page, name: `Job ${page}`, status: 'completed', conclusion: 'success', html_url: `https://github.com/o/r/job/${page}`}]}));
    } else {res.writeHead(404); res.end('{}');}
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const api = new GitHubApi('fake-test-token', 'o/r', `http://127.0.0.1:${(server.address() as {port: number}).port}`);
    assert.deepEqual((await api.workflows()).map(w => w.id), [1, 2]);
    await api.source('.github/workflows/flow.yaml', 'a'.repeat(40));
    await api.source('.github/workflows/flow.yaml', 'a'.repeat(40));
    assert.equal(seen.filter(p => p.includes('/contents/')).length, 1);
    assert.deepEqual((await api.jobs(10, 2)).map(j => j.id), [1, 2]);
    await api.cancel(10); assert.ok(seen.includes('POST /repos/o/r/actions/runs/10/cancel'));
  } finally {await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));}
});
