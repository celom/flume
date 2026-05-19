/**
 * In-memory DurabilityStore — intended for tests, single-process dev, and
 * as a reference implementation for adapter authors.
 *
 * For production single-node use, prefer a SQLite-backed store. For multi-
 * worker deployments, use Postgres or another shared store.
 */

import type { DurabilityStore, FlowCheckpoint } from './types.js';

function clone(checkpoint: FlowCheckpoint): FlowCheckpoint {
  return structuredClone(checkpoint);
}

export class MemoryDurabilityStore implements DurabilityStore {
  private readonly checkpoints = new Map<string, FlowCheckpoint>();

  async load(runId: string): Promise<FlowCheckpoint | null> {
    const cp = this.checkpoints.get(runId);
    return cp ? clone(cp) : null;
  }

  async save(checkpoint: FlowCheckpoint): Promise<void> {
    this.checkpoints.set(checkpoint.runId, clone(checkpoint));
  }

  async delete(runId: string): Promise<void> {
    this.checkpoints.delete(runId);
  }

  /** Test helper: number of stored runs. */
  size(): number {
    return this.checkpoints.size;
  }

  /** Test helper: synchronous snapshot of a checkpoint (returns a clone). */
  snapshot(runId: string): FlowCheckpoint | null {
    const cp = this.checkpoints.get(runId);
    return cp ? clone(cp) : null;
  }

  /** Test helper: drop everything. */
  clear(): void {
    this.checkpoints.clear();
  }
}
