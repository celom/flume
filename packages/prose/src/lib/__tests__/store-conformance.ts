/**
 * Shared conformance suite for {@link DurabilityStore} implementations.
 *
 * Used by every adapter's spec file to verify the public contract is upheld.
 * Not exported from the package's main entry — adapter packages in this repo
 * import via deep path; external adapter authors can copy or vendor this file.
 *
 * The suite uses only the public {@link DurabilityStore} surface — adapter-
 * specific invariants (e.g. clone-on-read for in-memory implementations)
 * should be tested separately in the adapter's own spec.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { DurabilityStore, FlowCheckpoint } from '../types.js';

function fixture(overrides: Partial<FlowCheckpoint> = {}): FlowCheckpoint {
  const now = new Date('2026-01-01T00:00:00Z');
  return {
    flowName: 'fixture-flow',
    runId: 'fixture-run',
    input: { value: 1 },
    state: { ranA: true },
    completedSteps: ['a'],
    status: 'running',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function storeConformanceSuite(
  name: string,
  makeStore: () => DurabilityStore
): void {
  describe(`DurabilityStore conformance: ${name}`, () => {
    let store: DurabilityStore;

    beforeEach(() => {
      store = makeStore();
    });

    it('load() returns null for an unknown runId', async () => {
      expect(await store.load('no-such-run')).toBeNull();
    });

    it('save() then load() round-trips the checkpoint', async () => {
      const cp = fixture({ runId: 'r1' });
      await store.save(cp);

      const loaded = await store.load('r1');
      expect(loaded).not.toBeNull();
      expect(loaded?.flowName).toBe('fixture-flow');
      expect(loaded?.runId).toBe('r1');
      expect(loaded?.input).toEqual({ value: 1 });
      expect(loaded?.state).toEqual({ ranA: true });
      expect(loaded?.completedSteps).toEqual(['a']);
      expect(loaded?.status).toBe('running');
    });

    it('save() overwrites an existing entry for the same runId', async () => {
      await store.save(fixture({ runId: 'r1', status: 'running' }));
      await store.save(
        fixture({ runId: 'r1', status: 'completed', state: { final: true } })
      );

      const loaded = await store.load('r1');
      expect(loaded?.status).toBe('completed');
      expect(loaded?.state).toEqual({ final: true });
    });

    it('save() preserves the failedStep field when present', async () => {
      await store.save(
        fixture({
          runId: 'r1',
          status: 'failed',
          failedStep: { name: 'chargePayment', error: 'declined' },
        })
      );

      const loaded = await store.load('r1');
      expect(loaded?.status).toBe('failed');
      expect(loaded?.failedStep).toEqual({
        name: 'chargePayment',
        error: 'declined',
      });
    });

    it('save() preserves the breakValue field when present (including undefined values)', async () => {
      // breakValue may legitimately be undefined; the field's presence is
      // what distinguishes "broke" from "completed normally".
      await store.save(
        fixture({
          runId: 'normal',
          status: 'completed',
        })
      );
      await store.save(
        fixture({
          runId: 'broke-with-value',
          status: 'completed',
          breakValue: { broken: true },
        })
      );

      const normal = await store.load('normal');
      const broken = await store.load('broke-with-value');

      expect('breakValue' in (normal ?? {})).toBe(false);
      expect(broken?.breakValue).toEqual({ broken: true });
    });

    it('delete() removes the entry', async () => {
      await store.save(fixture({ runId: 'r1' }));
      expect(await store.load('r1')).not.toBeNull();

      await store.delete('r1');
      expect(await store.load('r1')).toBeNull();
    });

    it('delete() of a non-existent runId is a no-op', async () => {
      await expect(store.delete('never-existed')).resolves.not.toThrow();
    });

    it('isolates runIds — saving one does not affect another', async () => {
      await store.save(fixture({ runId: 'a', state: { for: 'a' } }));
      await store.save(fixture({ runId: 'b', state: { for: 'b' } }));

      expect((await store.load('a'))?.state).toEqual({ for: 'a' });
      expect((await store.load('b'))?.state).toEqual({ for: 'b' });

      await store.delete('a');
      expect(await store.load('a')).toBeNull();
      expect(await store.load('b')).not.toBeNull();
    });
  });
}
