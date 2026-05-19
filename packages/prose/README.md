# @celom/prose

Declarative workflow DSL for orchestrating complex business operations in Node.js.

Define multi-step business logic as type-safe pipelines with built-in retries, timeouts, transactions, event publishing, and observability — using plain async/await.

```typescript
import { createFlow, ValidationError } from '@celom/prose';

const onboardUser = createFlow<{ email: string; name: string }>('onboard-user')
  .validate('checkEmail', (ctx) => {
    if (!ctx.input.email.includes('@'))
      throw ValidationError.single('email', 'Invalid email');
  })
  .step('createAccount', async (ctx) => {
    const user = await db.createUser(ctx.input);
    return { user };
  })
  .withRetry({ maxAttempts: 3, delayMs: 200, backoffMultiplier: 2 })
  .step('sendWelcome', async (ctx) => {
    await mailer.send(ctx.state.user.email, 'Welcome!');
  })
  .event('users', (ctx) => ({
    eventType: 'user.onboarded',
    userId: ctx.state.user.id,
  }))
  .build();

const result = await onboardUser.execute(
  { email: 'alice@example.com', name: 'Alice' },
  { db, eventPublisher }
);
```

## Install

```bash
npm install @celom/prose
```

## Features

- **Type-safe state threading** — each step's return type merges into `ctx.state`, giving you full autocomplete and compile-time checks across the entire pipeline
- **Retries with exponential backoff** — per-step retry policies with configurable delays, backoff multipliers, caps, and conditional retry predicates
- **Timeouts** — flow-level and step-level timeouts backed by `AbortSignal`, with actual interruption of async operations
- **Cooperative cancellation** — pass an external `AbortSignal` to cancel a running flow
- **Database transactions** — wrap steps in `db.transaction()` with any ORM (Drizzle, Knex, Prisma)
- **Event publishing** — emit domain events to named channels with automatic correlation IDs
- **Parallel execution** — run independent steps concurrently with configurable merge strategies
- **Conditional steps & early exit** — skip steps based on runtime conditions or short-circuit the flow entirely
- **Composable sub-flows** — extract and reuse step sequences via `.pipe()`
- **Observability hooks** — plug in logging, metrics, or tracing through the observer interface
- **Durable execution (opt-in)** — checkpoint after each step so a crashed run resumes from the next undone step instead of starting over
- **Zero dependencies** — runs in-process with no external infrastructure

## Guide

### Creating a flow

`createFlow` returns a builder. Chain steps onto it and call `.build()` to get an executable flow.

```typescript
import { createFlow } from '@celom/prose';

const flow = createFlow<{ orderId: string }>('process-order')
  .step('fetch', async (ctx) => {
    const order = await db.getOrder(ctx.input.orderId);
    return { order };
  })
  .step('charge', async (ctx) => {
    const receipt = await payments.charge(ctx.state.order.total);
    return { receipt };
  })
  .build();
```

The generic parameter defines the input shape. TypeScript infers the state type as steps accumulate — after the `fetch` step, `ctx.state.order` is available with full type information.

### Running a flow

```typescript
const result = await flow.execute(
  { orderId: 'ord_123' }, // input
  { db, eventPublisher }, // dependencies
  { timeout: 30_000 } // options (optional)
);
```

**Execution options:**

| Option          | Type           | Description                                       |
| --------------- | -------------- | ------------------------------------------------- |
| `timeout`       | `number`       | Max duration for the entire flow (ms)             |
| `stepTimeout`   | `number`       | Default max duration per step (ms)                |
| `signal`        | `AbortSignal`  | External signal for cancellation                  |
| `observer`      | `FlowObserver` | Lifecycle hooks for logging/metrics               |
| `throwOnError`  | `boolean`      | `false` returns partial state instead of throwing |
| `correlationId` | `string`       | Custom ID propagated to events and observers      |
| `errorHandling` | `object`       | Control behavior for missing deps (see below)     |

### Validation

Validation steps run before processing and are never retried. Throw `ValidationError` to fail fast.

