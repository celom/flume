/**
 * Tests for durability — skip-ahead checkpointing.
 *
 * These tests verify the observable behavior of `flow.execute()` with a
 * `durability` option configured. Where possible, behavior is observed
 * through handler call counts (via vi.fn) and execute() return values —
 * not by inspecting checkpoint internals. Checkpoint contents are asserted
 * only when the checkpoint shape itself is the contract under test.
 *
 * Adapter behavior (clone-on-read, size tracking, etc.) lives in
 * memory-store.spec.ts. The shared adapter conformance suite lives in
 * store-conformance.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFlow, MemoryDurabilityStore } from '../index.js';
import type { FlowEvent } from '../index.js';

type EmptyDeps = Record<string, never>;

describe('Durability', () => {
  let store: MemoryDurabilityStore;

  beforeEach(() => {
    store = new MemoryDurabilityStore();
  });

  describe('first run', () => {
    it('returns final state on successful completion', async () => {
      const flow = createFlow<{ x: number }, EmptyDeps>('test')
        .step('double', (ctx) => ({ doubled: ctx.input.x * 2 }))
        .build();

      const result = await flow.execute(
        { x: 21 },
        {},
        { durability: { store, runId: 'r1' } }
      );

      expect(result).toEqual({ doubled: 42 });
    });

    it('exposes per-step idempotencyKey in ctx.meta', async () => {
      const seenKeys: Array<string | undefined> = [];
      const flow = createFlow<unknown, EmptyDeps>('test')
        .step('alpha', (ctx) => {
          seenKeys.push(ctx.meta.idempotencyKey);
        })
        .step('beta', (ctx) => {
          seenKeys.push(ctx.meta.idempotencyKey);
        })
        .build();

      await flow.execute({}, {}, { durability: { store, runId: 'order-7' } });

      expect(seenKeys).toEqual(['order-7:alpha', 'order-7:beta']);
    });

    it('exposes runId and isResuming=false on a fresh run', async () => {
      let observed: { runId?: string; isResuming?: boolean } | null = null;
      const flow = createFlow<unknown, EmptyDeps>('test')
        .step('a', (ctx) => {
          observed = {
            runId: ctx.meta.runId,
            isResuming: ctx.meta.isResuming,
          };
        })
        .build();

      await flow.execute({}, {}, { durability: { store, runId: 'r1' } });

      expect(observed).toEqual({ runId: 'r1', isResuming: false });
    });
  });

  describe('resume after crash', () => {
    it('does not re-execute completed steps on resume', async () => {
      const a = vi.fn(() => ({ aRan: true }));
      let bAttempts = 0;
      const b = vi.fn(() => {
        bAttempts++;
        if (bAttempts === 1) throw new Error('boom');
        return { bRan: true };
      });
      const c = vi.fn(() => ({ cRan: true }));

      const flow = createFlow<unknown, EmptyDeps>('test')
        .step('a', a)
        .step('b', b)
        .step('c', c)
        .build();

      await expect(
        flow.execute({}, {}, { durability: { store, runId: 'r1' } })
      ).rejects.toThrow('boom');

      // First run: a ran once, b ran once and threw, c didn't run
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);
      expect(c).not.toHaveBeenCalled();

      const result = await flow.execute(
        {},
        {},
        { durability: { store, runId: 'r1' } }
      );

      // Resume: a was NOT re-run, b ran a second time and succeeded, c ran
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(2);
      expect(c).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ aRan: true, bRan: true, cRan: true });
    });

    it('exposes isResuming=true on the resumed execution', async () => {
      const seenResuming: boolean[] = [];
      let firstAttempt = true;
      const flow = createFlow<unknown, EmptyDeps>('test')
        .step('a', (ctx) => {
          seenResuming.push(ctx.meta.isResuming === true);
        })
        .step('b', (ctx) => {
          seenResuming.push(ctx.meta.isResuming === true);
          if (firstAttempt) {
            firstAttempt = false;
            throw new Error('boom');
          }
        })
        .build();

      await expect(
        flow.execute({}, {}, { durability: { store, runId: 'r1' } })
      ).rejects.toThrow();
      await flow.execute({}, {}, { durability: { store, runId: 'r1' } });

      // First run: a → false, b → false. Resume: a is skipped, b → true.
      expect(seenResuming).toEqual([false, false, true]);
    });

    it('uses the saved input on resume, ignoring the input argument', async () => {
      let observedInput: unknown;
      let firstAttempt = true;
      const flow = createFlow<{ value: number }, EmptyDeps>('test')
        .step('a', () => ({ aRan: true }))
        .step('b', (ctx) => {
          observedInput = ctx.input;
          if (firstAttempt) {
            firstAttempt = false;
            throw new Error('boom');
          }
        })
        .build();

      await expect(
        flow.execute({ value: 100 }, {}, { durability: { store, runId: 'r1' } })
      ).rejects.toThrow();

      // Resume with an intentionally different input — should be ignored
      await flow.execute(
        { value: 999 },
        {},
        { durability: { store, runId: 'r1' } }
      );

      expect(observedInput).toEqual({ value: 100 });
    });

    it('preserves createdAt across resumes', async () => {
      let firstAttempt = true;
      const flow = createFlow<unknown, EmptyDeps>('test')
        .step('a', () => ({ aRan: true }))
        .step('b', () => {
          if (firstAttempt) {
            firstAttempt = false;
            throw new Error('boom');
          }
        })
        .build();

      await expect(
        flow.execute({}, {}, { durability: { store, runId: 'r1' } })
      ).rejects.toThrow();
      const afterFailure = await store.load('r1');
      const originalCreatedAt = afterFailure?.createdAt;

      await flow.execute({}, {}, { durability: { store, runId: 'r1' } });
      const afterCompletion = await store.load('r1');

      expect(afterCompletion?.createdAt).toEqual(originalCreatedAt);
    });
  });

  describe('idempotent replay on completed runs', () => {
    it('returns the saved result without re-executing on a completed run', async () => {
      const handler = vi.fn(() => ({ v: 1 }));
      const flow = createFlow<unknown, EmptyDeps>('test')
        .step('a', handler)
        .build();

      const first = await flow.execute(
        {},
        {},
        { durability: { store, runId: 'r1' } }
      );
      expect(handler).toHaveBeenCalledTimes(1);
      expect(first).toEqual({ v: 1 });

      const second = await flow.execute(
        {},
        {},
        { durability: { store, runId: 'r1' } }
      );
      expect(handler).toHaveBeenCalledTimes(1);
      expect(second).toEqual({ v: 1 });
    });
  });

  describe('breakIf interaction', () => {
    it('replays the break value without re-executing the flow', async () => {
      const aHandler = vi.fn(() => ({ shouldBreak: true }));
      const cHandler = vi.fn(() => ({ cRan: true }));

      const flow = createFlow<unknown, EmptyDeps>('test')
        .step('a', aHandler)
        .breakIf(
          (ctx) => ctx.state.shouldBreak === true,
          () => ({ broken: true })
        )
        .step('c', cHandler)
        .build();

      const first = await flow.execute(
        {},
        {},
        { durability: { store, runId: 'r1' } }
      );
      expect(first).toEqual({ broken: true });
      expect(cHandler).not.toHaveBeenCalled();

      const second = await flow.execute(
        {},
        {},
        { durability: { store, runId: 'r1' } }
      );
      expect(second).toEqual({ broken: true });
      // Confirm replay short-circuits the entire execution, not just step c
      expect(aHandler).toHaveBeenCalledTimes(1);
      expect(cHandler).not.toHaveBeenCalled();
    });

    it('a non-breaking breakIf does not block resume of subsequent steps', async () => {
      const cHandler = vi.fn(() => ({ cRan: true }));
      let cAttempt = 0;
      const flakyC = vi.fn(() => {
        cAttempt++;
        if (cAttempt === 1) throw new Error('boom');
        return cHandler();
      });

      const flow = createFlow<unknown, EmptyDeps>('test')
        .step('a', () => ({ shouldBreak: false }))
        .breakIf((ctx) => ctx.state.shouldBreak === true)
        .step('c', flakyC)
        .build();

      await expect(
        flow.execute({}, {}, { durability: { store, runId: 'r1' } })
      ).rejects.toThrow();

      const result = await flow.execute(
        {},
        {},
        { durability: { store, runId: 'r1' } }
      );
      expect(result).toEqual({ shouldBreak: false, cRan: true });
      expect(cHandler).toHaveBeenCalledTimes(1);
      expect(flakyC).toHaveBeenCalledTimes(2);
    });
  });

  describe('conditional steps', () => {
    it('does not re-evaluate a skipped condition on resume', async () => {
      const skippedHandler = vi.fn(() => ({ shouldNotMerge: true }));
      const conditionCheck = vi.fn(
        (ctx: { state: { skip?: boolean } }) => ctx.state.skip !== true
      );
      let firstAttempt = true;
      const flow = createFlow<unknown, EmptyDeps>('test')
        .step('a', () => ({ skip: true }))
        .stepIf('b', conditionCheck, skippedHandler)
        .step('c', () => {
          if (firstAttempt) {
            firstAttempt = false;
            throw new Error('boom');
          }
          return { cRan: true };
        })
        .build();

      await expect(
        flow.execute({}, {}, { durability: { store, runId: 'r1' } })
      ).rejects.toThrow();

      expect(conditionCheck).toHaveBeenCalledTimes(1);
      expect(skippedHandler).not.toHaveBeenCalled();

      await flow.execute({}, {}, { durability: { store, runId: 'r1' } });

      // Condition was recorded as decided; resume must NOT re-evaluate it
      expect(conditionCheck).toHaveBeenCalledTimes(1);
      expect(skippedHandler).not.toHaveBeenCalled();
    });
  });

  describe('step type integration', () => {
    it('checkpoints a retried step once after retries succeed, not per attempt', async () => {
      let attempts = 0;
      const flow = createFlow<unknown, EmptyDeps>('test')
        .step('flaky', () => {
          attempts++;
          if (attempts < 3) throw new Error('transient');
          return { ok: true };
        })
        .withRetry({ maxAttempts: 5, delayMs: 1 })
        .build();

      await flow.execute({}, {}, { durability: { store, runId: 'r1' } });

      expect(attempts).toBe(3);

      // The retry contract: completedSteps grows by exactly one entry for the
      // retried step, regardless of how many attempts it took. This IS the
      // checkpoint contract under test, so direct inspection is appropriate.
      const cp = await store.load('r1');
      expect(cp?.completedSteps).toEqual(['flaky']);
    });

    it('re-runs a transaction on resume when it failed before checkpoint', async () => {
      let txAttempts = 0;
      const db = {
        transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
          txAttempts++;
          return fn({});
        },
      };
      let shouldFail = true;
      const flow = createFlow<unknown, { db: typeof db }>('test')
        .transaction('write', async () => {
          if (shouldFail) {
            shouldFail = false;
            throw new Error('boom');
          }
          return { written: true };
        })
        .build();

      await expect(
        flow.execute({}, { db }, { durability: { store, runId: 'r1' } })
      ).rejects.toThrow();

      const result = await flow.execute(
        {},
        { db },
        { durability: { store, runId: 'r1' } }
      );

      expect(txAttempts).toBe(2);
      expect(result).toEqual({ written: true });
    });

    it('does not re-publish events when replaying a completed run', async () => {
      const published: FlowEvent[] = [];
      const eventPublisher = {
        publish: (_channel: string, event: FlowEvent) => {
          published.push(event);
        },
      };

      const flow = createFlow<
        unknown,
        { eventPublisher: typeof eventPublisher }
      >('test')
        .event('orders', () => ({ eventType: 'order.created' }))
        .build();

      await flow.execute(
        {},
        { eventPublisher },
        { durability: { store, runId: 'r1' } }
      );
      await flow.execute(
        {},
        { eventPublisher },
        { durability: { store, runId: 'r1' } }
      );

      expect(published).toHaveLength(1);
      expect(published[0].eventType).toBe('order.created');
    });

    it('treats a parallel block as atomic — all handlers re-run if any fails', async () => {
      const aCount = vi.fn(() => ({ a: 1 }));
      const bCount = vi.fn(() => ({ b: 2 }));
      let cShouldFail = true;
      const cCount = vi.fn(() => {
        if (cShouldFail) {
          cShouldFail = false;
          throw new Error('boom');
        }
        return { c: 3 };
      });

      const flow = createFlow<unknown, EmptyDeps>('test')
        .parallel('fanout', 'shallow', aCount, bCount, cCount)
        .build();

      await expect(
        flow.execute({}, {}, { durability: { store, runId: 'r1' } })
      ).rejects.toThrow();

      expect(aCount).toHaveBeenCalledTimes(1);
      expect(bCount).toHaveBeenCalledTimes(1);
      expect(cCount).toHaveBeenCalledTimes(1);

      const result = await flow.execute(
        {},
        {},
        { durability: { store, runId: 'r1' } }
      );

      // Parallel is atomic: all three handlers re-run on resume, not just c
      expect(aCount).toHaveBeenCalledTimes(2);
      expect(bCount).toHaveBeenCalledTimes(2);
      expect(cCount).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ a: 1, b: 2, c: 3 });
    });
  });

  describe('zero-impact when durability is absent', () => {
    it('writes nothing to any store when no durability option is passed', async () => {
      const flow = createFlow<unknown, EmptyDeps>('test')
        .step('a', () => ({ v: 1 }))
        .build();

      const result = await flow.execute({}, {});
      expect(result).toEqual({ v: 1 });
      expect(store.size()).toBe(0);
    });

    it('does not expose runId, idempotencyKey, or isResuming in meta', async () => {
      let captured: {
        runId?: string;
        idempotencyKey?: string;
        isResuming?: boolean;
      } | null = null;
      const flow = createFlow<unknown, EmptyDeps>('test')
        .step('a', (ctx) => {
          captured = {
            runId: ctx.meta.runId,
            idempotencyKey: ctx.meta.idempotencyKey,
            isResuming: ctx.meta.isResuming,
          };
        })
        .build();

      await flow.execute({}, {});

      expect(captured).not.toBeNull();
      expect(captured!.runId).toBeUndefined();
      expect(captured!.idempotencyKey).toBeUndefined();
      expect(captured!.isResuming).toBeUndefined();
    });
  });
});
