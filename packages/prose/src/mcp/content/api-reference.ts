export const CREATE_FLOW_REFERENCE = `# createFlow

## Signature

\`\`\`typescript
function createFlow<TInput, TDeps extends BaseFlowDependencies = never>(
  name: string
): FlowBuilder<TInput, TDeps, {}, never>
\`\`\`

## Parameters

### \`name\`
**Type:** \`string\`

A human-readable name for the flow. Used in error messages, observer hooks, and \`ctx.meta.flowName\`.

## Type parameters

### \`TInput\`
The shape of the input object passed to \`.execute()\`. Available as \`ctx.input\` in every step handler.

### \`TDeps\`
The shape of the dependencies object passed as the second argument to \`.execute()\`. Must extend \`BaseFlowDependencies\`, which optionally includes \`db?: DatabaseClient\` and \`eventPublisher?: FlowEventPublisher\`. Defaults to \`never\` — TypeScript will enforce providing a type when using \`.transaction()\` or \`.event()\` steps.

\`\`\`typescript
type Deps = {
  db: DatabaseClient;
  eventPublisher: FlowEventPublisher;
};

const flow = createFlow<{ orderId: string }, Deps>('process-order');
\`\`\`

## Returns

A \`FlowBuilder\` instance with empty initial state and no break outputs.

## Example

\`\`\`typescript
import { createFlow } from '@celom/prose';

const flow = createFlow<{ email: string }>('onboard-user')
  .step('create', async (ctx) => {
    const user = await db.createUser(ctx.input.email);
    return { user };
  })
  .build();

const result = await flow.execute({ email: 'alice@example.com' }, { db });
\`\`\`
`;

