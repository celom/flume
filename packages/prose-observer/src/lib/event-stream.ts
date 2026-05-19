import type { ObserverEvent } from './events.js';

export type ExecutionStatus = 'running' | 'completed' | 'failed' | 'broken';

/**
 * Full event log for one `execute()` call. Built up in `EventStream.push()`
 * as events arrive — order is the same order events were emitted.
 */
export interface ExecutionRecord {
  correlationId: string;
  flowName: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  status: ExecutionStatus;
  events: ObserverEvent[];
}

/** Lightweight summary for list endpoints. */
export interface ExecutionSummary {
  correlationId: string;
  flowName: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  status: ExecutionStatus;
}

export type EventSubscriber = (event: ObserverEvent) => void;

/**
 * In-memory event store with a FIFO ring buffer keyed by `correlationId`.
 * Events grouped into `ExecutionRecord`s as they arrive, evicting the oldest
 * execution once the buffer hits `maxExecutions`. Subscribers see every event
 * regardless of eviction — eviction only affects what `getExecution()` /
 * `listExecutions()` can return.
 */
export class EventStream {
  private readonly executions = new Map<string, ExecutionRecord>();
  /** FIFO of correlationIds in insertion order — drives eviction. */
  private readonly order: string[] = [];
  private readonly subscribers = new Set<EventSubscriber>();

  constructor(public readonly maxExecutions: number = 100) {
    if (maxExecutions < 1) {
      throw new RangeError(`maxExecutions must be >= 1, got ${maxExecutions}`);
    }
  }

  push(event: ObserverEvent): void {
    let record = this.executions.get(event.correlationId);
    if (!record) {
      record = {
        correlationId: event.correlationId,
        flowName: event.flowName,
        startedAt: event.ts,
        status: 'running',
        events: [],
      };
      this.executions.set(event.correlationId, record);
      this.order.push(event.correlationId);
      this.evictIfNeeded();
    }

    record.events.push(event);

    switch (event.type) {
      case 'flow.complete':
        record.status = 'completed';
        record.endedAt = event.ts;
        record.durationMs = event.durationMs;
        break;
      case 'flow.error':
        record.status = 'failed';
        record.endedAt = event.ts;
        record.durationMs = event.durationMs;
        break;
      case 'flow.break':
        record.status = 'broken';
        record.endedAt = event.ts;
        record.durationMs = event.durationMs;
        break;
      default:
        break;
    }

    for (const sub of this.subscribers) {
      sub(event);
    }
  }

  /**
   * Subscribe to every event pushed into the stream. Returns an unsubscribe
   * function — call it to stop receiving events.
   */
  subscribe(cb: EventSubscriber): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  getExecution(correlationId: string): ExecutionRecord | undefined {
    return this.executions.get(correlationId);
  }

  /** Full retained records, oldest first. Used by `aggregateExecutions()`. */
  listRecords(): ExecutionRecord[] {
    const out: ExecutionRecord[] = [];
    for (const cid of this.order) {
      const r = this.executions.get(cid);
      if (r) out.push(r);
    }
    return out;
  }

  /** Snapshots of every retained execution, oldest first. */
  listExecutions(): ExecutionSummary[] {
    return this.order.map((cid) => {
      const r = this.executions.get(cid);
      // r is always defined here because `order` and `executions` are kept in lock-step.
      return {
        correlationId: r!.correlationId,
        flowName: r!.flowName,
        startedAt: r!.startedAt,
        endedAt: r!.endedAt,
        durationMs: r!.durationMs,
        status: r!.status,
      };
    });
  }

  /** Drops everything. Mostly useful for tests and `prose console` boot. */
  clear(): void {
    this.executions.clear();
    this.order.length = 0;
  }

  private evictIfNeeded(): void {
    while (this.order.length > this.maxExecutions) {
      const evicted = this.order.shift();
      if (evicted !== undefined) {
        this.executions.delete(evicted);
      }
    }
  }
}
