import { parseDocument } from 'yaml';
export interface Policy { value: 'yes' | 'no' | 'missing' | 'invalid'; detail: string }
export function policy(source: string): Policy {
  const doc = parseDocument(source, { schema: 'core', uniqueKeys: true });
  if (doc.errors.length) return {value: 'invalid', detail: 'Invalid or ambiguous workflow YAML.'};
  let data: unknown;
  try { data = doc.toJS({maxAliasCount: 20}); } catch { return {value: 'invalid', detail: 'Workflow YAML could not be read safely.'}; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {value: 'invalid', detail: 'Workflow is not a mapping.'};
  const env = (data as Record<string, unknown>).env;
  if (env === undefined) return {value: 'missing', detail: 'No workflow-level opt-in; preserved.'};
  if (!env || typeof env !== 'object' || Array.isArray(env)) return {value: 'invalid', detail: 'Workflow env must be a literal mapping.'};
  const value = (env as Record<string, unknown>).ALLOW_STACK_WORKFLOW_PRUNE;
  if (value === undefined) return {value: 'missing', detail: 'No workflow-level opt-in; preserved.'};
  if (value === 'yes') return {value, detail: 'Explicit workflow-level opt-in.'};
  if (value === 'no') return {value, detail: 'Explicitly excluded.'};
  return {value: 'invalid', detail: 'ALLOW_STACK_WORKFLOW_PRUNE must be the literal string yes or no; preserved.'};
}