export const FLOW_BUILDER_REFERENCE = `# FlowBuilder

The FlowBuilder is the main API for defining flows. It provides a fluent interface — each method returns a new builder with updated types.

## Steps

### .step(name, handler, retryOptions?)
Add a regular step. The handler receives \`FlowContext\` and can return an object to merge into state. Optionally pass \`RetryOptions\` inline as a third argument (equivalent to chaining \`.withRetry()\`).

\`\`\`typescript
.step('fetchOrder', async (ctx) => {
  const order = await db.getOrder(ctx.input.orderId);
  return { order };
})

// With inline retry options (equivalent to .withRetry())
.step('callApi', async (ctx) => {
  return { data: await api.fetch(ctx.input.url) };
}, { maxAttempts: 3, delayMs: 200 })
\`\`\`

### .validate(name, handler)
Add a validation step. Runs before processing and is **never retried**. Throw \`ValidationError\` to fail fast.

\`\`\`typescript
.validate('checkInput', (ctx) => {
  if (ctx.input.amount <= 0)
    throw ValidationError.single('amount', 'Must be positive');
})
\`\`\`

### .stepIf(name, condition, handler, retryOptions?)
Add a conditional step. The handler only runs when \`condition(ctx)\` returns \`true\`. Skipped steps don't affect state. Optionally pass \`RetryOptions\` inline as a fourth argument.

\`\`\`typescript
.stepIf('sendSms', (ctx) => ctx.input.phone != null, async (ctx) => {
  await sms.send(ctx.input.phone, 'Hello!');
})
\`\`\`

### .transaction(name, handler)
Wrap a step in \`deps.db.transaction()\`. The handler receives \`(ctx, tx)\` where \`tx\` is your ORM's native transaction client, automatically inferred from \`DatabaseClient<TTx>\`.

\`\`\`typescript
.transaction('persist', async (ctx, tx) => {
  const id = await tx.insert('users', ctx.input);
  return { userId: id };
})
\`\`\`

Requires a \`db\` dependency conforming to the \`DatabaseClient\` interface.

### .parallel(name, strategy, ...handlers)
Run multiple handlers concurrently and merge results into state.

\`\`\`typescript
.parallel('fetchAll', 'deep',
  async (ctx) => ({ users: await fetchUsers() }),
  async (ctx) => ({ posts: await fetchPosts() }),
)
\`\`\`

**Merge strategies:** \`'shallow'\`, \`'error-on-conflict'\`, \`'deep'\`

## Events

### .event(channel, builder, name?)
Publish a single event to a named channel. The optional \`name\` parameter sets a custom step name (defaults to \`'publishEvent'\`).

\`\`\`typescript
.event('orders', (ctx) => ({
  eventType: 'order.created',
  orderId: ctx.state.orderId,
}))

// With custom step name
.event('orders', (ctx) => ({
  eventType: 'order.created',
  orderId: ctx.state.orderId,
}), 'publishOrderCreated')
\`\`\`

### .events(channel, builders, name?)
Publish multiple events to a channel in one step. The optional \`name\` parameter sets a custom step name (defaults to \`'publishEvents'\`).

\`\`\`typescript
.events('notifications', [
  (ctx) => ({ eventType: 'email.send', to: ctx.input.email }),
  (ctx) => ({ eventType: 'sms.send', to: ctx.input.phone }),
])
\`\`\`

## Flow control

### .breakIf(condition, returnValue?)
Short-circuit the flow. If \`condition(ctx)\` returns \`true\`, all remaining steps and \`.map()\` are skipped.

\`\`\`typescript
.breakIf(
  (ctx) => ctx.state.existing != null,
  (ctx) => ({ user: ctx.state.existing, created: false })
)
\`\`\`

### .withRetry(options)
Add a retry policy to the **last** step.

\`\`\`typescript
.withRetry({
  maxAttempts: 3,
  delayMs: 200,
  backoffMultiplier: 2,
})
\`\`\`

## Composition

### .pipe(fn)
Apply a builder transformation function. Used for reusable sub-flows.

\`\`\`typescript
.pipe(withAuth)
.pipe(withAuditLog)
\`\`\`

### .map(mapper)
Transform the final accumulated state into a custom output shape. Receives \`(input, state)\`.

\`\`\`typescript
.map((input, state) => ({
  id: state.user.id,
  displayName: state.user.name,
}))
\`\`\`

## Build

### .build()
Create an executable \`FlowDefinition\`. Returns an object with an \`.execute()\` method.

\`\`\`typescript
const flow = createFlow<Input>('name')
  .step(...)
  .build();

const result = await flow.execute(input, deps, options?);
\`\`\`
`;

