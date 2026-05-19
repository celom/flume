/**
 * FlowExecutor handles the actual execution of workflow steps
 */

import { ValidationError, FlowExecutionError, TimeoutError } from './types.js';
import type {
  FlowContext,
  FlowConfig,
  FlowExecutionOptions,
  FlowMeta,
  StepDefinition,
  RetryOptions,
  FlowState,
  BaseFlowDependencies,
  TransactionStepDefinition,
  EventStepDefinition,
  FlowExecutionResult,
  FlowEvent,
  FlowEventPublisher,
  DurabilityOptions,
  FlowCheckpoint,
} from './types.js';

/**
 * @internal
 * Discriminated union describing the four kinds of checkpoint writes.
 * Internal protocol between the executor loop and {@link createCheckpointWriter}
 * — translated into a {@link FlowCheckpoint} before reaching any store.
 *
 * `breakValue` is wrapped in a `{ value }` envelope so that `undefined` can
 * be a valid break return value while still being distinguishable from
 * "this was not a break completion."
 */
type CheckpointWrite =
  | { kind: 'running' }
  | { kind: 'completed'; breakValue?: { value: unknown } }
  | { kind: 'failed'; failedStep: { name: string; error: string } };

/**
 * @internal
 * Build a checkpoint-writer bound to the invariant fields of a single run.
 * Returns a no-op when durability is not configured, so call sites stay
 * branch-free.
 */
function createCheckpointWriter(
  durability: DurabilityOptions | undefined,
  flowName: string,
  input: unknown,
  createdAt: Date
): (
  state: unknown,
  completedSteps: ReadonlySet<string>,
  write: CheckpointWrite
) => Promise<void> {
  if (!durability) {
    return async () => {
      /* no-op */
    };
  }
  return async (state, completedSteps, write) => {
    const status: FlowCheckpoint['status'] =
      write.kind === 'running'
        ? 'running'
        : write.kind === 'failed'
        ? 'failed'
        : 'completed';

    const checkpoint: FlowCheckpoint = {
      flowName,
      runId: durability.runId,
      input,
      state,
      completedSteps: [...completedSteps],
      status,
      createdAt,
      updatedAt: new Date(),
      ...(write.kind === 'completed' && write.breakValue
        ? { breakValue: write.breakValue.value }
        : {}),
      ...(write.kind === 'failed' ? { failedStep: write.failedStep } : {}),
    };
    await durability.store.save(checkpoint);
  };
}

/**
 * Throws if the signal is already aborted.
 * When the abort was caused by a TimeoutError, re-throws the original error.
 */
function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    if (signal.reason instanceof Error) {
      throw signal.reason;
    }
    throw new Error('Flow execution was aborted');
  }
}