```typescript
import { ValidationError } from '@celom/prose';

flow.validate('checkInput', (ctx) => {
  if (ctx.input.amount <= 0)
    throw ValidationError.single('amount', 'Must be positive');
});
```

`ValidationError` accepts an optional array of issues for multi-field validation:

```typescript
throw new ValidationError('Validation failed', [
  { field: 'email', message: 'Required' },
  { field: 'age', message: 'Must be at least 18' },
]);
```

### Retries

Chain `.withRetry()` after any step to add a retry policy.

```typescript
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
    stepTimeout: 10_000, // override the flow-level stepTimeout for this step
  });
```

| Option              | Type                 | Default    | Description                                  |
| ------------------- | -------------------- | ---------- | -------------------------------------------- |
| `maxAttempts`       | `number`             | —          | Total attempts (including the first)         |
| `delayMs`           | `number`             | —          | Initial delay between retries                |
| `backoffMultiplier` | `number`             | `1`        | Multiplier applied to delay after each retry |
| `maxDelayMs`        | `number`             | `Infinity` | Upper bound on delay                         |
| `shouldRetry`       | `(error) => boolean` | —          | Predicate to conditionally retry             |
| `stepTimeout`       | `number`             | —          | Timeout override for this step               |

### Timeouts & cancellation

```typescript
const controller = new AbortController();

const result = await flow.execute(input, deps, {
  timeout: 30_000, // abort if the flow exceeds 30s
  stepTimeout: 5_000, // abort any step that exceeds 5s
  signal: controller.signal, // cancel from outside
});

// later, to cancel:
controller.abort();
```

Inside step handlers, `ctx.signal` exposes the combined signal so you can pass it to fetch, database calls, or check `ctx.signal.aborted` for cooperative cancellation.

```typescript
flow.step('longOperation', async (ctx) => {
  const resp = await fetch(url, { signal: ctx.signal });
  return { data: await resp.json() };
});
```

### Conditional steps

`stepIf` runs the handler only when the condition returns `true`. Skipped steps don't affect state and don't consume retry attempts.

```typescript
flow
  .step('checkCache', (ctx) => {
    return { cached: cache.has(ctx.input.key) };
  })
  .stepIf(
    'fromCache',
    (ctx) => ctx.state.cached,
    (ctx) => {
      return { value: cache.get(ctx.input.key) };
    }
  )
  .stepIf(
    'fromDb',
    (ctx) => !ctx.state.cached,
    async (ctx) => {
      return { value: await db.get(ctx.input.key) };
    }
  );
```

### Early exit with breakIf

`breakIf` short-circuits the flow, skipping all remaining steps **and** the `.map()` transformer. An optional second argument defines the return value.

```typescript
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
```

### Database transactions

Use `.transaction()` to wrap a step in `db.transaction()`. The transaction client is passed as the second argument.

```typescript
flow.transaction('persist', async (ctx, tx) => {
  const id = await tx.insert('users', { name: ctx.input.name });
  return { userId: id };
});
```

Requires a `db` dependency conforming to:

```typescript
interface DatabaseClient {
  transaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T>;
}
```

Works with Drizzle, Knex, Prisma, or any ORM exposing a `transaction()` method.

### Event publishing

Emit domain events to named channels. Events are automatically enriched with `correlationId`.

```typescript
// single event
flow.event('orders', (ctx) => ({
  eventType: 'order.created',
  orderId: ctx.state.orderId,
}));

// multiple events on the same channel
flow.events('notifications', [
  (ctx) => ({ eventType: 'email.send', to: ctx.input.email }),
  (ctx) => ({ eventType: 'sms.send', to: ctx.input.phone }),
]);
```

Requires an `eventPublisher` dependency conforming to:

```typescript
interface FlowEventPublisher {
  publish(channel: string, event: FlowEvent): Promise<void> | void;
}
```

### Parallel execution

Run independent handlers concurrently and merge results into state.

