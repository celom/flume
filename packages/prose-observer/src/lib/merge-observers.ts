import type {
  BaseFlowDependencies,
  FlowObserver,
  FlowState,
} from '@celom/prose';

/**
 * Combine several `FlowObserver`s into one. Every hook on the returned observer
 * fans out to each child observer that implements that hook, in registration
 * order.
 *
 * Why this exists: `flow.execute({ observer })` takes a single observer, so
 * users wanting both `pinoObserver()` and `consoleObserver()` need a glue
 * function. A throwing child observer aborts the fan-out for that hook on
 * that event — by design, since hook failures shouldn't be silently swallowed.
 *
 * Hooks are written out long-hand instead of looped because the generic
 * intersection of all nine hook signatures can't be reduced into a single
 * callable type without forcing the caller through `unknown`.
 */
export function mergeObservers<
  TInput,
  TDeps extends BaseFlowDependencies,
  TState extends FlowState
>(
  ...observers: ReadonlyArray<FlowObserver<TInput, TDeps, TState>>
): FlowObserver<TInput, TDeps, TState> {
  return {
    onFlowStart(flowName, input) {
      for (const o of observers) o.onFlowStart?.(flowName, input);
    },
    onFlowComplete(flowName, output, durationMs) {
      for (const o of observers)
        o.onFlowComplete?.(flowName, output, durationMs);
    },
    onFlowError(flowName, error, durationMs) {
      for (const o of observers) o.onFlowError?.(flowName, error, durationMs);
    },
    onFlowBreak(flowName, breakStepName, returnValue, durationMs) {
      for (const o of observers) {
        o.onFlowBreak?.(flowName, breakStepName, returnValue, durationMs);
      }
    },
    onStepStart(stepName, context) {
      for (const o of observers) o.onStepStart?.(stepName, context);
    },
    onStepComplete(stepName, result, durationMs, context) {
      for (const o of observers) {
        o.onStepComplete?.(stepName, result, durationMs, context);
      }
    },
    onStepError(stepName, error, durationMs, context) {
      for (const o of observers) {
        o.onStepError?.(stepName, error, durationMs, context);
      }
    },
    onStepRetry(stepName, attempt, maxAttempts, error) {
      for (const o of observers) {
        o.onStepRetry?.(stepName, attempt, maxAttempts, error);
      }
    },
    onStepSkipped(stepName, context) {
      for (const o of observers) o.onStepSkipped?.(stepName, context);
    },
  };
}
