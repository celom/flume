/**
 * Core type definitions for the workflow library
 */

import { FlowObserver } from './observer.js';

// ──────────────────────────────────────────────────────────
// Database interfaces
// ──────────────────────────────────────────────────────────

/**
 * A database client capable of running transactions.
 *
 * Generic over the transaction client type so the full chain
 * `DatabaseClient<TTx>` → `TxClient<TDb>` stays connected.
 *
 * Any ORM / driver that exposes a `transaction()` method satisfies this
 * (e.g. Drizzle, Knex, Prisma).
 */
export interface DatabaseClient<TTx = unknown> {
  transaction<T>(fn: (tx: TTx) => Promise<T>): Promise<T>;
}

/**
 * Helper type to extract the transaction client type from the dependencies
 */
export type TxClientOf<TDeps extends BaseFlowDependencies> = TDeps extends {
  db: DatabaseClient<infer TTx>;
}
  ? TTx
  : unknown;

// ──────────────────────────────────────────────────────────
// Event interfaces
// ──────────────────────────────────────────────────────────

/**
 * A flow event that can be published.
 *
 * Only `eventType` is required by the framework; everything else is
 * pass-through data attached by the application.
 */
export interface FlowEvent {
  eventType: string;
  [key: string]: unknown;
}

/**
 * An event publisher capable of publishing events to named channels.
 */
export interface FlowEventPublisher {
  publish(channel: string, event: FlowEvent): Promise<void> | void;
}

// ──────────────────────────────────────────────────────────
// Durability interfaces
// ──────────────────────────────────────────────────────────

/**
 * Persistent state of a single flow run. The store reads/writes this object
 * verbatim — adapters are responsible for serialization (typically JSON).
 *
 * Steps may run more than once across resumes if the process dies between
 * a step's success and its checkpoint write. Handlers must therefore be
 * idempotent — typically by passing `ctx.meta.idempotencyKey` to external
 * APIs that support it.
 */
