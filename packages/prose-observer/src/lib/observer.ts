import type {
  BaseFlowDependencies,
  FlowContext,
  FlowObserver,
  FlowState,
} from '@celom/prose';

import {
  generateCorrelationId,
  warnMissingCorrelationIdOnce,
} from './correlation.js';
import { shallowStateDiff } from './diff.js';
import { EventStream } from './event-stream.js';
import type { ObserverEvent, SerializedError, StateCapture } from './events.js';
import { buildRedactKeySet, redactDeep } from './redact.js';

export type StateCaptureMode = 'diff' | 'full' | 'off';

export interface ConsoleObserverOptions {
  /**
   * Max number of executions kept in the in-memory ring buffer. Older
   * executions evict once this is exceeded. Default: 100.
   */
  maxExecutions?: number;
  /**
   * How much state to attach to each `step.complete` event. Default: `'diff'`.
   * - `'diff'` — added/removed/changed keys (shallow).
   * - `'full'` — entire before/after state snapshots (memory-heavy on large state).
   * - `'off'`  — nothing.
   */
  stateCapture?: StateCaptureMode;
  /**
   * Final transform applied to every event after the default redaction pass.
   * Use to redact extra keys, drop noisy event types, or annotate events with
   * downstream-system identifiers. Return `null` to drop the event entirely.
   */
  redact?: (event: ObserverEvent) => ObserverEvent | null;
}

/**
 * The returned shape of `consoleObserver()` — a `FlowObserver` plus a handle
 * to the underlying `EventStream` so callers (the HTTP server, tests) can
 * query and subscribe.
 */
export interface ConsoleObserver<
  TInput = unknown,
  TDeps extends BaseFlowDependencies = BaseFlowDependencies,
  TState extends FlowState = FlowState
> extends FlowObserver<TInput, TDeps, TState> {
  readonly events: EventStream;
}

/**
 * `FlowObserver` implementation that converts every hook into an
 * `ObserverEvent` and pushes it through an `EventStream`. The observer also
 * owns the stream — `myObserver.events` is the read/subscribe surface used by
 * the HTTP server (slice 4) and by tests.
 */
export class ConsoleObserverImpl<
  TInput = unknown,
  TDeps extends BaseFlowDependencies = BaseFlowDependencies,
  TState extends FlowState = FlowState
