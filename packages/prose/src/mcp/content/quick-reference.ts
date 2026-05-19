export const QUICK_REFERENCE = `# @celom/prose Quick Reference

## Creating a flow

\`\`\`typescript
import { createFlow } from '@celom/prose';

const flow = createFlow<TInput, TDeps>(name)
  .step(...)
  .build();

const result = await flow.execute(input, deps, options?);
\`\`\`

- \`TInput\` — shape of the input object passed to \`.execute()\`
- \`TDeps extends BaseFlowDependencies\` — shape of the dependencies object (optionally includes \`db?: DatabaseClient\` and \`eventPublisher?: FlowEventPublisher\`)

## FlowBuilder Methods

### Steps

| Method | Purpose | Returns state? |
|--------|---------|---------------|
| \`.step(name, handler, retryOptions?)\` | Regular step | Yes — return object merges into \`ctx.state\` |
| \`.validate(name, handler)\` | Validation (never retried) | No |
| \`.stepIf(name, condition, handler, retryOptions?)\` | Conditional step | Yes (if condition is true) |
| \`.transaction(name, handler)\` | DB transaction wrapper | Yes — \`handler(ctx, tx)\` |
| \`.parallel(name, strategy, ...handlers)\` | Concurrent execution | Yes — merged results |

### Events

| Method | Purpose |
|--------|---------|
| \`.event(channel, builder, name?)\` | Publish single event (name defaults to \`'publishEvent'\`) |
| \`.events(channel, builders[], name?)\` | Publish multiple events to same channel (name defaults to \`'publishEvents'\`) |

### Flow Control

| Method | Purpose |
|--------|---------|
| \`.breakIf(condition, returnValue?)\` | Short-circuit flow (skips remaining steps AND .map()) |
| \`.withRetry(options)\` | Add retry policy to the **last** step |

### Composition & Output

| Method | Purpose |
|--------|---------|
| \`.pipe(fn)\` | Apply builder transformation (reusable sub-flows) |
| \`.map(mapper)\` | Transform final output — receives \`(input, state)\` |
| \`.build()\` | Create executable FlowDefinition |

## Key Types

\`\`\`typescript
// Context passed to every step handler
interface FlowContext<TInput, TDeps extends BaseFlowDependencies, TState> {
  readonly input: Readonly<TInput>;  // Original input, never changes
  state: TState;                     // Accumulated state from prior steps
  deps: TDeps;                       // Dependencies from .execute()
  meta: FlowMeta;                    // Runtime metadata
  signal: AbortSignal;               // Combined abort signal
}

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

interface RetryOptions {
  maxAttempts: number;      // Total attempts including the first
  delayMs: number;          // Initial delay between retries (ms)
  backoffMultiplier?: number; // Multiplier applied after each retry
  maxDelayMs?: number;      // Upper bound on delay
  shouldRetry?: (error: Error) => boolean;
  stepTimeout?: number;     // Timeout override for this step (ms)
}

type MergeStrategy = 'shallow' | 'error-on-conflict' | 'deep';

interface FlowEvent {
  eventType: string;
  [key: string]: unknown;
}

interface DatabaseClient<TTx = unknown> {
  transaction<T>(fn: (tx: TTx) => Promise<T>): Promise<T>;
}

interface FlowEventPublisher {
  publish(channel: string, event: FlowEvent): Promise<void> | void;
}
\`\`\`

## Error Classes

| Class | Thrown when | Key properties |
|-------|-----------|----------------|
| \`ValidationError\` | \`.validate()\` step fails | \`.issues: { field, message, value? }[]\` |
| \`FlowExecutionError\` | Step throws during execution | \`.flowName\`, \`.stepName\`, \`.originalError\` |
| \`TimeoutError\` | Flow or step exceeds timeout | \`.flowName\`, \`.stepName\`, \`.timeoutMs\` |

\`\`\`typescript
// ValidationError helpers
ValidationError.single(field, message, value?)
ValidationError.multiple([{ field, message, value? }, ...])
// Also has .field getter for first issue's field name
\`\`\`

## Execution Options

\`\`\`typescript
await flow.execute(input, deps, {
  timeout: 30_000,           // Flow-level timeout (ms)
  stepTimeout: 5_000,        // Default per-step timeout (ms)
  signal: controller.signal, // External AbortSignal
  observer: new PinoFlowObserver(logger),
  throwOnError: true,        // false = return partial state
  correlationId: 'req_123',  // Custom correlation ID
  errorHandling: {
    throwOnMissingDatabase: true,
    throwOnMissingEventPublisher: true,
  },
  durability: {              // Opt-in skip-ahead checkpointing
    store: new MemoryDurabilityStore(), // or your custom DurabilityStore
    runId: input.orderId,    // Stable per-run identifier (typically a business ID)
  },
});
\`\`\`

## Common Patterns

### State threading
Each step's return object is shallow-merged into \`ctx.state\`. Later steps see all prior state with full TypeScript inference.

### .withRetry() applies to the LAST step
\`\`\`typescript
.step('fetchData', handler)     // ← this step gets retried
.withRetry({ maxAttempts: 3, delayMs: 200 })
\`\`\`

### .validate() steps are never retried
Even if \`.withRetry()\` is chained after a \`.validate()\` step.

### .breakIf() skips .map()
When a break triggers, \`.map()\` is bypassed and the break return value (or accumulated state) is returned directly.

### .transaction() requires db dependency
The \`tx\` argument is typed as your ORM's native transaction client, inferred from \`DatabaseClient<TTx>\`.
\`\`\`typescript
type Deps = { db: DatabaseClient; eventPublisher: FlowEventPublisher };
const flow = createFlow<Input, Deps>('name')
  .transaction('persist', async (ctx, tx) => { ... })
\`\`\`

### .event() requires eventPublisher dependency
\`\`\`typescript
type Deps = { eventPublisher: FlowEventPublisher };
\`\`\`

### Cooperative cancellation
Pass \`ctx.signal\` to async operations inside step handlers:
\`\`\`typescript
.step('fetch', async (ctx) => {
  const resp = await fetch(url, { signal: ctx.signal });
  return { data: await resp.json() };
})
\`\`\`

### Durability (opt-in skip-ahead checkpointing)
Pass \`durability: { store, runId }\` to \`.execute()\`. After every successful step, Prose persists a checkpoint. A subsequent \`execute()\` with the same \`runId\` resumes from the next undone step (or replays the saved result if the run already completed).

Handlers must be idempotent — a step may run twice across a crash. Pass \`ctx.meta.idempotencyKey\` (\`\${runId}:\${stepName}\`) to external APIs that support idempotency (Stripe, SQS, etc.).

\`MemoryDurabilityStore\` is built in but is for tests/dev only. Production needs a persistent \`DurabilityStore\` adapter.

See \`prose://guides/durability\` and \`prose://api/durability-store\`.

## Observers

| Observer | Purpose |
|----------|---------|
| \`DefaultObserver\` | Console logging |
| \`NoOpObserver\` | Silent (testing) |
| \`PinoFlowObserver\` | Structured JSON logging (Pino/Fastify) |

Observer hooks: \`onFlowStart\`, \`onFlowComplete\`, \`onFlowError\`, \`onFlowBreak\`, \`onStepStart\`, \`onStepComplete\`, \`onStepError\`, \`onStepRetry\`, \`onStepSkipped\`
`;