export const TYPES_REFERENCE = `# Types

## FlowContext
Passed to every step handler.

\`\`\`typescript
interface FlowContext<TInput, TDeps extends BaseFlowDependencies, TState> {
  readonly input: Readonly<TInput>;
  state: TState;
  deps: TDeps;
  meta: FlowMeta;
  signal: AbortSignal;
}
\`\`\`

| Property | Description |
|----------|-------------|
| \`input\` | Original input, readonly. Never changes during execution. |
| \`state\` | Accumulated state from prior steps. Each step's return merges into this. |
| \`deps\` | Dependencies injected via \`.execute()\`. |
| \`meta\` | Runtime metadata (see FlowMeta). |
| \`signal\` | Combined abort signal from flow timeout, step timeout, and external signal. |

## BaseFlowDependencies
The base contract for flow dependencies. Both \`db\` and \`eventPublisher\` are optional — provide them when your flow uses \`.transaction()\` or \`.event()\` steps.

\`\`\`typescript
type BaseFlowDependencies = {
  db?: DatabaseClient;
  eventPublisher?: FlowEventPublisher;
};
\`\`\`

## FlowMeta
Runtime metadata available via \`ctx.meta\`.

\`\`\`typescript
interface FlowMeta {
  flowName: string;
  startedAt: Date;
  currentStep?: string;
  correlationId?: string;
  // Durability-only — present when execute() was passed a \`durability\` option
  runId?: string;
  idempotencyKey?: string;
  isResuming?: boolean;
}
\`\`\`

| Field | Description |
|-------|-------------|
| \`flowName\` | The flow's name. |
| \`startedAt\` | When this \`execute()\` call began. Set on each invocation; not preserved across resumes. |
| \`currentStep\` | The name of the step currently executing. |
| \`correlationId\` | Custom or auto-generated ID propagated to events and observers. |
| \`runId\` | The \`DurabilityOptions.runId\` of this run. Present only when durability is configured. |
| \`idempotencyKey\` | Stable per-step key (\`\${runId}:\${currentStep}\`). Pass to external APIs that support idempotency so re-runs are safe. Present only when durability is configured. |
| \`isResuming\` | \`true\` when this execution loaded an existing checkpoint rather than starting fresh. Present only when durability is configured. |

## FlowState
Base constraint for accumulated state. All state objects must satisfy this type.

\`\`\`typescript
type FlowState = Record<string, unknown>;
\`\`\`

## RetryOptions
Configuration for \`.withRetry()\` or the inline \`retryOptions\` parameter on \`.step()\` / \`.stepIf()\`.

\`\`\`typescript
interface RetryOptions {
  maxAttempts: number;
  delayMs: number;
  backoffMultiplier?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: Error) => boolean;
  stepTimeout?: number;
}
\`\`\`

## StepCondition
The condition function type used by \`.stepIf()\`.

\`\`\`typescript
type StepCondition<TInput, TDeps extends BaseFlowDependencies, TState extends FlowState> =
  (ctx: FlowContext<TInput, TDeps, TState>) => boolean;
\`\`\`

## FlowEvent
The object returned by event builders, enriched with metadata before publishing.

\`\`\`typescript
interface FlowEvent {
  eventType: string;
  [key: string]: unknown;
}
\`\`\`

The \`correlationId\` is automatically added by Prose before publishing — you don't need to include it in your event builders.

## FlowEventPublisher
Interface for the \`eventPublisher\` dependency.

\`\`\`typescript
interface FlowEventPublisher {
  publish(channel: string, event: FlowEvent): Promise<void> | void;
}
\`\`\`

## DatabaseClient
Interface for the \`db\` dependency used by \`.transaction()\` steps. The \`TTx\` generic parameter represents your ORM's native transaction type.

\`\`\`typescript
interface DatabaseClient<TTx = unknown> {
  transaction<T>(fn: (tx: TTx) => Promise<T>): Promise<T>;
}
\`\`\`

When you provide a typed \`DatabaseClient\`, Prose infers \`TTx\` and passes it as the \`tx\` argument in \`.transaction()\` step handlers — no manual casting needed.

## MergeStrategy
Strategy for \`.parallel()\` result merging.

\`\`\`typescript
type MergeStrategy = 'shallow' | 'error-on-conflict' | 'deep';
\`\`\`

## ValidationIssue
Field-level validation error detail.

\`\`\`typescript
interface ValidationIssue {
  field: string;
  message: string;
  value?: unknown;
}
\`\`\`

## TxClientOf
Utility type to extract the transaction client type from a dependencies type.

\`\`\`typescript
type TxClientOf<TDeps extends BaseFlowDependencies> =
  TDeps extends { db: DatabaseClient<infer TTx> } ? TTx : unknown;
\`\`\`

## FlowDefinition
The type returned by \`.build()\`. Contains the flow metadata, steps, and the \`.execute()\` method.

\`\`\`typescript
interface FlowDefinition<TInput, TDeps, TState, TMapperOutput = never, TBreakOutputs = never> {
  name: string;
  steps: StepDefinition<TInput, TDeps, TState>[];
  execute: (
    input: TInput,
    deps: TDeps,
    options?: FlowExecutionOptions<TInput, TDeps, TState>,
  ) => Promise<InferFlowOutput<TState, TMapperOutput> | TBreakOutputs>;
}
\`\`\`

## InferFlowOutput
Utility type that resolves the output type of a flow. Returns \`TMapperOutput\` if a \`.map()\` was used, otherwise \`TState\`.

\`\`\`typescript
type InferFlowOutput<TState, TMapperOutput> = [TMapperOutput] extends [never]
  ? TState
  : TMapperOutput;
\`\`\`

## ErrorHandlingConfig
Configuration for missing dependency behavior.

\`\`\`typescript
interface ErrorHandlingConfig {
  throwOnMissingEventPublisher?: boolean;  // default: true
  throwOnMissingDatabase?: boolean;         // default: true
}
\`\`\`

## PinoLike
Minimal Pino-compatible logger interface used by \`PinoFlowObserver\`. Avoids a direct pino dependency — satisfied by \`fastify.log\`.

\`\`\`typescript
interface PinoLike {
  info: (obj: Record<string, unknown>, msg: string) => void;
  debug: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
  child: (bindings: Record<string, unknown>) => PinoLike;
}
\`\`\`
`;

