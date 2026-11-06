import * as core from '@actions/core';
import { context } from '@actions/github';
import { GitHubApi } from './api.ts';
import { cleanup } from './cleanup.ts';
import { summary } from './summary.ts';
import type { Config } from './model.ts';
function yesNo(name: string): boolean {
  const value = core.getInput(name) || 'no';
  if (!['yes', 'no'].includes(value)) throw new Error(`${name} must be yes or no.`);
  return value === 'yes';
}
async function main() {
  const token = core.getInput('token', {required: true});
  core.setSecret(token);
  const payload = context.payload;
  const config: Config = {
    repositoryId: Number(payload.repository?.id), cleanupRunId: context.runId,
    event: context.eventName, action: payload.action || '',
    triggerPr: Number(payload.pull_request?.number), triggerRepoId: Number(payload.pull_request?.head?.repo?.id),
    defaultBranch: String(payload.repository?.default_branch || ''),
    policyRef: core.getInput('policy-ref') || undefined,
    dryRun: yesNo('dry-run'), warnMissing: yesNo('warn-on-missing-opt-in'),
    serverUrl: process.env.GITHUB_SERVER_URL || 'https://github.com',
    repository: `${context.repo.owner}/${context.repo.repo}`,
  };
  const report = await cleanup(new GitHubApi(token, config.repository), config);
  await core.summary.addRaw(summary(report, config)).write();
  // A single JSON line preserves the same trace in authenticated job logs.
  core.info(`Stack cleanup report: ${JSON.stringify(report)}`);
  const missing = report.policies.filter(p => p.policy === 'missing');
  if (config.warnMissing && missing.length) core.warning(`Missing ALLOW_STACK_CLEANUP (preserved): ${missing.map(p => p.workflow.path).join(', ')}`);
  for (const declaration of report.policies.filter(p => p.policy === 'invalid')) core.warning(`${declaration.workflow.path}: ${declaration.detail}`);
  core.setOutput('accepted-count', report.entries.filter(e => e.requestedAt).length);
  core.setOutput('pending-count', report.entries.filter(e => e.outcome === 'accepted; pending').length);
  if (report.errors.length) core.setFailed(report.errors.join('; '));
}
main().catch(error => core.setFailed(error instanceof Error ? error.message : String(error)));
