import { randomUUID } from 'node:crypto';

/**
 * Generate a fresh correlation id. Thin wrapper so tests can swap it.
 */
export function generateCorrelationId(): string {
  return randomUUID();
}

/**
 * One-shot warning surfaced when a flow.execute() omits `options.correlationId`.
 * Useful nudge for users — their tracing system can pass the same id through
 * to the observer and get a unified view in the Console.
 *
 * The warning fires at most once per process. `__resetForTests()` re-arms it.
 */
let warned = false;

export function warnMissingCorrelationIdOnce(): void {
  if (warned) return;
  warned = true;
  console.warn(
    '[prose-observer] flow.execute() called without options.correlationId. ' +
      'The Console will auto-generate one per run; pass options.correlationId ' +
      'to align with your own tracing. (warning shown once per process)'
  );
}

/** Test-only hook. Re-arms the once-per-process latch. */
export function __resetCorrelationWarningForTests(): void {
  warned = false;
}