export const EXECUTION_OPTIONS_REFERENCE = `# Execution Options

The third argument to \`.execute()\` is an optional options object.

\`\`\`typescript
const result = await flow.execute(input, deps, options);
\`\`\`

## Options

### timeout
**Type:** \`number\`
Maximum duration for the entire flow in milliseconds. Throws \`TimeoutError\` if exceeded.

### stepTimeout
**Type:** \`number\`
Default maximum duration per step in milliseconds. Can be overridden per-step via \`.withRetry({ stepTimeout })\`.

### signal
**Type:** \`AbortSignal\`
External abort signal for cancellation. Combined with flow/step timeouts into \`ctx.signal\`.

\`\`\`typescript
const controller = new AbortController();
await flow.execute(input, deps, { signal: controller.signal });
\`\`\`

### observer
**Type:** \`FlowObserver\`
Lifecycle hooks for logging, metrics, or tracing.

### throwOnError
**Type:** \`boolean\` **Default:** \`true\`
When \`false\`, returns partial accumulated state instead of throwing on step failure.

### correlationId
**Type:** \`string\`
Custom ID propagated to events and observers via \`ctx.meta.correlationId\`.

### errorHandling
**Type:** \`object\`
Control behavior for missing optional dependencies.

\`\`\`typescript
{
  errorHandling: {
    throwOnMissingDatabase: false,
    throwOnMissingEventPublisher: false,
  }
}
\`\`\`

### durability
**Type:** \`DurabilityOptions\`
Opt-in skip-ahead checkpointing. When set, each successful step persists a checkpoint to the configured store. Re-invoking \`execute()\` with the same \`runId\` resumes from the next undone step (or returns the saved result if the run already completed).

\`\`\`typescript
import { MemoryDurabilityStore } from '@celom/prose';

const store = new MemoryDurabilityStore();

await flow.execute(input, deps, {
  durability: { store, runId: input.orderId },
});
\`\`\`

See \`prose://api/durability-store\` for the full \`DurabilityStore\` / \`DurabilityOptions\` / \`FlowCheckpoint\` type references, and \`prose://guides/durability\` for the conceptual guide.
`;