export interface FlowCheckpoint {
  flowName: string;
  runId: string;
  /** The input the flow was first started with. Used verbatim on resume. */
  input: unknown;
  /** Accumulated state at the moment of the last successful step. */
  state: unknown;
  /** Names of steps that have completed (or been skipped by condition). */
  completedSteps: string[];
  status: 'running' | 'completed' | 'failed';
  /**
   * When status is 'completed' AND the flow short-circuited via breakIf,
   * holds the break return value (bypasses .map()).
   * Distinct from `state`: a flow completing normally has `breakValue === undefined`.
   */
  breakValue?: unknown;
  /** When status is 'failed', the step that errored after all retries. */
  failedStep?: { name: string; error: string };
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Pluggable durability store. Adapters may live in separate packages
 * (e.g. @celom/prose-store-sqlite, @celom/prose-store-postgres).
 *
 * Implementations should serialize checkpoints atomically — partial writes
 * defeat the purpose. Adapters MAY clone on read/write to prevent the
 * executor from mutating stored state.
 */
export interface DurabilityStore {
  /** Return the checkpoint for `runId`, or `null` if none exists. */
  load(runId: string): Promise<FlowCheckpoint | null>;
  /** Persist the checkpoint, overwriting any existing entry for the same runId. */
  save(checkpoint: FlowCheckpoint): Promise<void>;
  /** Remove the checkpoint. Optional housekeeping for callers. */
  delete(runId: string): Promise<void>;
}

/**
 * Durability configuration for a flow execution.
 *
 * Passing the same `runId` to `execute()` after a crash resumes from the
 * next undone step. Passing the same `runId` after completion returns the
 * saved result without re-executing.
 */
export interface DurabilityOptions {
  store: DurabilityStore;
  /**
   * Stable identifier for this run. Same runId → resume or replay; new runId → fresh run.
   * Typically derived from a business identifier (e.g., the order ID).
   */
  runId: string;
}

/**
 * Base dependencies required by all flows. Extend this with additional dependencies
 */
export type BaseFlowDependencies = {
  db?: DatabaseClient;
  eventPublisher?: FlowEventPublisher;
};

export type FlowState = Record<string, unknown>;

/**
 * Flow metadata tracked during execution
 */
export interface FlowMeta {
  flowName: string;
  startedAt: Date;
  currentStep?: string;
  correlationId?: string;
  /**
   * Stable per-step idempotency key (`${runId}:${currentStep}`).
   * Present only when durability is configured. Pass this to external APIs
   * that support idempotency (Stripe, SQS, etc.) so re-runs are safe.
   */
  idempotencyKey?: string;
  /** The DurabilityOptions.runId for this execution, if durability is configured. */
  runId?: string;
  /** True when this execution loaded an existing checkpoint rather than starting fresh. */
  isResuming?: boolean;
}

/**
 * Context passed to each step in the flow
 */
export interface FlowContext<
  TInput,
  TDeps extends BaseFlowDependencies,
  TState extends FlowState
> {
  readonly input: Readonly<TInput>;
  state: TState;
  deps: TDeps;
  meta: FlowMeta;
  /** AbortSignal for cooperative cancellation. Aborted on timeout or external signal. */
  signal: AbortSignal;
}

/**
 * Result of a step execution
 */
export type StepResult<T> = T | void | undefined;

/**
 * Condition checker for conditional steps
 */
export type StepCondition<
  TInput,
  TDeps extends BaseFlowDependencies,
  TState extends FlowState
> = (ctx: FlowContext<TInput, TDeps, TState>) => boolean;

/**
 * Error handling configuration for flow execution
 */
export interface ErrorHandlingConfig {
  /** Throw error if event publisher is missing (default: true) */
  throwOnMissingEventPublisher?: boolean;
  /** Throw error if database is missing for transaction (default: true) */
  throwOnMissingDatabase?: boolean;
}

/**
 * Options for flow execution
 */
export interface FlowExecutionOptions<
  TInput,
  TDeps extends BaseFlowDependencies,
  TState extends FlowState
> {
  correlationId?: string;
  throwOnError?: boolean;
  /** Timeout in milliseconds for the entire flow */
  timeout?: number;
  /** Timeout in milliseconds for individual steps */
  stepTimeout?: number;
  /** External AbortSignal for caller-driven cancellation */
  signal?: AbortSignal;
  observer?: FlowObserver<TInput, TDeps, TState>;
  errorHandling?: ErrorHandlingConfig;
  /**
   * Opt-in durability. When set, each successful step persists a checkpoint
   * to the configured store. Re-invoking execute() with the same runId
   * resumes from the next undone step (or returns the saved result if the
   * run already completed).
   */
  durability?: DurabilityOptions;
}

/**
 * Base properties shared by all step types
 */
interface BaseStepDefinition<
  TInput,
  TDeps extends BaseFlowDependencies,
  TState extends FlowState
> {
  name: string;
  condition?: StepCondition<TInput, TDeps, TState>;
  retryOptions?: RetryOptions;
}

/**
 * Validation step - validates input or state without returning data
 */
export interface ValidationStepDefinition<
  TInput,
  TDeps extends BaseFlowDependencies,
  TState extends FlowState
> extends BaseStepDefinition<TInput, TDeps, TState> {
  type: 'validate';
  handler: (ctx: FlowContext<TInput, TDeps, TState>) => void | Promise<void>;
}

/**
 * Executor step - performs work and returns state to merge
 */
export interface ExecutorStepDefinition<
  TInput,
  TDeps extends BaseFlowDependencies,
  TState extends FlowState
> extends BaseStepDefinition<TInput, TDeps, TState> {
  type: 'step';
  handler: (
    ctx: FlowContext<TInput, TDeps, TState>
  ) => StepResult<unknown> | Promise<StepResult<unknown>>;
}

/**
 * Transaction step - performs work within a database transaction
 */
export interface TransactionStepDefinition<
  TInput,
  TDeps extends BaseFlowDependencies,
  TState extends FlowState
> extends BaseStepDefinition<TInput, TDeps, TState> {
  type: 'transaction';
  handler: (
    ctx: FlowContext<TInput, TDeps, TState>,
    tx: unknown
  ) => unknown | Promise<unknown>;
}

/**
 * Event step - publishes events to a specific channel
 */
export interface EventStepDefinition<
  TInput,
  TDeps extends BaseFlowDependencies,
  TState extends FlowState
> extends BaseStepDefinition<TInput, TDeps, TState> {
  type: 'event';
  channel: string;
  handler: (
    ctx: FlowContext<TInput, TDeps, TState>
  ) => FlowEvent | FlowEvent[] | void | Promise<FlowEvent | FlowEvent[] | void>;
}

/**
 * Break condition checker for short-circuit flow termination
 */
export type BreakCondition<
  TInput,
  TDeps extends BaseFlowDependencies,
  TState extends FlowState
> = (ctx: FlowContext<TInput, TDeps, TState>) => boolean;

/**
 * Break return value generator
 */
export type BreakReturnValue<
  TInput,
  TDeps extends BaseFlowDependencies,
  TState extends FlowState,
  TBreakOutput
> = (ctx: FlowContext<TInput, TDeps, TState>) => TBreakOutput;

/**
 * Break step - short-circuits the flow if condition is met
 *
 * @example
 * .step('validateToken', validateVerificationTokenStep)
 * .breakIf(
 *   (ctx) => ctx.state.alreadyVerified,
 *   (ctx) => ({ success: true, alreadyVerified: true })
 * )
 */
export interface BreakStepDefinition<
  TInput,
  TDeps extends BaseFlowDependencies,
  TState extends FlowState
> extends BaseStepDefinition<TInput, TDeps, TState> {
  type: 'break';
  breakCondition: BreakCondition<TInput, TDeps, TState>;
  breakReturnValue?: BreakReturnValue<TInput, TDeps, TState, unknown>;
}

/**
 * Discriminated union of all step types
 */
export type StepDefinition<
  TInput,
  TDeps extends BaseFlowDependencies,
  TState extends FlowState
> =
  | ValidationStepDefinition<TInput, TDeps, TState>
  | ExecutorStepDefinition<TInput, TDeps, TState>
  | TransactionStepDefinition<TInput, TDeps, TState>
  | EventStepDefinition<TInput, TDeps, TState>
  | BreakStepDefinition<TInput, TDeps, TState>;

/**
 * Merge strategy for parallel execution
 * - 'shallow': Default - later results override earlier ones (silent overwrites)
 * - 'error-on-conflict': Throw error if keys conflict between results
 * - 'deep': Perform deep merge of nested objects
 */
export type MergeStrategy = 'shallow' | 'error-on-conflict' | 'deep';

/**
 * Retry configuration for a step
 */
export interface RetryOptions {
  maxAttempts: number;
  delayMs: number;
  backoffMultiplier?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: Error) => boolean;
  /** Timeout in milliseconds for this specific step (overrides flow-level stepTimeout) */
  stepTimeout?: number;
}

