/**
 * Default key list for redaction. Matched case-insensitively against object
 * keys at every depth — any property whose name normalizes to one of these
 * has its value replaced with `[REDACTED]`. Add to this list by wrapping
 * `consoleObserver({ redact })` and applying your own pass after the default.
 */
export const DEFAULT_REDACT_KEYS: ReadonlyArray<string> = [
  'authorization',
  'password',
  'apikey',
  'api_key',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'creditcard',
  'cardnumber',
  'cvv',
  'ssn',
  'pin',
  'cookie',
  'set-cookie',
];

const REDACTED = '[REDACTED]';
const CIRCULAR = '[Circular]';
const TRUNCATED = '[MaxDepth]';

/**
 * Walks `value` and replaces the value of any property whose key (lowercased)
 * is in `lowerKeys`. Stops at `maxDepth` to avoid blowing the stack on
 * adversarial input. Cycles are detected via a `WeakSet` and replaced with
 * `'[Circular]'`.
 *
 * Returns a new tree — the input is never mutated.
 */
export function redactDeep(
  value: unknown,
  lowerKeys: ReadonlySet<string>,
  maxDepth = 8
): unknown {
  const seen = new WeakSet<object>();

  function visit(v: unknown, depth: number): unknown {
    if (v === null || v === undefined) return v;
    if (typeof v !== 'object') return v;
    if (depth >= maxDepth) return TRUNCATED;
    if (seen.has(v as object)) return CIRCULAR;
    seen.add(v as object);

    if (Array.isArray(v)) {
      return v.map((item) => visit(item, depth + 1));
    }

    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>)) {
      if (lowerKeys.has(k.toLowerCase())) {
        out[k] = REDACTED;
      } else {
        out[k] = visit((v as Record<string, unknown>)[k], depth + 1);
      }
    }
    return out;
  }

  return visit(value, 0);
}

/**
 * Convenience wrapper that builds a key set from the default list plus any
 * extras. `extras` are normalized to lower-case.
 */
export function buildRedactKeySet(extras: Iterable<string> = []): Set<string> {
  const set = new Set<string>(DEFAULT_REDACT_KEYS);
  for (const k of extras) {
    set.add(k.toLowerCase());
  }
  return set;
}
