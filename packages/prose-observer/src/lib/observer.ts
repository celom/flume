import type {
  BaseFlowDependencies,
  FlowObserver,
  FlowState,
} from '@celom/prose';

/**
 * Options for `consoleObserver()`. Slice 1 ships a placeholder; the full
 * shape (port, redaction, ring size, state capture, autoStart) lands in Slice 2.
 */
export interface ConsoleObserverOptions {
  /** Reserved for future slices. No-op in Slice 1. */
  port?: number;
}

/**
 * Factory returning a `FlowObserver` instance backed by the Prose Console.
 *
 * Slice 1 returns a no-op observer to lock in the public type and lifecycle.
 * Slice 2 replaces the body with the real `ConsoleObserverImpl` (ring buffer,
 * redaction, correlation, diff) and Slice 4 starts the HTTP/WS server.
 */
export function consoleObserver<
  TInput = unknown,
  TDeps extends BaseFlowDependencies = BaseFlowDependencies,
  TState extends FlowState = FlowState,
>(_options: ConsoleObserverOptions = {}): FlowObserver<TInput, TDeps, TState> {
  return {};
}
