import { getOctokit } from '@actions/github';
import type { Api, Job, Pull, Run, Stack, Workflow } from './model.ts';

type ObjectData = Record<string, unknown>;
function object(value: unknown): ObjectData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an API object.');
  return value as ObjectData;
}
function string(value: unknown): string {
  if (typeof value !== 'string' || !value.length) throw new Error('Expected a nonempty API string.');
  return value;
}
function number(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error('Expected a positive API integer.');
  return value as number;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected an API array.');
  return value;
}
export function pull(value: unknown): Pull {
  const data = object(value), head = object(data.head), repo = object(head.repo);
  const rawStack = data.stack == null ? null : object(data.stack);
  return {number: number(data.number), state: string(data.state), head: {sha: string(head.sha), ref: string(head.ref), repo: {id: number(repo.id)}},
    stack: rawStack ? {number: number(rawStack.number), position: number(rawStack.position), size: number(rawStack.size)} : null};
}
export function run(value: unknown): Run {
  const data = object(value);
  return {id: number(data.id), workflow_id: number(data.workflow_id), run_number: number(data.run_number), run_attempt: number(data.run_attempt ?? 1),
    event: string(data.event), status: string(data.status), conclusion: data.conclusion == null ? null : string(data.conclusion),
    created_at: string(data.created_at), head_sha: string(data.head_sha), head_branch: string(data.head_branch),
    head_repository: data.head_repository == null ? null : {id: number(object(data.head_repository).id)},
    pull_requests: array(data.pull_requests).map(p => ({number: number(object(p).number)})), html_url: string(data.html_url)};
}
export class GitHubApi implements Api {
  private client;
  private owner: string;
  private repo: string;
  private cache = new Map<string, string>();
  constructor(token: string, repository: string, baseUrl?: string) {
    const parts = repository.split('/');
    if (parts.length !== 2 || parts.some(p => !/^[A-Za-z0-9_.-]+$/.test(p))) throw new Error('Invalid repository.');
    [this.owner, this.repo] = parts;
    this.client = getOctokit(token, baseUrl ? {baseUrl} : {});
  }
  private async get(path: string, params: ObjectData = {}): Promise<unknown> {
    return (await this.client.request(`GET /repos/{owner}/{repo}/${path}`, {owner: this.owner, repo: this.repo, ...params})).data;
  }
  private async list(path: string, params: ObjectData = {}): Promise<unknown[]> {
    return this.client.paginate(`GET /repos/{owner}/{repo}/${path}`, {owner: this.owner, repo: this.repo, per_page: 100, ...params});
  }
  async pull(id: number) { return pull(await this.get(`pulls/${id}`)); }
  async stack(id: number): Promise<Stack> {
    const data = object(await this.get(`stacks/${id}`));
    return {number: number(data.number), base: data.base, pull_requests: array(data.pull_requests).map(pull)};
  }
  async workflows(): Promise<Workflow[]> {
    return (await this.list('actions/workflows')).map(value => {
      const data = object(value);
      return {id: number(data.id), name: string(data.name), path: string(data.path), state: string(data.state)};
    });
  }
  async source(path: string, ref: string): Promise<string> {
    const key = `${ref}:${path}`;
    if (!this.cache.has(key)) {
      const data = object(await this.get(`contents/${path.split('/').map(encodeURIComponent).join('/')}`, {ref}));
      if (data.encoding !== 'base64' || typeof data.content !== 'string') throw new Error('Workflow content is not an inline base64 file.');
      this.cache.set(key, Buffer.from(data.content, 'base64').toString('utf8'));
    }
    return this.cache.get(key)!;
  }
  async resolve(ref: string) { return string(object(await this.get(`commits/${encodeURIComponent(ref)}`)).sha); }
  async run(id: number) { return run(await this.get(`actions/runs/${id}`)); }
  async runs(workflow: number) { return (await this.list(`actions/workflows/${workflow}/runs`)).map(run); }
  async associated(sha: string) { return (await this.list(`commits/${encodeURIComponent(sha)}/pulls`)).map(pull); }
  async compare(base: string, head: string) { return string(object(await this.get(`compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`)).status); }
  async jobs(id: number, attempt: number): Promise<Job[]> {
    return (await this.list(`actions/runs/${id}/attempts/${attempt}/jobs`)).map(value => {
      const data = object(value);
      return {id: number(data.id), name: string(data.name), status: string(data.status),
        conclusion: data.conclusion == null ? null : string(data.conclusion), html_url: string(data.html_url)};
    });
  }
  async cancel(id: number): Promise<void> {
    await this.client.request('POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancel', {owner: this.owner, repo: this.repo, run_id: id});
  }
}