```typescript
flow.parallel(
  'fetchAll',
  'deep',
  async (ctx) => ({ users: await fetchUsers() }),
  async (ctx) => ({ posts: await fetchPosts() })
);
// ctx.state now has both `users` and `posts`
```

**Merge strategies:**

| Strategy              | Behavior                                                |
| --------------------- | ------------------------------------------------------- |
| `'shallow'`           | `Object.assign()` — later results override earlier ones |
| `'error-on-conflict'` | Throws if any keys overlap between results              |
| `'deep'`              | Recursive merge; arrays are concatenated                |

### Output transformation

`.map()` transforms the accumulated state into a custom output shape.

```typescript
flow
  .step('fetch', async (ctx) => {
    const user = await db.getUser(ctx.input.id);
    return { user };
  })
  .map((input, state) => ({
    id: state.user.id,
    displayName: state.user.name,
  }))
  .build();
```

### Composable sub-flows with .pipe()

Extract reusable step sequences as functions and compose them with `.pipe()`.

```typescript
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
    // ctx.state.user is fully typed here
    return { result: `Hello, ${ctx.state.user.name}` };
  })
  .build();
```

### Observability

Pass an observer to hook into flow and step lifecycle events.

```typescript
import { PinoFlowObserver } from '@celom/prose';
import pino from 'pino';

const logger = pino();
const observer = new PinoFlowObserver(logger);

await flow.execute(input, deps, { observer });
```

**Observer hooks:**

| Hook             | Called when                           |
| ---------------- | ------------------------------------- |
| `onFlowStart`    | Flow begins                           |
| `onFlowComplete` | Flow finishes successfully            |
| `onFlowError`    | Flow fails                            |
| `onFlowBreak`    | Flow exits early via `breakIf`        |
| `onStepStart`    | Step begins                           |
| `onStepComplete` | Step finishes                         |
| `onStepError`    | Step fails (after exhausting retries) |
| `onStepRetry`    | Step is about to be retried           |
| `onStepSkipped`  | Conditional step is skipped           |

All hooks are optional — implement only what you need:

```typescript
await flow.execute(input, deps, {
  observer: {
    onStepComplete: (name, _result, duration) =>
      console.log(`${name} took ${duration}ms`),
  },
});
```

**Built-in observers:** `DefaultObserver` (console), `NoOpObserver` (silent), `PinoFlowObserver` (structured logging).

### Error handling

By default, step errors are wrapped in `FlowExecutionError` and thrown.

```typescript
import {
  FlowExecutionError,
  ValidationError,
  TimeoutError,
} from '@celom/prose';

try {
  await flow.execute(input, deps);
} catch (err) {
  if (err instanceof ValidationError) {
    // fail-fast validation — err.issues has field-level details
  } else if (err instanceof TimeoutError) {
    // flow or step exceeded its timeout
  } else if (err instanceof FlowExecutionError) {
    // step execution failure — err.stepName, err.originalError
  }
}
```

Set `throwOnError: false` to return partial state instead of throwing:

```typescript
const result = await flow.execute(input, deps, { throwOnError: false });
```

Control behavior when optional dependencies are missing:

```typescript
await flow.execute(input, deps, {
  errorHandling: {
    throwOnMissingDatabase: false, // warn instead of throwing
    throwOnMissingEventPublisher: false, // warn instead of throwing
  },
});
```

### Flow metadata

Every step handler receives `ctx.meta` with runtime metadata:

```typescript
flow.step('example', (ctx) => {
  ctx.meta.flowName; // 'process-order'
  ctx.meta.currentStep; // 'example'
  ctx.meta.startedAt; // Date
  ctx.meta.correlationId; // auto-generated or custom
  ctx.meta.runId; // present only when durability is configured
  ctx.meta.idempotencyKey; // `${runId}:${stepName}` — pass to external APIs
  ctx.meta.isResuming; // true when this execution loaded a saved checkpoint
});
```

### Durability

Opt-in skip-ahead checkpointing. After every successful step, Prose persists a checkpoint to the configured store. Re-invoking `execute()` with the same `runId` resumes from the next undone step. Re-invoking on a completed run returns the saved result without re-execution.

