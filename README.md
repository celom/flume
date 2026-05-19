# Prose

Declarative workflow DSL for orchestrating complex business operations in Javascript/Typescript.

```typescript
const flow = createFlow<{ orderId: string }>('process-order')
  .validate('checkInput', (ctx) => {
    /* ... */
  })
  .step('fetchOrder', async (ctx) => {
    /* ... */
  })
  .step('chargePayment', async (ctx) => {
    /* ... */
  })
  .withRetry({ maxAttempts: 3, delayMs: 200, backoffMultiplier: 2 })
  .event('orders', (ctx) => ({
    eventType: 'order.charged',
    orderId: ctx.state.order.id,
  }))
  .build();

await flow.execute({ orderId: 'ord_123' }, { db, eventPublisher });
```

Type-safe state threading, retries with exponential backoff, timeouts, database transactions, event publishing, parallel execution, durability, and observability hooks — using plain async/await with zero dependencies.

## Packages

| Package                           | Description           |
| --------------------------------- | --------------------- |
| [`@celom/prose`](packages/prose/) | Core workflow library |

## Development

This is an [Nx](https://nx.dev) monorepo.

```bash
# install dependencies
npx install

# run tests
npm nx test prose

# build
npm nx build prose
```

## Credits

Created and maintained by [Carlos Mimoso](https://github.com/celom).

## License

MIT
