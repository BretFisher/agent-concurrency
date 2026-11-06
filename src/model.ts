export interface Head { sha: string; ref: string; repo: { id: number } }
export interface Pull {
  number: number; state: string; head: Head;
  stack?: { number: number; position: number; size: number } | null;
}
export interface Stack { number: number; base: unknown; pull_requests: Pull[] }
export interface Workflow { id: number; name: string; path: string; state: string }
export interface Run {
  id: number; workflow_id: number; run_number: number; run_attempt: number;
  event: string; status: string; conclusion: string | null;
  created_at: string; head_sha: string; head_branch: string;
  head_repository: { id: number } | null; pull_requests: { number: number }[];
  html_url: string;
}
export interface Job { id: number; name: string; status: string; conclusion: string | null; html_url: string }
export interface Api {
  pull(number: number): Promise<Pull>;
  stack(number: number): Promise<Stack>;
  workflows(): Promise<Workflow[]>;
  source(path: string, ref: string): Promise<string>;
  resolve(ref: string): Promise<string>;
  run(id: number): Promise<Run>;
  runs(workflow: number): Promise<Run[]>;
  associated(sha: string): Promise<Pull[]>;
  compare(base: string, head: string): Promise<string>;
  jobs(run: number, attempt: number): Promise<Job[]>;
  cancel(run: number): Promise<void>;
}
export interface Config {
  repositoryId: number; pruneRunId: number; event: string; action: string;
  triggerPr: number; triggerRepoId: number; defaultBranch: string;
  policyRef?: string; dryRun: boolean; warnMissing: boolean;
  serverUrl: string; repository: string;
}
export interface Entry {
  workflow: Workflow; lower: Pull; run: Run; replacement: Run;
  reason: string; outcome: string; requestedAt?: string; jobs: Job[];
}
export interface Report {
  trigger: string; policySha?: string; stack?: Stack;
  policies: { workflow: Workflow; policy: string; detail: string }[];
  entries: Entry[]; notes: string[]; errors: string[];
}
export const allowedEvent = (event: string) => event === 'pull_request' || event === 'push';
export const activeOrSuccessful = (run: Run) => run.status !== 'completed' || run.conclusion === 'success';
export function sameRun(a: Run, b: Run): boolean {
  return a.id === b.id && a.workflow_id === b.workflow_id && a.run_attempt === b.run_attempt &&
    a.head_sha === b.head_sha && a.head_branch === b.head_branch && a.event === b.event &&
    a.run_number === b.run_number && a.created_at === b.created_at &&
    a.head_repository?.id === b.head_repository?.id &&
    JSON.stringify(a.pull_requests.map(p => p.number).sort()) === JSON.stringify(b.pull_requests.map(p => p.number).sort());
}
export function stackKey(stack: Stack): string {
  return JSON.stringify({ number: stack.number, base: stack.base,
    members: stack.pull_requests.map(p => ({number: p.number, state: p.state, head: p.head})) });
}
export function onPr(run: Run, pr: Pull, repositoryId: number): boolean {
  return run.head_repository?.id === repositoryId && pr.head.repo.id === repositoryId &&
    run.head_branch === pr.head.ref &&
    (run.pull_requests.length === 0 || run.pull_requests.some(p => p.number === pr.number));
}