export const DURABILITY_REFERENCE = `# Durability Store

Opt-in skip-ahead checkpointing. After every successful step, Prose persists a checkpoint to a configured \`DurabilityStore\`. Re-invoking \`execute()\` with the same \`runId\` resumes from the next undone step. Same \`runId\` after completion replays the saved result without re-execution.

## DurabilityStore

Pluggable persistence layer for flow checkpoints. Adapters may live in separate packages.

\`\`\`typescript
interface DurabilityStore {
  load(runId: string): Promise<FlowCheckpoint | null>;
  save(checkpoint: FlowCheckpoint): Promise<void>;
  delete(runId: string): Promise<void>;
}
\`\`\`

| Method | Semantics |
|--------|-----------|
| \`load(runId)\` | Return the checkpoint for \`runId\`, or \`null\` if none exists. Must not throw on unknown ids. |
| \`save(checkpoint)\` | Persist the checkpoint, overwriting any existing entry for the same \`runId\`. Must be atomic — partial writes defeat checkpointing. |
| \`delete(runId)\` | Remove the checkpoint. No-op for unknown \`runId\` — must not throw. |

## FlowCheckpoint

The shape persisted to the store. Adapters store and return this verbatim.

\`\`\`typescript
interface FlowCheckpoint {
  flowName: string;
  runId: string;
  input: unknown;
  state: unknown;
  completedSteps: string[];
  status: 'running' | 'completed' | 'failed';
  breakValue?: unknown;
  failedStep?: { name: string; error: string };
  createdAt: Date;
  updatedAt: Date;
}
\`\`\`

| Field | Description |
|-------|-------------|
| \`flowName\` | The flow's name (from \`createFlow('name')\`). |
| \`runId\` | The \`DurabilityOptions.runId\` of this run. |
| \`input\` | The argument the flow was first started with. Used verbatim on resume — the caller's second \`input\` argument is ignored. |
| \`state\` | Accumulated state at the moment of the last successful step. |
| \`completedSteps\` | Names of finished or condition-skipped steps, in execution order. |
| \`status\` | \`'running'\` (in progress or crashed), \`'completed'\` (saved result is final), \`'failed'\` (errored after exhausting retries). |
| \`breakValue\` | Only present when the flow short-circuited via \`breakIf\`. The field's _presence_ distinguishes "broke" from "completed normally" — the value itself may be \`undefined\`. |
| \`failedStep\` | Only present when \`status === 'failed'\`. The step that errored, plus its error message. |
| \`createdAt\` | When the run first started. Preserved across resumes. |
| \`updatedAt\` | When the checkpoint was last written. |

## DurabilityOptions

The shape passed via \`FlowExecutionOptions.durability\`.

\`\`\`typescript
interface DurabilityOptions {
  store: DurabilityStore;
  runId: string;
}
\`\`\`

| Field | Description |
|-------|-------------|
| \`store\` | The store to read and write checkpoints through. |
| \`runId\` | Stable identifier for this run. Same \`runId\` across \`execute()\` calls → resume or replay. New \`runId\` → fresh run. Typically derived from a business identifier (order ID, signup ID). |

## MemoryDurabilityStore

A reference \`DurabilityStore\` that holds checkpoints in a \`Map\`. **For tests, local dev, and as a reference implementation only — does NOT survive process exit.** Use a persistent adapter in production.

\`\`\`typescript
import { MemoryDurabilityStore } from '@celom/prose';

const store = new MemoryDurabilityStore();
\`\`\`

Test helpers (not part of \`DurabilityStore\`): \`size()\`, \`snapshot(runId)\`, \`clear()\`.

## Implementation contract

Conformance tests for adapter authors live at \`packages/prose/src/lib/__tests__/store-conformance.ts\`. The file is **not** re-exported from the package entry point and is **not** included in the published \`dist/\`. Copy or vendor it into your adapter package, or import directly from source for adapters in this monorepo.

Implementation notes:
- \`save()\` must be atomic — partial writes defeat checkpointing.
- \`load()\` returns \`null\` (not throws) for unknown \`runId\`s.
- \`delete()\` of an unknown \`runId\` is a no-op.
- Cloning on read is encouraged for non-serializing stores so callers can't mutate stored state.
`;

