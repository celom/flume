import { aggregateExecutions, quantile } from '../aggregate.js';
import type { ExecutionRecord } from '../event-stream.js';
import type { ObserverEvent } from '../events.js';

let cidCounter = 0;
const nextCid = () => `cid-${++cidCounter}`;

/**
 * Build a synthetic ExecutionRecord with realistic event ordering. `steps`
 * lets the test express step name + duration + retry count + whether the
 * step ended in error or completion.
 */
function fixtureRecord(opts: {
  flowName: string;
  status: ExecutionRecord['status'];
  totalMs: number;
  steps: Array<{
    name: string;
    durationMs: number;
    retries?: number;
    ended?: 'complete' | 'error';
  }>;
}): ExecutionRecord {
  const cid = nextCid();
  const events: ObserverEvent[] = [];
  let ts = 0;

  events.push({
    type: 'flow.start',
    correlationId: cid,
    flowName: opts.flowName,
    ts: ts++,
    input: {},
  });

  for (const step of opts.steps) {
    events.push({
      type: 'step.start',
      correlationId: cid,
      flowName: opts.flowName,
      ts: ts++,
      stepName: step.name,
    });
    for (let i = 0; i < (step.retries ?? 0); i++) {
      events.push({
        type: 'step.retry',
        correlationId: cid,
        flowName: opts.flowName,
        ts: ts++,
        stepName: step.name,
        attempt: i + 1,
        maxAttempts: 3,
        error: { name: 'Error', message: 'transient' },
      });
    }
    if ((step.ended ?? 'complete') === 'complete') {
      events.push({
        type: 'step.complete',
        correlationId: cid,
        flowName: opts.flowName,
        ts: ts++,
        stepName: step.name,
        result: {},
        durationMs: step.durationMs,
      });
    } else {
      events.push({
        type: 'step.error',
        correlationId: cid,
        flowName: opts.flowName,
        ts: ts++,
        stepName: step.name,
        error: { name: 'Error', message: 'fatal' },
        durationMs: step.durationMs,
      });
    }
  }

  events.push(
    opts.status === 'completed'
      ? {
          type: 'flow.complete',
          correlationId: cid,
          flowName: opts.flowName,
          ts: ts++,
          output: {},
          durationMs: opts.totalMs,
        }
      : opts.status === 'failed'
      ? {
          type: 'flow.error',
          correlationId: cid,
          flowName: opts.flowName,
          ts: ts++,
          error: { name: 'Error', message: 'flow failed' },
          durationMs: opts.totalMs,
        }
      : {
          type: 'flow.break',
          correlationId: cid,
          flowName: opts.flowName,
          ts: ts++,
          stepName: opts.steps[opts.steps.length - 1]?.name ?? 'unknown',
          returnValue: { early: true },
          durationMs: opts.totalMs,
        }
  );

  return {
    correlationId: cid,
    flowName: opts.flowName,
    startedAt: 0,
    endedAt: ts,
    durationMs: opts.totalMs,
    status: opts.status,
    events,
  };
}

describe('quantile', () => {
  it('returns 0 for an empty input', () => {
    expect(quantile([], 0.5)).toBe(0);
  });

  it('returns the single value regardless of q', () => {
    expect(quantile([42], 0)).toBe(42);
    expect(quantile([42], 1)).toBe(42);
  });

  it('returns exact ranks when (n-1)*q lands on an integer', () => {
    expect(quantile([10, 20, 30, 40, 50], 0.5)).toBe(30);
    expect(quantile([10, 20, 30, 40, 50], 0)).toBe(10);
    expect(quantile([10, 20, 30, 40, 50], 1)).toBe(50);
  });

  it('linearly interpolates between adjacent values', () => {
    // p95 of [1..100]: (99) * 0.95 = 94.05 -> 94 + 0.05*(95-94) = 94.05; but values are 1..100, so sorted[94] = 95
    // For a simpler witness:
    expect(quantile([0, 10], 0.5)).toBe(5);
    expect(quantile([0, 10, 20, 30], 0.5)).toBe(15);
  });

  it('clamps q outside [0,1]', () => {
    expect(quantile([1, 2, 3], -1)).toBe(1);
    expect(quantile([1, 2, 3], 2)).toBe(3);
  });
});

