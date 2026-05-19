<p align="center">
  <img src="assets/wordmark.svg" alt="Prose" width="280" />
</p>

<p align="center">
  Declarative workflow DSL for orchestrating complex business operations in Node.js / TypeScript.
</p>

<p align="center">
  <a href="https://celom.github.io/prose/"><strong>Documentation</strong></a> ·
  <a href="https://www.npmjs.com/package/@celom/prose">npm</a> ·
  <a href="packages/prose/README.md">Package README</a>
</p>

---

```bash
npm install @celom/prose
```

```typescript
import { createFlow, ValidationError } from '@celom/prose';

const checkout = createFlow<{ userId: string; cart: CartItem[]; coupon?: string }>('checkout')
  .validate('inputs', (ctx) => {
    if (ctx.input.cart.length === 0)
      throw ValidationError.single('cart', 'Cart is empty');
  })
  .parallel('hydrate', 'shallow',
    async (ctx) => ({ user: await db.users.find(ctx.input.userId) }),
    async (ctx) => ({ stock: await inventory.check(ctx.input.cart, { signal: ctx.signal }) }),
  )
  .breakIf(
    (ctx) => ctx.state.stock.outOfStock.length > 0,
    (ctx) => ({ status: 'out_of_stock' as const, items: ctx.state.stock.outOfStock }),
  )
  .stepIf('applyCoupon', (ctx) => !!ctx.input.coupon, async (ctx) => {
    const discount = await pricing.redeem(ctx.input.coupon!, ctx.state.user.id);
    return { discount };
  })
  .step('chargeCard', async (ctx) => {
    const receipt = await stripe.charge({
      userId: ctx.state.user.id,
      amount: total(ctx.input.cart, ctx.state.discount),
      signal: ctx.signal,
    });
    return { receipt };
  })
  .withRetry({
    maxAttempts: 3,
    delayMs: 200,
    backoffMultiplier: 2,
    shouldRetry: (e) => e.code !== 'card_declined',
  })
  .transaction('persist', async (ctx, tx) => {
    const order = await tx.orders.insert({
      userId: ctx.state.user.id,
      items: ctx.input.cart,
      receiptId: ctx.state.receipt.id,
    });
    await tx.inventory.decrement(ctx.input.cart);
    return { order };
  })
  .events('outbox', [
    (ctx) => ({ eventType: 'order.placed', orderId: ctx.state.order.id }),
    (ctx) => ({ eventType: 'payment.succeeded', receiptId: ctx.state.receipt.id }),
  ])
  .map((_, state) => ({ status: 'placed' as const, orderId: state.order.id }))
  .build();

await checkout.execute(
  { userId: 'u_42', cart, coupon: 'WELCOME10' },
  { db, stripe, inventory, pricing, eventPublisher },
  { timeout: 15_000, observer: pinoObserver, correlationId: req.id },
);
```

One flow declaration captures fail-fast validation, parallel hydration, idempotent early exit, conditional branching, retried external calls, transactional persistence, multi-event publishing, and a typed output shape — with full type-safe state threading and cooperative cancellation via `ctx.signal`. Add an opt-in [`durability` store](https://celom.github.io/prose/guides/durability/) and the same flow survives a process crash without re-running completed steps.

## Documentation

The full guide lives at **[celom.github.io/prose](https://celom.github.io/prose/)**:

- [Getting started](https://celom.github.io/prose/getting-started/) and [core concepts](https://celom.github.io/prose/core-concepts/)
- API reference: [`createFlow`](https://celom.github.io/prose/api/create-flow/), [flow builder](https://celom.github.io/prose/api/flow-builder/), [execution options](https://celom.github.io/prose/api/execution-options/), [error types](https://celom.github.io/prose/api/error-types/), [observers](https://celom.github.io/prose/api/observers/), [durability store](https://celom.github.io/prose/api/durability-store/)
- Guides: retries, timeouts & cancellation, transactions, events, parallel execution, conditional steps, sub-flows, durability, error handling, observability
- Runnable examples: [order processing](https://celom.github.io/prose/examples/order-processing/), [order processing with durability](https://celom.github.io/prose/examples/order-processing-with-durability/), [user onboarding](https://celom.github.io/prose/examples/user-onboarding/)
- [Comparison](https://celom.github.io/prose/comparison/) — when to reach for Prose versus Temporal, Inngest, Effect, or XState

## Packages

| Package | Description |
|---------|-------------|
| [`@celom/prose`](packages/prose/) | Core workflow library — see the [package README](packages/prose/README.md) |

## MCP server

Prose ships with a built-in [Model Context Protocol](https://modelcontextprotocol.io/) server that helps AI assistants write correct flow code. Add to your MCP client config:

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

See the [MCP guide](https://celom.github.io/prose/mcp/) for the tools, resources, and prompts the server exposes.

## Development

This is an [Nx](https://nx.dev) monorepo.

```bash
# install dependencies
npm install

# run tests
npx nx test prose

# build the library
npx nx build prose

# run the docs site locally
npx nx dev docs
```

## Credits

Created and maintained by [Carlos Mimoso](https://github.com/celom).

## License

MIT
