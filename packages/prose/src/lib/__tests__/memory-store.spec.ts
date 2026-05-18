/**
 * Tests for the in-memory DurabilityStore adapter.
 *
 * Two layers:
 *   1. The shared {@link storeConformanceSuite} verifies the public
 *      {@link DurabilityStore} contract — every adapter must pass these.
 *   2. The adapter-specific block below tests invariants particular to
 *      the in-memory implementation (clone-on-read isolation).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryDurabilityStore } from '../index.js';
import { storeConformanceSuite } from './store-conformance.js';
import type { FlowCheckpoint } from '../index.js';

storeConformanceSuite('MemoryDurabilityStore', () => new MemoryDurabilityStore());

function fixture(): FlowCheckpoint {
  return {
    flowName: 'f',
    runId: 'r1',
    input: { v: 1 },
    state: { v: 1 },
    completedSteps: ['a'],
    status: 'running',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('MemoryDurabilityStore — adapter-specific invariants', () => {
  let store: MemoryDurabilityStore;

  beforeEach(() => {
    store = new MemoryDurabilityStore();
  });

  it('returns cloned state on load — external mutation does not leak back', async () => {
    await store.save(fixture());

    const cp1 = await store.load('r1');
    (cp1!.state as Record<string, unknown>).v = 999;

    const cp2 = await store.load('r1');
    expect((cp2!.state as Record<string, unknown>).v).toBe(1);
  });

  it('clones on save — caller can mutate their copy after saving', async () => {
    const original = fixture();
    await store.save(original);
    (original.state as Record<string, unknown>).v = 999;

    const loaded = await store.load('r1');
    expect((loaded!.state as Record<string, unknown>).v).toBe(1);
  });

  it('size() reports the number of stored runs (test helper)', async () => {
    expect(store.size()).toBe(0);
    await store.save(fixture());
    expect(store.size()).toBe(1);
    await store.delete('r1');
    expect(store.size()).toBe(0);
  });

  it('clear() drops all entries (test helper)', async () => {
    await store.save(fixture());
    await store.save({ ...fixture(), runId: 'r2' });
    expect(store.size()).toBe(2);

    store.clear();
    expect(store.size()).toBe(0);
  });
});