describe('aggregateExecutions', () => {
  beforeEach(() => {
    cidCounter = 0;
  });

  it('returns an empty array when given no records', () => {
    expect(aggregateExecutions([])).toEqual([]);
  });

  it('groups by flowName and computes top-level counts + p50/p95', () => {
    const records: ExecutionRecord[] = [
      fixtureRecord({
        flowName: 'orders',
        status: 'completed',
        totalMs: 100,
        steps: [{ name: 's1', durationMs: 100 }],
      }),
      fixtureRecord({
        flowName: 'orders',
        status: 'completed',
        totalMs: 200,
        steps: [{ name: 's1', durationMs: 200 }],
      }),
      fixtureRecord({
        flowName: 'orders',
        status: 'failed',
        totalMs: 50,
        steps: [{ name: 's1', durationMs: 50, ended: 'error' }],
      }),
      fixtureRecord({
        flowName: 'users',
        status: 'completed',
        totalMs: 30,
        steps: [{ name: 'fetch', durationMs: 30 }],
      }),
    ];

    const aggregates = aggregateExecutions(records);
    expect(aggregates.map((a) => a.flowName)).toEqual(['orders', 'users']);

    const orders = aggregates.find((a) => a.flowName === 'orders')!;
    expect(orders.runs).toBe(3);
    // Durations [50, 100, 200] sorted → p50 = 100, p95 = 0.95 * 2 = 1.9 → between idx 1 and 2 weight 0.9
    expect(orders.p50).toBe(100);
    expect(orders.p95).toBeCloseTo(100 + 0.9 * (200 - 100), 5);
    expect(orders.errorRate).toBeCloseTo(1 / 3, 5);

    const users = aggregates.find((a) => a.flowName === 'users')!;
    expect(users.runs).toBe(1);
    expect(users.errorRate).toBe(0);
  });

  it('treats `broken` runs as successful for errorRate purposes', () => {
    const records: ExecutionRecord[] = [
      fixtureRecord({
        flowName: 'gate',
        status: 'broken',
        totalMs: 10,
        steps: [{ name: 'check', durationMs: 10 }],
      }),
      fixtureRecord({
        flowName: 'gate',
        status: 'broken',
        totalMs: 12,
        steps: [{ name: 'check', durationMs: 12 }],
      }),
    ];
    expect(aggregateExecutions(records)[0]!.errorRate).toBe(0);
  });

  it('rolls up per-step retries, errors, and duration percentiles', () => {
    const records: ExecutionRecord[] = [
      fixtureRecord({
        flowName: 'orders',
        status: 'completed',
        totalMs: 200,
        steps: [
          { name: 'validate', durationMs: 10 },
          { name: 'charge', durationMs: 100, retries: 2 },
          { name: 'fulfill', durationMs: 90 },
        ],
      }),
      fixtureRecord({
        flowName: 'orders',
        status: 'failed',
        totalMs: 60,
        steps: [
          { name: 'validate', durationMs: 5 },
          { name: 'charge', durationMs: 55, retries: 0, ended: 'error' },
        ],
      }),
    ];

    const orders = aggregateExecutions(records)[0]!;
    const validate = orders.perStep.find((s) => s.stepName === 'validate')!;
    expect(validate.runs).toBe(2);
    expect(validate.errorRate).toBe(0);
    expect(validate.retryRate).toBe(0);
    expect(validate.p50).toBe(7.5);

    const charge = orders.perStep.find((s) => s.stepName === 'charge')!;
    expect(charge.runs).toBe(2);
    // One error out of two runs.
    expect(charge.errorRate).toBe(0.5);
    // Two retries across two runs → 1.0 retries per run.
    expect(charge.retryRate).toBe(1);

    // `fulfill` ran only on the first record.
    const fulfill = orders.perStep.find((s) => s.stepName === 'fulfill')!;
    expect(fulfill.runs).toBe(1);
    expect(fulfill.p50).toBe(90);
    expect(fulfill.p95).toBe(90);
  });

  it('orders flows by run count descending, ties alphabetic', () => {
    const records: ExecutionRecord[] = [
      fixtureRecord({
        flowName: 'zebra',
        status: 'completed',
        totalMs: 10,
        steps: [{ name: 's', durationMs: 10 }],
      }),
      fixtureRecord({
        flowName: 'alpha',
        status: 'completed',
        totalMs: 10,
        steps: [{ name: 's', durationMs: 10 }],
      }),
      fixtureRecord({
        flowName: 'mid',
        status: 'completed',
        totalMs: 10,
        steps: [{ name: 's', durationMs: 10 }],
      }),
      fixtureRecord({
        flowName: 'mid',
        status: 'completed',
        totalMs: 10,
        steps: [{ name: 's', durationMs: 10 }],
      }),
    ];
    expect(aggregateExecutions(records).map((a) => a.flowName)).toEqual([
      'mid',
      'alpha',
      'zebra',
    ]);
  });
});