```typescript
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
    await db.orders.upsert({
      id: ctx.input.orderId,
      receiptId: ctx.state.receipt.id,
    });
  })
  .build();

// First call — crashes after chargePayment, before persistOrder
await processOrder.execute(
  { orderId: 'ord_42' },
  { db, payments },
  {
    durability: { store, runId: 'ord_42' },
  }
);

// After restart — chargePayment is skipped, persistOrder runs
await processOrder.execute(
  { orderId: 'ord_42' },
  { db, payments },
  {
    durability: { store, runId: 'ord_42' },
  }
);
```

The three behaviors of `execute()` with a `durability` option:

| Stored status        | Behavior                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| _no checkpoint_      | Fresh run — every step executes                                                                     |
| `running` / `failed` | Resume — completed steps are skipped, state is loaded, execution continues at the first undone step |
| `completed`          | Replay — the saved result is returned without invoking any handler                                  |

A step may run twice across a crash. `ctx.meta.idempotencyKey` is a stable per-step key (`${runId}:${stepName}`) — pass it to Stripe, SQS, or any external API that supports idempotency.

`MemoryDurabilityStore` is for tests and dev. For production, implement the three-method `DurabilityStore` interface against your own persistence layer. A conformance test suite lives at `src/lib/__tests__/store-conformance.ts` (not re-exported — deep-import or copy-vendor for now).

See [the durability guide](https://celom.github.io/prose/guides/durability/) for feature interactions, patterns, and the full idempotency contract.

## MCP Server

Prose includes a built-in [Model Context Protocol](https://modelcontextprotocol.io/) server that helps AI assistants write correct flow code. It provides tools for scaffolding, analyzing, listing, and validating flows, along with API reference resources and interactive prompts.

Add to your MCP client configuration (Claude Code, Cursor, etc.):

```json
{
  "mcpServers": {
    "prose": {
      "command": "npx",
      "args": ["-y", "@celom/prose", "mcp"]
    }
  }
}
```

## What this isn't

Prose is an **in-process** workflow orchestration library. It runs inside your existing Node.js process with zero external dependencies. Before adopting it, it's worth understanding what it does _not_ try to be:

**Not a Temporal replacement.** Prose ships opt-in [skip-ahead durability](https://celom.github.io/prose/guides/durability/) — successful steps are checkpointed, and re-invoking `execute()` with the same `runId` resumes from the next undone step or replays the saved result. That covers crash recovery for in-process flows. It does **not** give you long sleeps that survive process death (`await sleep(7.days)`), an automatic resumer that re-invokes crashed runs for you, or distributed worker claim/lease coordination. For those, reach for [Temporal](https://temporal.io), [Inngest](https://www.inngest.com), or [Trigger.dev](https://trigger.dev).

**Not a full effect system.** [Effect-TS](https://effect.website) is more powerful in every technical dimension — typed errors in the return signature, type-level dependency injection via Layers, fibers, streams, and a massive standard library. If your team can invest in learning its functional programming model, Effect is the more capable choice. Prose trades that power for simplicity: pure async/await, no monads, no new paradigms to learn.

**Not a state machine.** [XState](https://stately.ai/docs/xstate) models workflows as finite state machines with explicit states, transitions, and guards — ideal for complex non-linear flows with many possible state transitions. Prose is designed for sequential (or branching) business logic pipelines where a state machine's verbosity would be overhead.

**Not a result type library.** Libraries like [neverthrow](https://github.com/supermacro/neverthrow) or [fp-ts](https://github.com/gcanti/fp-ts) encode errors in return types (`Result<T, E>`, `Either<E, A>`). Prose does not — steps throw, and failures are wrapped in `FlowExecutionError`. If typed error channels are critical to you, Effect or neverthrow are better fits.

### Where Prose fits

Prose is for teams building backend services with multi-step business logic (process an order, onboard a user, handle a payment) who want structured retries, timeouts, transactions, observability, and type-safe state threading — without adopting new infrastructure or a new programming paradigm.

## License

MIT
