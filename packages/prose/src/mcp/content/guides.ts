export const GUIDES: Record<string, string> = {
  retries: `# Retries

Chain \`.withRetry()\` after any step to add a retry policy. Ideal for steps that call external APIs or services where transient failures are expected.

\`\`\`typescript
flow
  .step('callExternalApi', async (ctx) => {
    const data = await api.fetch(ctx.input.url);
    return { data };
  })
  .withRetry({
    maxAttempts: 5,
    delayMs: 100,
    backoffMultiplier: 2,
    maxDelayMs: 5_000,
    shouldRetry: (err) => err.status !== 400,
    stepTimeout: 10_000,
  })
\`\`\`

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| \`maxAttempts\` | \`number\` | — | Total attempts including the first |
| \`delayMs\` | \`number\` | — | Initial delay between retries (ms) |
| \`backoffMultiplier\` | \`number\` | \`1\` | Multiplier applied after each retry |
| \`maxDelayMs\` | \`number\` | \`Infinity\` | Upper bound on delay |
| \`shouldRetry\` | \`(error) => boolean\` | — | Predicate to conditionally retry |
| \`stepTimeout\` | \`number\` | — | Timeout override for this step (ms) |

## Exponential backoff

With \`backoffMultiplier: 2\` and \`delayMs: 100\`, retries wait 100ms, 200ms, 400ms, 800ms, etc. Use \`maxDelayMs\` to cap the delay.

## Conditional retries

Use \`shouldRetry\` to skip retries for non-transient errors:

\`\`\`typescript
.withRetry({
  maxAttempts: 3,
  delayMs: 500,
  shouldRetry: (err) => {
    if (err.status >= 400 && err.status < 500) return false;
    return true;
  },
})
\`\`\`

## Important: Validation steps are never retried

Steps added with \`.validate()\` are never retried, even if \`.withRetry()\` is chained after them.`,

  transactions: `# Database Transactions

Use \`.transaction()\` to wrap a step in \`db.transaction()\`. The transaction client is passed as the second argument.

\`\`\`typescript
flow.transaction('persist', async (ctx, tx) => {
  const id = await tx.insert('users', { name: ctx.input.name });
  return { userId: id };
});
\`\`\`

## DatabaseClient interface

Transaction steps require a \`db\` property in your flow dependencies conforming to:

\`\`\`typescript
interface DatabaseClient<TTx = unknown> {
  transaction<T>(fn: (tx: TTx) => Promise<T>): Promise<T>;
}
\`\`\`

This is an opinionated design choice — Prose standardizes on this interface to manage transaction lifecycle and pass your ORM's native transaction client directly to step handlers. The \`tx\` type is automatically inferred from your \`DatabaseClient\` implementation. Works with **Drizzle**, **Knex**, **Prisma**, or any ORM that exposes a \`transaction()\` method.

## Example with Drizzle

\`\`\`typescript
import { drizzle } from 'drizzle-orm/node-postgres';

const db = drizzle(pool);

const flow = createFlow<{ name: string; email: string }>('create-user')
  .transaction('insert', async (ctx, tx) => {
    const [user] = await tx.insert(users).values({
      name: ctx.input.name,
      email: ctx.input.email,
    }).returning();
    return { user };
  })
  .build();

await flow.execute(
  { name: 'Alice', email: 'alice@example.com' },
  { db }
);
\`\`\`

## Missing database dependency

By default, if no \`db\` dependency is provided, Prose throws. Change to a warning:

\`\`\`typescript
await flow.execute(input, deps, {
  errorHandling: { throwOnMissingDatabase: false },
});
\`\`\``,

  events: `# Event Publishing

Publish domain events as part of your flow, keeping event emission co-located with business logic.

## Single event

\`\`\`typescript
flow.event('orders', (ctx) => ({
  eventType: 'order.created',
  orderId: ctx.state.orderId,
}));
\`\`\`

## Multiple events

\`\`\`typescript
flow.events('notifications', [
  (ctx) => ({ eventType: 'email.send', to: ctx.input.email }),
  (ctx) => ({ eventType: 'sms.send', to: ctx.input.phone }),
]);
\`\`\`

## FlowEventPublisher interface

\`\`\`typescript
interface FlowEventPublisher {
  publish(channel: string, event: FlowEvent): Promise<void> | void;
}
\`\`\`

The \`FlowEvent\` object is automatically enriched with a \`correlationId\` from the flow's metadata.

## Example implementation

\`\`\`typescript
const eventPublisher: FlowEventPublisher = {
  async publish(channel, event) {
    await redis.publish(channel, JSON.stringify(event));
  },
};

await flow.execute(input, { db, eventPublisher });
\`\`\`

## Missing event publisher

By default, if no \`eventPublisher\` is provided, Prose throws. Change to a warning:

\`\`\`typescript
await flow.execute(input, deps, {
  errorHandling: { throwOnMissingEventPublisher: false },
});
\`\`\``,

  'error-handling': `# Error Handling

## Error types

### FlowExecutionError
Thrown when a step fails during execution. Wraps the original error.

\`\`\`typescript
try {
  await flow.execute(input, deps);
} catch (err) {
  if (err instanceof FlowExecutionError) {
    err.flowName;      // 'process-order'
    err.stepName;      // 'charge'
    err.originalError; // the actual error
  }
}
\`\`\`

### ValidationError
Thrown by \`.validate()\` steps. Carries field-level details.

\`\`\`typescript
throw ValidationError.single('email', 'Invalid email');

throw new ValidationError('Validation failed', [
  { field: 'email', message: 'Required' },
  { field: 'age', message: 'Must be at least 18' },
]);
\`\`\`

### TimeoutError
Thrown when a flow or step exceeds its timeout.

\`\`\`typescript
try {
  await flow.execute(input, deps, { timeout: 5_000 });
} catch (err) {
  if (err instanceof TimeoutError) {
    err.flowName;   // 'process-order'
    err.stepName;   // step that timed out (or undefined)
    err.timeoutMs;  // 5000
  }
}
\`\`\`

## Catching errors

Use \`instanceof\` to distinguish:

\`\`\`typescript
try {
  await flow.execute(input, deps);
} catch (err) {
  if (err instanceof ValidationError) { /* fail-fast validation */ }
  else if (err instanceof TimeoutError) { /* timeout */ }
  else if (err instanceof FlowExecutionError) { /* step failure */ }
}
\`\`\`

## Partial state recovery

Set \`throwOnError: false\` to return partial state instead of throwing:

\`\`\`typescript
const result = await flow.execute(input, deps, { throwOnError: false });
\`\`\`

## Missing dependency handling

\`\`\`typescript
await flow.execute(input, deps, {
  errorHandling: {
    throwOnMissingDatabase: false,
    throwOnMissingEventPublisher: false,
  },
});
\`\`\``,

  'parallel-execution': `# Parallel Execution

Use \`.parallel()\` to run multiple handlers concurrently and merge their results.

\`\`\`typescript
flow.parallel('fetchAll', 'deep',
  async (ctx) => ({ users: await fetchUsers() }),
  async (ctx) => ({ posts: await fetchPosts() }),
);
\`\`\`

## Merge strategies

| Strategy | Behavior |
|----------|----------|
| \`'shallow'\` | \`Object.assign()\` — later results override earlier ones |
| \`'error-on-conflict'\` | Throws if any keys overlap between results |
| \`'deep'\` | Recursive merge; arrays are concatenated |

## Type safety

TypeScript infers the combined return type from all parallel handlers.

## Error handling

If any handler throws, all results are discarded and the error propagates. No partial-success mode.

Parallel steps support \`.withRetry()\` — the entire group is retried as a unit.`,

  'conditional-steps': `# Conditional Steps & Early Exit

## Conditional steps with stepIf

\`stepIf\` runs the handler only when the condition returns \`true\`. Skipped steps don't affect state.

\`\`\`typescript
flow
  .step('checkCache', (ctx) => {
    return { cached: cache.has(ctx.input.key) };
  })
  .stepIf('fromCache', (ctx) => ctx.state.cached, (ctx) => {
    return { value: cache.get(ctx.input.key) };
  })
  .stepIf('fromDb', (ctx) => !ctx.state.cached, async (ctx) => {
    return { value: await db.get(ctx.input.key) };
  })
\`\`\`

Skipped steps trigger the \`onStepSkipped\` observer hook.

## Early exit with breakIf

\`breakIf\` short-circuits the flow, skipping all remaining steps AND the \`.map()\` transformer.

\`\`\`typescript
flow
  .step('findUser', async (ctx) => {
    const existing = await db.findByEmail(ctx.input.email);
    return { existing };
  })
  .breakIf(
    (ctx) => ctx.state.existing != null,
    (ctx) => ({ user: ctx.state.existing, created: false })
  )
  .step('createUser', async (ctx) => {
    const user = await db.createUser(ctx.input);
    return { user };
  })
  .map((input, state) => ({ user: state.user, created: true }))
  .build();
\`\`\`

### How breakIf works

1. First argument is the condition — if \`true\`, the flow exits early
2. Second argument (optional) defines the return value
3. If no return value provided, current accumulated state is returned
4. \`.map()\` is skipped when a break occurs

### Type safety

The return type of \`.execute()\` is a union of the normal output and all possible break outputs.`,

  'sub-flows': `# Sub-flows with .pipe()

\`.pipe()\` lets you extract reusable step sequences as plain functions.

## Basic usage

\`\`\`typescript
function withAuth(builder) {
  return builder
    .step('validateToken', async (ctx) => {
      const session = await auth.verify(ctx.input.token);
      return { session };
    })
    .step('loadUser', async (ctx) => {
      const user = await db.getUser(ctx.state.session.userId);
      return { user };
    });
}

const flow = createFlow<{ token: string }>('protected-action')
  .pipe(withAuth)
  .step('doAction', (ctx) => {
    return { result: \\\`Hello, \\\${ctx.state.user.name}\\\` };
  })
  .build();
\`\`\`

## How it works

\`.pipe()\` takes a function that receives the current builder and returns a new builder. The state type is automatically merged.

## Composing multiple sub-flows

\`\`\`typescript
const flow = createFlow<{ token: string; orderId: string }>('admin-action')
  .pipe(withAuth)
  .pipe(withAuditLog)
  .step('process', async (ctx) => {
    // has ctx.state.user from withAuth
    // has ctx.state.auditId from withAuditLog
  })
  .build();
\`\`\`

## Parameterized sub-flows

\`\`\`typescript
function withRetryableApiCall(url: string) {
  return (builder) =>
    builder
      .step('apiCall', async (ctx) => {
        const data = await fetch(url, { signal: ctx.signal }).then(r => r.json());
        return { apiData: data };
      })
      .withRetry({ maxAttempts: 3, delayMs: 500 });
}
\`\`\``,

  'timeouts-and-cancellation': `# Timeouts & Cancellation

Prose supports three layers of timeout and cancellation, all backed by AbortSignal.

## Flow timeout

\`\`\`typescript
await flow.execute(input, deps, {
  timeout: 30_000, // abort if the flow exceeds 30 seconds
});
\`\`\`

Throws \`TimeoutError\` with the flow name and timeout value.

## Step timeout

\`\`\`typescript
await flow.execute(input, deps, {
  stepTimeout: 5_000, // abort any step that exceeds 5 seconds
});
\`\`\`

Override per-step via \`.withRetry()\`:

\`\`\`typescript
.step('slowOperation', async (ctx) => { /* ... */ })
.withRetry({
  maxAttempts: 1,
  delayMs: 0,
  stepTimeout: 15_000, // this step gets 15 seconds
})
\`\`\`

## External cancellation

\`\`\`typescript
const controller = new AbortController();
const promise = flow.execute(input, deps, { signal: controller.signal });
controller.abort();
\`\`\`

## Cooperative cancellation with ctx.signal

Inside step handlers, \`ctx.signal\` exposes a combined signal. Pass it to async operations:

\`\`\`typescript
flow.step('fetchData', async (ctx) => {
  const resp = await fetch(url, { signal: ctx.signal });
  return { data: await resp.json() };
});
\`\`\`

Check \`ctx.signal.aborted\` for cooperative cancellation in loops:

\`\`\`typescript
flow.step('processItems', async (ctx) => {
  for (const item of ctx.state.items) {
    if (ctx.signal.aborted) break;
    await processItem(item);
  }
});
\`\`\`

## Combining all three

All three layers work together. The combined signal fires as soon as any one triggers.`,

  'project-structure': `# Project Structure

An opinionated convention for organizing flows, steps, and dependencies into testable, auditable modules.

## The principle

**The flow definition is the specification.** Create it first — a readable contract that declares what happens, in what order, and what each step requires. Implementation details of each step live in their own modules.

\`\`\`
src/flows/process-order/
├── flow.ts            ← the contract (create this first)
├── types.ts           ← input, dependencies, and shared types
└── steps/
    ├── validate-order.ts
    ├── calculate-total.ts
    ├── charge-payment.ts
    └── persist-order.ts
\`\`\`

## 1. Start with the types

Define the flow's input shape and dependency interfaces in \`types.ts\`. This is the boundary contract — what callers must provide and what external services the flow depends on.

\`\`\`typescript
// flows/process-order/types.ts
import type { DatabaseClient, FlowEventPublisher } from '@celom/prose';

export interface OrderInput {
  orderId: string;
  userId: string;
  items: Array<{ sku: string; quantity: number; price: number }>;
}

export interface OrderDeps {
  db: DatabaseClient;
  eventPublisher: FlowEventPublisher;
  paymentGateway: PaymentGateway;
}

export interface PaymentGateway {
  charge(amount: number, userId: string): Promise<{ receiptId: string }>;
}
\`\`\`

## 2. Define the flow as a contract

The flow file imports its types and step handlers, then wires them together. Reading this file tells you everything about the operation without implementation noise.

\`\`\`typescript
// flows/process-order/flow.ts
import { createFlow } from '@celom/prose';
import type { OrderInput, OrderDeps } from './types';
import { validateOrder } from './steps/validate-order';
import { calculateTotal } from './steps/calculate-total';
import { chargePayment } from './steps/charge-payment';
import { persistOrder } from './steps/persist-order';

export const processOrder = createFlow<OrderInput, OrderDeps>('process-order')
  .validate('validateOrder', validateOrder)
  .step('calculateTotal', calculateTotal)
  .step('chargePayment', chargePayment)
    .withRetry({ maxAttempts: 3, delayMs: 500 })
  .transaction('persistOrder', persistOrder)
  .event('orderCreated', (ctx) => ({
    channel: 'orders',
    event: {
      type: 'order.created',
      payload: { orderId: ctx.input.orderId, total: ctx.state.total },
    },
  }))
  .build();
\`\`\`

## 3. Implement each step in its own module

Each step file exports a single handler function with a narrow state interface declaring exactly what it needs from prior steps.

\`\`\`typescript
// flows/process-order/steps/calculate-total.ts
import type { FlowContext } from '@celom/prose';
import type { OrderInput, OrderDeps } from '../types';

interface CalculateTotalState {}

export function calculateTotal(
  ctx: FlowContext<OrderInput, OrderDeps, CalculateTotalState>
) {
  const subtotal = ctx.input.items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );
  const tax = subtotal * 0.08;
  return { subtotal, tax, total: subtotal + tax };
}
\`\`\`

Each step's state interface documents the data flow — \`ChargePaymentState { total: number }\` tells you this step depends on a prior step that produces \`total\`.

## Why this matters

- **Each step is a pure, testable function** — test by constructing a minimal context, no flow runner needed
- **The flow file is auditable** — single source of truth for operation order, retry policies, transactions, and events
- **State interfaces document data flow** — implicit but type-checked dependency graph between steps
- **AI agents can reason about each piece independently** — clear boundaries for understanding, modifying, and extending flows

## When to use this pattern

Use for flows that represent **core business operations** — order processing, user onboarding, payment reconciliation, data pipelines. For simple flows with two or three short steps, a single file is fine.`,

  observability: `# Observability

Pass an observer to \`.execute()\` to hook into lifecycle events.

\`\`\`typescript
import { PinoFlowObserver } from '@celom/prose';
import pino from 'pino';

const observer = new PinoFlowObserver(pino());
await flow.execute(input, deps, { observer });
\`\`\`

## Observer hooks

| Hook | Called when |
|------|------------|
| \`onFlowStart(flowName, input)\` | Flow begins |
| \`onFlowComplete(flowName, output, duration)\` | Flow finishes successfully |
| \`onFlowError(flowName, error, duration)\` | Flow fails |
| \`onFlowBreak(flowName, breakStepName, returnValue, duration)\` | Flow exits early via breakIf |
| \`onStepStart(stepName, context)\` | Step begins |
| \`onStepComplete(stepName, result, duration, context)\` | Step finishes |
| \`onStepError(stepName, error, duration, context)\` | Step fails (after exhausting retries) |
| \`onStepRetry(stepName, attempt, maxAttempts, error)\` | Step is about to be retried |
| \`onStepSkipped(stepName, context)\` | Conditional step is skipped |

## Inline observer

\`\`\`typescript
await flow.execute(input, deps, {
  observer: {
    onStepComplete: (name, _result, duration) =>
      console.log(\\\`\\\${name} took \\\${duration}ms\\\`),
  },
});
\`\`\`

## Built-in observers

- **DefaultObserver** — Console logging
- **NoOpObserver** — Silent (testing)
- **PinoFlowObserver** — Structured JSON logging (Pino/Fastify)`,

  durability: `# Durability

Opt-in skip-ahead checkpointing. After every successful step, Prose persists a checkpoint. If the process crashes, calling \`execute()\` again with the same \`runId\` resumes from the next undone step. Same \`runId\` after completion replays the saved result without re-executing.

\`\`\`typescript
import { createFlow, MemoryDurabilityStore } from '@celom/prose';

const store = new MemoryDurabilityStore();

const processOrder = createFlow<{ orderId: string }>('process-order')
  .step('chargePayment', async (ctx) => {
    const receipt = await payments.charge({
      amount: 100,
      idempotencyKey: ctx.meta.idempotencyKey,
    });
    return { receipt };
  })
  .step('persistOrder', async (ctx) => {
    await db.orders.upsert({ id: ctx.input.orderId, receiptId: ctx.state.receipt.id });
  })
  .build();

// First call — crashes after chargePayment, before persistOrder
await processOrder.execute({ orderId: 'ord_42' }, { db, payments }, {
  durability: { store, runId: 'ord_42' },
});

// After restart — chargePayment is skipped, persistOrder runs
await processOrder.execute({ orderId: 'ord_42' }, { db, payments }, {
  durability: { store, runId: 'ord_42' },
});
\`\`\`

## The three behaviors of execute() with durability

| Stored status | Behavior |
|---------------|----------|
| _no checkpoint_ | Fresh run — every step executes |
| \`running\` or \`failed\` | Resume — completed steps are skipped, state is loaded, execution continues at the first undone step |
| \`completed\` | Replay — the saved result is returned without invoking any handler |

## The idempotency contract

A step may run twice across a crash. \`ctx.meta.idempotencyKey\` is a stable per-step key (\`\${runId}:\${stepName}\`) — pass it to any external API that supports idempotency.

\`\`\`typescript
.step('chargePayment', async (ctx) => {
  const receipt = await stripe.paymentIntents.create(
    { amount: ctx.state.total, currency: 'usd' },
    { idempotencyKey: ctx.meta.idempotencyKey },
  );
  return { receipt };
})
\`\`\`

For databases: use upserts. For queues: send with a deduplication ID. For things you can't deduplicate (email, webhooks without idempotency), accept at-least-once or move that side effect into an outbox.

## Choosing a runId

The \`runId\` is the identity of a single run. Pass the same \`runId\` across processes and you get the same run.

- Derive it from a business identifier — order ID, signup ID, message ID
- Don't use a random UUID generated inside a request handler; the next request won't know it

## meta fields under durability

When \`durability\` is configured, every step handler sees three extra \`ctx.meta\` fields:

| Field | Description |
|-------|-------------|
| \`ctx.meta.runId\` | The \`DurabilityOptions.runId\` of this run |
| \`ctx.meta.idempotencyKey\` | Stable per-step key (\`\${runId}:\${stepName}\`) |
| \`ctx.meta.isResuming\` | \`true\` when this execution loaded a saved checkpoint rather than starting fresh |

Use \`isResuming\` to skip work that's only needed on a fresh run (sending an initial acknowledgement, for example).

## Interaction with other features

| Feature | Behavior under durability |
|---------|--------------------------|
| \`.parallel(...)\` | Atomic checkpoint — all handlers re-run if any one fails |
| \`.withRetry(...)\` | Retries happen within the step; checkpoint is written once, after retries succeed |
| \`.breakIf(...)\` | Break value is persisted; replay returns it without invoking any handler |
| \`.stepIf(...)\` / step \`condition\` | Skip decision is recorded; resume does not re-evaluate |
| \`.transaction(...)\` | Transaction runs again if it failed before checkpoint write — database-level idempotency is your responsibility |
| \`.event(...)\` | At-least-once: an event may be re-published if crash falls between publish and checkpoint write — consumers must be idempotent |
| \`.validate(...)\` | Re-runs on resume only if it threw on the previous attempt |

## What this isn't

This is **not** Temporal-style durable execution. It does NOT provide:

- Long sleeps that survive process death (\`await sleep(7.days)\`)
- An automatic resumer service — something outside Prose must call \`execute()\` again
- Distributed worker claim/lease coordination
- Workflow versioning — changing a flow while a checkpoint exists is undefined behavior

For those, use Temporal, Inngest, or Trigger.dev.

## Stores

- **\`MemoryDurabilityStore\`** — Built-in. Tests, dev, single-process scripts only. State is lost on process exit — NOT for production.
- **Custom adapter** — Implement the three-method \`DurabilityStore\` interface (\`load\`, \`save\`, \`delete\`). See \`prose://api/durability-store\` for the contract.

## Cleanup

Prose does not delete completed checkpoints. Call \`store.delete(runId)\` after the result has been consumed, or implement a TTL in your store.`,
};

export const GUIDE_TOPICS = Object.keys(GUIDES);
