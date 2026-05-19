import type { ExecutionRecord } from './event-stream.js';
import type { ObserverEvent } from './events.js';

export interface PerStepAggregate {
  stepName: string;
  /** Number of times this step started across all retained executions of the flow. */
  runs: number;
  /** Step-duration percentiles in milliseconds. `0` when there are no completions. */
  p50: number;
  p95: number;
  /** Fraction of step starts that ended in `step.error` (last attempt only). */
  errorRate: number;
  /** Mean number of retries per run, expressed as retries ÷ runs. */
  retryRate: number;
}

export interface FlowAggregate {
  flowName: string;
  /** Total executions of this flow retained in the ring buffer. */
  runs: number;
  /** Flow-duration percentiles in milliseconds (only finished executions count). */
  p50: number;
  p95: number;
  /** Fraction of executions that finished in `failed` state. `broken` flows count as success. */
  errorRate: number;
  perStep: PerStepAggregate[];
}

/**
 * Roll the retained ring buffer up into per-flow + per-step stats. Pure
 * function — call on every catalog request; cost is O(events) and the
 * ring buffer is small by design.
 */
export function aggregateExecutions(
  records: ReadonlyArray<ExecutionRecord>
): FlowAggregate[] {
  const byFlow = new Map<string, ExecutionRecord[]>();
  for (const record of records) {
    const list = byFlow.get(record.flowName);
    if (list) list.push(record);
    else byFlow.set(record.flowName, [record]);
  }

  const out: FlowAggregate[] = [];
  for (const [flowName, list] of byFlow) {
    out.push(buildFlowAggregate(flowName, list));
  }
  // Stable order: most-run flows first, ties alphabetic.
  out.sort((a, b) => b.runs - a.runs || a.flowName.localeCompare(b.flowName));
  return out;
}

function buildFlowAggregate(
  flowName: string,
  records: ReadonlyArray<ExecutionRecord>
): FlowAggregate {
  const flowDurations: number[] = [];
  let errors = 0;
  const perStepBuckets = new Map<
    string,
    { runs: number; durations: number[]; errors: number; retries: number }
  >();

  for (const record of records) {
    if (record.status === 'failed') errors++;
    if (typeof record.durationMs === 'number')
      flowDurations.push(record.durationMs);

    walkRecordSteps(record.events, perStepBuckets);
  }

  const perStep: PerStepAggregate[] = [];
  for (const [stepName, bucket] of perStepBuckets) {
    const sorted = [...bucket.durations].sort(numericAsc);
    perStep.push({
      stepName,
      runs: bucket.runs,
      p50: quantile(sorted, 0.5),
      p95: quantile(sorted, 0.95),
      errorRate: bucket.runs === 0 ? 0 : bucket.errors / bucket.runs,
      retryRate: bucket.runs === 0 ? 0 : bucket.retries / bucket.runs,
    });
  }
  // Stable per-step order: most-run first, ties alphabetic — matches table UX.
  perStep.sort(
    (a, b) => b.runs - a.runs || a.stepName.localeCompare(b.stepName)
  );

  const sortedFlow = [...flowDurations].sort(numericAsc);
  return {
    flowName,
    runs: records.length,
    p50: quantile(sortedFlow, 0.5),
    p95: quantile(sortedFlow, 0.95),
    errorRate: records.length === 0 ? 0 : errors / records.length,
    perStep,
  };
}

function walkRecordSteps(
  events: ReadonlyArray<ObserverEvent>,
  buckets: Map<
    string,
    { runs: number; durations: number[]; errors: number; retries: number }
  >
): void {
  for (const event of events) {
    switch (event.type) {
      case 'step.start':
        upsertBucket(buckets, event.stepName).runs++;
        break;
      case 'step.complete':
        upsertBucket(buckets, event.stepName).durations.push(event.durationMs);
        break;
      case 'step.error':
        upsertBucket(buckets, event.stepName).errors++;
        break;
      case 'step.retry':
        upsertBucket(buckets, event.stepName).retries++;
        break;
      default:
        break;
    }
  }
}

function upsertBucket(
  buckets: Map<
    string,
    { runs: number; durations: number[]; errors: number; retries: number }
  >,
  stepName: string
) {
  let bucket = buckets.get(stepName);
  if (!bucket) {
    bucket = { runs: 0, durations: [], errors: 0, retries: 0 };
    buckets.set(stepName, bucket);
  }
  return bucket;
}

/**
 * Quantile via linear interpolation between the two nearest ranks. Input
 * must be sorted ascending. Returns `0` for an empty array — matches the
 * "no data" UX expectation in the catalog table.
 *
 * Sort-based on purpose: the ring buffer caps total samples, so a streaming
 * sketch (t-digest etc.) would be over-engineered for v1.
 */
export function quantile(
  sortedValues: ReadonlyArray<number>,
  q: number
): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0]!;
  const clamped = Math.min(Math.max(q, 0), 1);
  const idx = (sortedValues.length - 1) * clamped;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedValues[lo]!;
  const weight = idx - lo;
  return sortedValues[lo]! + (sortedValues[hi]! - sortedValues[lo]!) * weight;
}

function numericAsc(a: number, b: number): number {
  return a - b;
}