> implements ConsoleObserver<TInput, TDeps, TState>
{
  readonly events: EventStream;
  private readonly stateCaptureMode: StateCaptureMode;
  private readonly redactKeys: ReadonlySet<string>;
  private readonly userRedact?: (event: ObserverEvent) => ObserverEvent | null;
  /** Latch for the once-per-process oversized-state warning under `stateCapture: 'full'`. */
  private warnedFullStateSize = false;
  /**
   * Map<flowName, correlationId> for the *currently running* flow with that
   * name. Concurrent runs of the same flow share a slot — see the v1
   * limitation in `docs/console/brainstorm.md`.
   */
  private readonly currentByFlow = new Map<string, string>();

  constructor(options: ConsoleObserverOptions = {}) {
    this.events = new EventStream(options.maxExecutions ?? 100);
    this.stateCaptureMode = options.stateCapture ?? 'diff';
    this.redactKeys = buildRedactKeySet();
    this.userRedact = options.redact;
  }

  onFlowStart(flowName: string, input: TInput): void {
    const cid = generateCorrelationId();
    this.currentByFlow.set(flowName, cid);
    this.emit({
      type: 'flow.start',
      correlationId: cid,
      flowName,
      ts: Date.now(),
      input,
    });
  }

  onFlowComplete(
    flowName: string,
    output: TState,
    totalDuration: number
  ): void {
    const cid = this.takeCorrelationId(flowName);
    this.emit({
      type: 'flow.complete',
      correlationId: cid,
      flowName,
      ts: Date.now(),
      output,
      durationMs: totalDuration,
    });
  }

  onFlowError(flowName: string, error: Error, totalDuration: number): void {
    const cid = this.takeCorrelationId(flowName);
    this.emit({
      type: 'flow.error',
      correlationId: cid,
      flowName,
      ts: Date.now(),
      error: serializeError(error),
      durationMs: totalDuration,
    });
  }

  onFlowBreak(
    flowName: string,
    breakStepName: string,
    returnValue: unknown,
    totalDuration: number
  ): void {
    const cid = this.takeCorrelationId(flowName);
    this.emit({
      type: 'flow.break',
      correlationId: cid,
      flowName,
      ts: Date.now(),
      stepName: breakStepName,
      returnValue,
      durationMs: totalDuration,
    });
  }

  onStepStart(
    stepName: string,
    context: FlowContext<TInput, TDeps, TState>
  ): void {
    if (context.meta.correlationId === undefined) {
      warnMissingCorrelationIdOnce();
    }
    this.emit({
      type: 'step.start',
      correlationId: this.cidFor(context.meta.flowName),
      flowName: context.meta.flowName,
      ts: Date.now(),
      stepName,
    });
  }

  onStepComplete(
    stepName: string,
    result: unknown,
    duration: number,
    context: FlowContext<TInput, TDeps, TState>
  ): void {
    const stateAfter = this.applyResultToState(context.state, result);
    const state = this.captureState(context.state, stateAfter);
    this.emit({
      type: 'step.complete',
      correlationId: this.cidFor(context.meta.flowName),
      flowName: context.meta.flowName,
      ts: Date.now(),
      stepName,
      result,
      durationMs: duration,
      state,
    });
  }

  onStepError(
    stepName: string,
    error: Error,
    duration: number,
    context: FlowContext<TInput, TDeps, TState>
  ): void {
    this.emit({
      type: 'step.error',
      correlationId: this.cidFor(context.meta.flowName),
      flowName: context.meta.flowName,
      ts: Date.now(),
      stepName,
      error: serializeError(error),
      durationMs: duration,
    });
  }

  onStepRetry(
    stepName: string,
    attempt: number,
    maxAttempts: number,
    error: Error
  ): void {
    // No context on this hook; correlate via the most recent flow.
    // If no flow is active (shouldn't happen mid-flight), skip rather than
    // emit an orphan event.
    const flowName = this.guessFlowNameForOrphanHook();
    if (flowName === undefined) return;
    this.emit({
      type: 'step.retry',
      correlationId: this.cidFor(flowName),
      flowName,
      ts: Date.now(),
      stepName,
      attempt,
      maxAttempts,
      error: serializeError(error),
    });
  }

  onStepSkipped(
    stepName: string,
    context: FlowContext<TInput, TDeps, TState>
  ): void {
    this.emit({
      type: 'step.skipped',
      correlationId: this.cidFor(context.meta.flowName),
      flowName: context.meta.flowName,
      ts: Date.now(),
      stepName,
    });
  }

  // ──────────────────────────────────────────────────────────
  // Internals

  private emit(event: ObserverEvent): void {
    const defaulted = redactDeep(event, this.redactKeys) as ObserverEvent;
    const final = this.userRedact ? this.userRedact(defaulted) : defaulted;
    if (final === null || final === undefined) return;
    this.events.push(final);
  }

  private cidFor(flowName: string): string {
    let cid = this.currentByFlow.get(flowName);
    if (!cid) {
      // Orphaned event (flow event arrived before we saw onFlowStart, or
      // after takeCorrelationId() already removed it). Generate a fresh id
      // so the event at least lands somewhere in the stream rather than
      // dropping silently.
      cid = generateCorrelationId();
      this.currentByFlow.set(flowName, cid);
    }
    return cid;
  }

  private takeCorrelationId(flowName: string): string {
    const cid = this.cidFor(flowName);
    this.currentByFlow.delete(flowName);
    return cid;
  }

  private guessFlowNameForOrphanHook(): string | undefined {
    // The retry hook has no context. There's no perfect answer for which
    // flow it belongs to when several are running concurrently, but in the
    // common single-flow case the only entry in currentByFlow is the right
    // one. Pick the most-recently-started flow as a heuristic.
    let lastFlow: string | undefined;
    for (const flow of this.currentByFlow.keys()) lastFlow = flow;
    return lastFlow;
  }

  private applyResultToState(state: unknown, result: unknown): unknown {
    if (
      result !== null &&
      typeof result === 'object' &&
      !Array.isArray(result)
    ) {
      const base = state && typeof state === 'object' ? state : {};
      return {
        ...(base as Record<string, unknown>),
        ...(result as Record<string, unknown>),
      };
    }
    return state;
  }

  private captureState(
    before: unknown,
    after: unknown
  ): StateCapture | undefined {
    if (this.stateCaptureMode === 'off') return undefined;
    if (this.stateCaptureMode === 'full') {
      this.maybeWarnFullStateSize(after);
      return { mode: 'full', before, after };
    }
    return { mode: 'diff', diff: shallowStateDiff(before, after) };
  }

  /**
   * Surfaces a one-shot console.warn when `stateCapture: 'full'` is dumping
   * very large state snapshots — these accumulate in the ring buffer and on
   * every WS frame, so callers should know to switch to `'diff'`.
   *
   * 1MB is rough on purpose: JSON.stringify gives us byte-ish cost; the
   * goal is "you'll notice in DevTools," not exact measurement.
   */
  private maybeWarnFullStateSize(state: unknown): void {
    if (this.warnedFullStateSize) return;
    let bytes = 0;
    try {
      bytes = JSON.stringify(state ?? null).length;
    } catch {
      // Cyclic state — punt; the redaction pass will neutralise it anyway.
      return;
    }
    if (bytes > 1_000_000) {
      this.warnedFullStateSize = true;
      console.warn(
        `[prose-observer] stateCapture: 'full' is snapshotting ${bytes} bytes of state. ` +
          `This is held in the ring buffer and streamed over WS. ` +
          `Consider stateCapture: 'diff' (default) to reduce memory pressure. ` +
          `(warning shown once per process)`
      );
    }
  }
}

function serializeError(err: Error): SerializedError {
  return {
    name: err.name,
    message: err.message,
    stack: err.stack,
  };
}

/**
 * Factory for the in-process observer.
 *
 * Returns a `FlowObserver` that pushes every hook through an internal
 * `EventStream`. Inspect via `observer.events.listExecutions()` /
 * `observer.events.getExecution(correlationId)`.
 *
 * The HTTP/WS server (slice 4) and CLI (slice 10) are wired in subsequent
 * slices; this factory is already the same shape they will hand back.
 */
export function consoleObserver<
  TInput = unknown,
  TDeps extends BaseFlowDependencies = BaseFlowDependencies,
  TState extends FlowState = FlowState
>(
  options: ConsoleObserverOptions = {}
): ConsoleObserver<TInput, TDeps, TState> {
  return new ConsoleObserverImpl<TInput, TDeps, TState>(options);
}