export const ERROR_TYPES_REFERENCE = `# Error Types

Prose exports three error classes, all extending \`Error\`.

## ValidationError

Thrown by \`.validate()\` steps for input validation failures.

### Constructor
\`\`\`typescript
new ValidationError(message: string, issues?: ValidationIssue[] | string)
\`\`\`

When \`issues\` is a \`string\`, it is treated as a single field name (backward-compatible shorthand).

### Static helpers
\`\`\`typescript
ValidationError.single(field: string, message: string, value?: unknown): ValidationError
ValidationError.multiple(issues: ValidationIssue[]): ValidationError
\`\`\`

### Properties
| Property | Type | Description |
|----------|------|-------------|
| \`message\` | \`string\` | Error message |
| \`issues\` | \`ValidationIssue[]\` | Array of \`{ field, message, value? }\` objects |
| \`field\` | \`string \\| undefined\` | Getter — returns the first issue's field (convenience accessor) |

### Methods
- \`.toJSON()\` — Returns a serializable representation with \`name\`, \`message\`, and \`issues\`

### Example
\`\`\`typescript
// Single field
throw ValidationError.single('email', 'Invalid email');

// Single field with value for debugging
throw ValidationError.single('age', 'Must be at least 18', 15);

// Multiple fields
throw new ValidationError('Validation failed', [
  { field: 'email', message: 'Required' },
  { field: 'age', message: 'Must be at least 18' },
]);
\`\`\`

## FlowExecutionError

Thrown when a step fails during execution. Wraps the original error.

### Properties
| Property | Type | Description |
|----------|------|-------------|
| \`flowName\` | \`string\` | Name of the flow |
| \`stepName\` | \`string\` | Name of the step that failed |
| \`originalError\` | \`Error\` | The actual error thrown by the step |

## TimeoutError

Thrown when a flow or step exceeds its configured timeout.

### Properties
| Property | Type | Description |
|----------|------|-------------|
| \`flowName\` | \`string\` | Name of the flow |
| \`stepName\` | \`string \\| undefined\` | Step name (undefined for flow-level timeout) |
| \`timeoutMs\` | \`number\` | The timeout value that was exceeded |
`;

export const OBSERVERS_REFERENCE = `# Observers

## FlowObserver interface

All hooks are optional. Implement only the ones you need.

\`\`\`typescript
interface FlowObserver {
  onFlowStart?(flowName: string, input: unknown): void;
  onFlowComplete?(flowName: string, output: unknown, duration: number): void;
  onFlowError?(flowName: string, error: Error, duration: number): void;
  onFlowBreak?(flowName: string, breakStepName: string, returnValue: unknown, duration: number): void;
  onStepStart?(stepName: string, context: FlowContext): void;
  onStepComplete?(stepName: string, result: unknown, duration: number, context: FlowContext): void;
  onStepError?(stepName: string, error: Error, duration: number, context: FlowContext): void;
  onStepRetry?(stepName: string, attempt: number, maxAttempts: number, error: Error): void;
  onStepSkipped?(stepName: string, context: FlowContext): void;
}
\`\`\`

## DefaultObserver

Console-based logging. Accepts an optional logger interface.

\`\`\`typescript
import { DefaultObserver } from '@celom/prose';

const observer = new DefaultObserver();

// Custom logger
const observer = new DefaultObserver({
  debug: (msg) => myLogger.debug(msg),
  error: (msg, err) => myLogger.error(msg, err),
  warn: (msg) => myLogger.warn(msg),
});
\`\`\`

## NoOpObserver

Silent observer — all hooks are no-ops. Useful as a default value.

\`\`\`typescript
import { NoOpObserver } from '@celom/prose';
const observer = new NoOpObserver();
\`\`\`

## PinoFlowObserver

Structured JSON logging with any Pino-compatible logger. Accepts any object satisfying the \`PinoLike\` interface (also exported from \`@celom/prose\`).

\`\`\`typescript
import { PinoFlowObserver } from '@celom/prose';
import type { PinoLike } from '@celom/prose';
import pino from 'pino';

const observer = new PinoFlowObserver(pino());
\`\`\`

Works with Fastify's built-in logger:

\`\`\`typescript
fastify.post('/orders', async (request) => {
  const observer = new PinoFlowObserver(request.log);
  await flow.execute(input, deps, { observer });
});
\`\`\`

Each hook produces a structured log entry with flow name, step name, duration, and contextual data.
`;