/**
 * Timeout configuration for flow or step execution
 */
export interface TimeoutOptions {
  /** Timeout in milliseconds for the entire flow */
  timeout?: number;
  /** Timeout in milliseconds for individual steps (overrides flow timeout for steps) */
  stepTimeout?: number;
}

/**
 * Error thrown when a step or flow times out
 */
export class TimeoutError extends Error {
  constructor(
    message: string,
    public flowName: string,
    public stepName?: string,
    public timeoutMs?: number
  ) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Internal result from flow executor indicating whether flow completed normally or short-circuited
 */
export interface FlowExecutionResult<TState> {
  /** The result value (either accumulated state or break return value) */
  value: TState;
  /** Whether the flow was short-circuited via breakIf */
  didBreak: boolean;
}

/**
 * Flow configuration - just the definition without execution
 */
export interface FlowConfig<
  TInput,
  TDeps extends BaseFlowDependencies,
  TState extends FlowState
> {
  name: string;
  steps: StepDefinition<TInput, TDeps, TState>[];
}

/**
 * Helper type to infer the correct output type
 * Uses tuple wrapping to properly handle the never type
 */
export type InferFlowOutput<TState, TMapperOutput> = [TMapperOutput] extends [
  never
]
  ? TState
  : TMapperOutput;

/**
 * Flow definition containing all steps and execution method
 */
export interface FlowDefinition<
  TInput,
  TDeps extends BaseFlowDependencies,
  TState extends FlowState,
  TMapperOutput = never,
  TBreakOutputs = never
> {
  name: string;
  steps: StepDefinition<TInput, TDeps, TState>[];
  execute: (
    input: TInput,
    deps: TDeps,
    options?: FlowExecutionOptions<TInput, TDeps, TState>
  ) => Promise<InferFlowOutput<TState, TMapperOutput> | TBreakOutputs>;
}

/**
 * Validation issue details
 */
export interface ValidationIssue {
  field: string;
  message: string;
  value?: unknown;
}

/**
 * Error thrown during validation
 * Supports both single field errors and multiple validation issues
 */
export class ValidationError extends Error {
  public readonly issues: ValidationIssue[];

  constructor(message: string, issues?: ValidationIssue[] | string) {
    super(message);
    this.name = 'ValidationError';

    if (typeof issues === 'string') {
      // Single field error (backward compatible)
      this.issues = [{ field: issues, message }];
    } else if (Array.isArray(issues)) {
      this.issues = issues;
    } else {
      // No field specified
      this.issues = [{ field: 'unknown', message }];
    }
  }

  /**
   * Create a validation error for a single field
   */
  static single(
    field: string,
    message: string,
    value?: unknown
  ): ValidationError {
    return new ValidationError(message, [{ field, message, value }]);
  }

  /**
   * Create a validation error for multiple fields
   */
  static multiple(issues: ValidationIssue[]): ValidationError {
    const message = `Validation failed: ${issues
      .map((i) => i.field)
      .join(', ')}`;
    return new ValidationError(message, issues);
  }

  /**
   * Convert to JSON for serialization
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      issues: this.issues,
    };
  }

  /**
   * Get a single field error (for backward compatibility)
   */
  get field(): string | undefined {
    return this.issues[0]?.field;
  }
}

/**
 * Error thrown during flow execution
 */
export class FlowExecutionError extends Error {
  constructor(
    message: string,
    public flowName: string,
    public stepName?: string,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'FlowExecutionError';
  }
}