/**
 * Races a promise against an AbortSignal.
 * If the signal fires before the promise settles, rejects with the signal's reason.
 */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(
      signal.reason instanceof Error ? signal.reason : new Error('Aborted')
    );
  }

  return new Promise<T>((resolve, reject) => {
    function onAbort() {
      reject(
        signal.reason instanceof Error ? signal.reason : new Error('Aborted')
      );
    }

    signal.addEventListener('abort', onAbort, { once: true });

    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

/**
 * Returns a promise that resolves after `ms` milliseconds,
 * but rejects immediately if the signal is aborted.
 */
function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(
        signal.reason instanceof Error ? signal.reason : new Error('Aborted')
      );
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(
        signal.reason instanceof Error ? signal.reason : new Error('Aborted')
      );
    }

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export class FlowExecutor<
  TInput,
  TDeps extends BaseFlowDependencies,
  TState extends FlowState = Record<string, unknown>
> {
  /**
   * Execute a complete flow from configuration
   * @returns FlowExecutionResult containing the result value and whether flow was short-circuited
   */
  async execute(
    config: FlowConfig<TInput, TDeps, TState>,
    input: TInput,
    deps: TDeps,
    options?: FlowExecutionOptions<TInput, TDeps, TState>
  ): Promise<FlowExecutionResult<TState>> {
    const startTime = Date.now();
    const durability = options?.durability;

    // Load existing checkpoint if durability is configured.
    // If the run already completed, return the saved value without re-executing.
    let checkpoint: FlowCheckpoint | null = null;
    if (durability) {
      checkpoint = await durability.store.load(durability.runId);
      if (checkpoint?.status === 'completed') {
        const hasBreakValue = 'breakValue' in checkpoint;
        return {
          value: (hasBreakValue
            ? checkpoint.breakValue
            : checkpoint.state) as TState,
          didBreak: hasBreakValue,
        };
      }
    }

    // On resume, the checkpoint's input/state/completedSteps are authoritative.
    // The caller's `input` argument is ignored on resume to keep state deterministic.
    const isResuming = checkpoint !== null;
    const effectiveInput = (checkpoint ? checkpoint.input : input) as TInput;
    const completedSteps = new Set<string>(checkpoint?.completedSteps ?? []);
    const originalCreatedAt = checkpoint?.createdAt ?? new Date(startTime);
    const persist = createCheckpointWriter(
      durability,
      config.name,
      effectiveInput,
      originalCreatedAt
    );

    const meta: FlowMeta = {
      flowName: config.name,
      startedAt: new Date(startTime),
      correlationId: options?.correlationId,
      // Durability-only fields. Left undefined when durability isn't configured
      // so handlers can rely on `meta.runId !== undefined` to detect durable runs.
      ...(durability ? { runId: durability.runId, isResuming } : {}),
    };

    const observer = options?.observer;

    // Create the flow-level AbortController
    const flowController = new AbortController();

    // Combine with external signal if provided
    const flowSignal = options?.signal
      ? AbortSignal.any([options.signal, flowController.signal])
      : flowController.signal;

    // Wire flow-level timeout to abort
    let flowTimer: ReturnType<typeof setTimeout> | undefined;
    if (options?.timeout) {
      flowTimer = setTimeout(
        () =>
          flowController.abort(
            new TimeoutError(
              `Flow execution timeout after ${options.timeout}ms`,
              config.name,
              undefined,
              options.timeout
            )
          ),
        options.timeout
      );
    }

    // Initialize context
    let context: FlowContext<TInput, TDeps, TState> = {
      input: Object.freeze(effectiveInput),
      state: (checkpoint?.state ?? {}) as TState,
      deps,
      meta,
      signal: flowSignal,
    };

    // Notify observer of flow start
    observer?.onFlowStart?.(config.name, effectiveInput);

    try {
      // Execute each step in sequence
      for (const step of config.steps) {
        // Check if flow has been aborted before starting next step
        throwIfAborted(flowSignal);

        // Skip steps already recorded as completed in a prior run.
        // Their state is already merged in via the loaded checkpoint.
        if (completedSteps.has(step.name)) {
          continue;
        }

        // Update current step in meta
        context.meta.currentStep = step.name;
        if (durability) {
          context.meta.idempotencyKey = `${durability.runId}:${step.name}`;
        }

        // Check condition if present
        if (step.condition && !step.condition(context)) {
          observer?.onStepSkipped?.(step.name, context);
          // Persist the skip so resume doesn't re-evaluate the condition.
          completedSteps.add(step.name);
          await persist(context.state, completedSteps, { kind: 'running' });
          continue;
        }

        // Handle break step type - short-circuits the flow if condition is met
        if (step.type === 'break') {
          const breakStep = step;
          const stepStart = Date.now();

          observer?.onStepStart?.(step.name, context);

          if (breakStep.breakCondition(context)) {
            // Flow is breaking - compute return value
            const breakResult = breakStep.breakReturnValue
              ? breakStep.breakReturnValue(context)
              : context.state;

            const duration = Date.now() - stepStart;
            const totalDuration = Date.now() - startTime;

            // Persist completed-with-break BEFORE notifying observers, so a
            // crash in observer code doesn't lose the completion record.
            completedSteps.add(step.name);
            await persist(context.state, completedSteps, {
              kind: 'completed',
              breakValue: { value: breakResult },
            });

            // Notify observers
            observer?.onStepComplete?.(
              step.name,
              breakResult,
              duration,
              context
            );
            observer?.onFlowBreak?.(
              config.name,
              step.name,
              breakResult,
              totalDuration
            );

            // Return early, bypassing remaining steps and .map()
            return { value: breakResult as TState, didBreak: true };
          }

          // Condition not met - continue to next step
          const duration = Date.now() - stepStart;
          observer?.onStepComplete?.(
            step.name,
            { __breakConditionMet: false },
            duration,
            context
          );
          completedSteps.add(step.name);
          await persist(context.state, completedSteps, { kind: 'running' });
          continue;
        }

        // Execute step based on type
        const result = await this.executeStep(
          step,
          context,
          deps,
          options,
          flowSignal
        );

        // Merge result into state if applicable
        if (result && typeof result === 'object' && step.type !== 'event') {
          context = {
            ...context,
            state: { ...context.state, ...result },
          };
        }

        // Persist after each successful step. The step is only added to
        // completedSteps AFTER its result has been merged into state — so
        // a crash between handler success and this save will re-run the step.
        completedSteps.add(step.name);
        await persist(context.state, completedSteps, { kind: 'running' });
      }

      // Mark run as completed. Persist BEFORE observer notifications.
      await persist(context.state, completedSteps, { kind: 'completed' });

      // Return the final state as output
      const totalDuration = Date.now() - startTime;
      observer?.onFlowComplete?.(config.name, context.state, totalDuration);

      return { value: context.state, didBreak: false };
    } catch (error) {
      const totalDuration = Date.now() - startTime;

      // Best-effort failure persistence. Swallow store errors here so the
      // original flow error is what the caller sees.
      try {
        await persist(context.state, completedSteps, {
          kind: 'failed',
          failedStep: {
            name: context.meta.currentStep ?? '?',
            error: (error as Error).message,
          },
        });
      } catch {
        // ignore
      }

      observer?.onFlowError?.(config.name, error as Error, totalDuration);

      // If the caller wants no exception, return the partial state
      if (options?.throwOnError === false) {
        return { value: context.state, didBreak: false };
      }

      // By default, re-throw the original error
      throw error;
    } finally {
      // Clean up flow-level timer
      if (flowTimer !== undefined) {
        clearTimeout(flowTimer);
      }
      // Abort any in-flight work (no-op if already aborted)
      flowController.abort();
    }
  }

  /**
   * Execute a single step with retry logic
   */
  private async executeStep(
    step: StepDefinition<TInput, TDeps, TState>,
    context: FlowContext<TInput, TDeps, TState>,
    deps: TDeps,
    options: FlowExecutionOptions<TInput, TDeps, TState> | undefined,
    flowSignal: AbortSignal
  ) {
    const retryOptions = step.retryOptions;

    if (retryOptions) {
      return this.executeWithRetry(
        step,
        context,
        deps,
        retryOptions,
        options,
        flowSignal
      );
    }

    return this.executeSingleStep(step, context, deps, options, flowSignal);
  }

  /**
   * Execute a step with retry logic
   */
  private async executeWithRetry(
    step: StepDefinition<TInput, TDeps, TState>,
    context: FlowContext<TInput, TDeps, TState>,
    deps: TDeps,
    retryOptions: RetryOptions,
    options: FlowExecutionOptions<TInput, TDeps, TState> | undefined,
    flowSignal: AbortSignal
  ) {
    const observer = options?.observer;
    let lastError: Error | undefined;
    let delay = retryOptions.delayMs;

    for (let attempt = 1; attempt <= retryOptions.maxAttempts; attempt++) {
      // Check abort before each attempt
      throwIfAborted(flowSignal);

      try {
        return await this.executeSingleStep(
          step,
          context,
          deps,
          options,
          flowSignal
        );
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if we should retry
        if (retryOptions.shouldRetry && !retryOptions.shouldRetry(lastError)) {
          throw lastError;
        }

        // Don't retry on validation errors
        if (lastError instanceof ValidationError) {
          throw lastError;
        }

        // If this was the last attempt, throw
        if (attempt === retryOptions.maxAttempts) {
          throw lastError;
        }

        // Notify observer of retry
        observer?.onStepRetry?.(
          step.name,
          attempt,
          retryOptions.maxAttempts,
          lastError
        );

        // Wait before retrying (abortable — exits immediately if signal fires)
        await abortableDelay(delay, flowSignal);

        // Calculate next delay with backoff
        if (retryOptions.backoffMultiplier) {
          delay = Math.min(
            delay * retryOptions.backoffMultiplier,
            retryOptions.maxDelayMs || Number.MAX_SAFE_INTEGER
          );
        }
      }
    }

    throw lastError;
  }

  /**
   * Execute a single step without retry
   */
  private async executeSingleStep(
    step: StepDefinition<TInput, TDeps, TState>,
    context: FlowContext<TInput, TDeps, TState>,
    deps: TDeps,
    options: FlowExecutionOptions<TInput, TDeps, TState> | undefined,
    flowSignal: AbortSignal
  ) {
    const observer = options?.observer;
    const stepStart = Date.now();
    const stepTimeout = step.retryOptions?.stepTimeout ?? options?.stepTimeout;

    // Notify observer of step start
    observer?.onStepStart?.(step.name, context);

    // Create per-step abort controller for step-level timeout
    let stepController: AbortController | undefined;
    let stepTimer: ReturnType<typeof setTimeout> | undefined;
    let stepContext = context;

    if (stepTimeout) {
      stepController = new AbortController();
      const stepSignal = AbortSignal.any([flowSignal, stepController.signal]);

      // Give the step handler a signal scoped to this step's lifetime
      stepContext = { ...context, signal: stepSignal };

      stepTimer = setTimeout(
        () =>
          stepController!.abort(
            new TimeoutError(
              `Step '${step.name}' timed out after ${stepTimeout}ms`,
              context.meta.flowName,
              step.name,
              stepTimeout
            )
          ),
        stepTimeout
      );
    }

    try {
      // Create the step execution promise
      const executeStep = async () => {
        switch (step.type) {
          case 'validate': {
            await step.handler(stepContext);
            return undefined;
          }

          case 'step': {
            return await step.handler(stepContext);
          }

          case 'transaction': {
            return await this.executeTransaction(
              step,
              stepContext,
              deps,
              options
            );
          }

          case 'event': {
            return await this.executeEvent(step, stepContext, options);
          }

          default: {
            throw new FlowExecutionError(
              `Unknown step type`,
              context.meta.flowName
            );
          }
        }
      };

      // Race execution against the signal so timeouts and external aborts
      // actually interrupt the wait (not just the underlying operation).
      // We race whenever the signal could fire (step timeout, flow timeout,
      // or external signal). This is a no-op for the common case where the
      // signal never aborts.
      const result = await raceAbort(executeStep(), stepContext.signal);

      // Notify observer of step completion
      const duration = Date.now() - stepStart;
      observer?.onStepComplete?.(step.name, result, duration, context);

      return result;
    } catch (error) {
      // Notify observer of step error
      const duration = Date.now() - stepStart;
      observer?.onStepError?.(step.name, error as Error, duration, context);

      throw error;
    } finally {
      if (stepTimer !== undefined) {
        clearTimeout(stepTimer);
      }
    }
  }

  /**
   * Execute a transaction step
   */
  private async executeTransaction(
    step: TransactionStepDefinition<TInput, TDeps, TState>,
    context: FlowContext<TInput, TDeps, TState>,
    deps: TDeps,
    options?: FlowExecutionOptions<TInput, TDeps, TState>
  ) {
    // Get database instance from deps
    const db = deps.db;

    if (!db) {
      const shouldThrow =
        options?.errorHandling?.throwOnMissingDatabase ?? true;
      const message = `No database found in dependencies for transaction`;

      if (shouldThrow) {
        throw new FlowExecutionError(message, context.meta.flowName, step.name);
      } else {
        console.warn(`[Workflow:${context.meta.flowName}] ${message}`);
        return undefined;
      }
    }

    // Execute within transaction using the DatabaseClient interface
    return await db.transaction(async (tx) => {
      return await step.handler(context, tx);
    });
  }

  /**
   * Execute an event publishing step
   */
  private async executeEvent(
    step: EventStepDefinition<TInput, TDeps, TState>,
    context: FlowContext<TInput, TDeps, TState>,
    options?: FlowExecutionOptions<TInput, TDeps, TState>
  ): Promise<void> {
    // Get event publisher from deps
    const eventPublisher = context.deps.eventPublisher;

    if (!eventPublisher) {
      const shouldThrow =
        options?.errorHandling?.throwOnMissingEventPublisher ?? true;
      const message = `No event publisher found in dependencies`;

      if (shouldThrow) {
        throw new FlowExecutionError(message, context.meta.flowName, step.name);
      } else {
        console.warn(`[Workflow:${context.meta.flowName}] ${message}`);
        return;
      }
    }

    // Validate publisher has required method
    if (typeof eventPublisher.publish !== 'function') {
      throw new FlowExecutionError(
        'Event publisher must have publish() method',
        context.meta.flowName,
        step.name
      );
    }

    // Build events
    const events = await step.handler(context);

    if (!events) {
      return;
    }

    // Publish events to the explicit channel
    const eventsArray = Array.isArray(events) ? events : [events];

    for (const event of eventsArray) {
      if (event && event.eventType) {
        await this.publishEvent(eventPublisher, event, step.channel, context);
      }
    }
  }

  /**
   * Publish a single event to a specific channel
   */
  private async publishEvent(
    publisher: FlowEventPublisher,
    event: FlowEvent,
    channel: string,
    context: FlowContext<TInput, TDeps, TState>
  ): Promise<void> {
    // Add correlation ID if available
    const eventWithMeta = {
      ...event,
      correlationId: context.meta.correlationId,
    };

    await publisher.publish(channel, eventWithMeta);
  }
}
