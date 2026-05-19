# @celom/prose-observer

Local-dev observability for [`@celom/prose`](https://www.npmjs.com/package/@celom/prose) flows.

This package ships:

- A `FlowObserver` implementation that records every flow + step lifecycle event into an in-memory ring buffer.
- An HTTP + WebSocket server bound to `127.0.0.1` by default.
- The Prose Console SPA (bundled at install time) — trace view (Gantt + state diff), catalog (per-flow run counts, p50/p95, error rate), and live tail (WS feed).

Install alongside `@celom/prose` when you want a UI for debugging flows.

## Install

```sh
npm install --save-dev @celom/prose-observer
```

## Quickstart

```typescript
import { createFlow } from '@celom/prose';
import {
  consoleObserver,
  mergeObservers,
  startServer,
} from '@celom/prose-observer';

const observer = consoleObserver();
const server = await startServer({ port: 4000, eventStream: observer.events });
console.log(`Prose Console: ${server.url}`);

const flow = createFlow<{ userId: string }, never>('demo')
  .step('fetch', (ctx) => ({ user: { id: ctx.input.userId, name: 'Alice' } }))
  .step('enrich', () => ({ enriched: true }))
  .build();

await flow.execute(
  { userId: 'u1' },
  {},
  { observer, correlationId: crypto.randomUUID() }
);
```

Open `http://127.0.0.1:4000` to see the trace.

To run both `pinoObserver()` and `consoleObserver()` on the same flow (since `execute` takes a single observer):

```typescript
import { pinoObserver } from '@celom/prose';

await flow.execute(input, deps, {
  observer: mergeObservers(pinoObserver(logger), consoleObserver()),
  correlationId: crypto.randomUUID(),
});
```

## Standalone CLI

The package also ships a `prose-console` binary that boots an API-only server (no in-process flows; useful when feeding events from elsewhere).

```sh
# Bin directly:
npx prose-console --port=4321

# Or via the @celom/prose CLI:
npx prose console --port=4321
```

Options:

- `--port=<n>` — HTTP/WS port (default `4000`)
- `--host=<host>` — bind interface (default `127.0.0.1`)
- `--max-executions=<n>` — ring buffer size (default `100`)

## Options for `consoleObserver()`

```typescript
interface ConsoleObserverOptions {
  /** Ring buffer size for retained executions. Default 100. */
  maxExecutions?: number;
  /** 'diff' (default) | 'full' | 'off'. */
  stateCapture?: StateCaptureMode;
  /** Final transform per event. Return null to drop. */
  redact?: (event: ObserverEvent) => ObserverEvent | null;
}
```

### Redaction

Every event runs through a default redaction pass that walks the payload (8 levels deep, cycle-safe) and replaces the value of any property whose name matches one of these (case-insensitive):

`authorization, password, apikey, api_key, secret, token, accesstoken, refreshtoken, creditcard, cardnumber, cvv, ssn, pin, cookie, set-cookie`

Compose a custom `redact` function for more keys or to drop noisy events:

```typescript
consoleObserver({
  redact: (event) => {
    if (event.type === 'step.skipped') return null; // drop
    return event;
  },
});
```

### State capture

`stateCapture: 'diff'` (default) attaches `{ added, removed, changed }` to every `step.complete` event. Switch to `'full'` for before/after snapshots — only practical for small state. `'off'` omits state entirely. The observer warns once if a `'full'` snapshot exceeds 1MB.

## Security notes

- The server binds to `127.0.0.1` by default. Pass `allowRemote: true` to bind elsewhere — the observer logs a red startup warning and there is no auth in v1.
- Event payloads can carry user input + state. The default redaction is your last line of defence; review the redacted output before shipping the Console anywhere shared.
- Treat the Console as a local-dev tool. Don't expose its endpoints from production processes.

## Known v1 limitations

- **Parallel sub-branches** render as one Gantt bar. `@celom/prose` emits a single `step.start`/`step.complete` pair per `.parallel()` group; lane separation is gated on a future API change for named sub-handlers.
- **No cross-restart persistence.** The ring buffer is in-memory only; restarting the process loses retained executions. Durability-store readback is on the v1.1 roadmap.
- **Catalog covers executed flows only.** Flows that never ran during this process don't appear. Pulling definitions from MCP `analyze-flow` for "static" entries is a follow-up.
- **Concurrent runs of the same flow** without a caller-supplied `correlationId` can cross-attribute their flow-level events. Pass `options.correlationId` to your `flow.execute()` calls (the observer warns once per process when missing).

## License

MIT — see [LICENSE](../../LICENSE).
