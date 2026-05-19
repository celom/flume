import type { StateDiff } from './events.js';

/**
 * Shallow diff of two state objects.
 *
 * Keys present in `after` but not in `before` show up in `added`.
 * Keys present in `before` but not in `after` show up in `removed`.
 * Keys present in both whose values differ (by `Object.is`) land in `changed`.
 *
 * Nested object changes register as a single `changed` entry with the full
 * before/after subtree — the caller is responsible for any deeper diffing.
 */
export function shallowStateDiff(before: unknown, after: unknown): StateDiff {
  const beforeObj = toRecord(before);
  const afterObj = toRecord(after);

  const added: Record<string, unknown> = {};
  const removed: string[] = [];
  const changed: Record<string, { before: unknown; after: unknown }> = {};

  for (const key of Object.keys(afterObj)) {
    if (!(key in beforeObj)) {
      added[key] = afterObj[key];
    } else if (!Object.is(beforeObj[key], afterObj[key])) {
      changed[key] = { before: beforeObj[key], after: afterObj[key] };
    }
  }

  for (const key of Object.keys(beforeObj)) {
    if (!(key in afterObj)) {
      removed.push(key);
    }
  }

  return { added, removed, changed };
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined || typeof value !== 'object') {
    return {};
  }
  return value as Record<string, unknown>;
}
