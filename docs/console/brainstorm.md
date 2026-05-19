# Prose Console — Brainstorm

> Status: exploratory. No commitments yet. Captures the shape of an observability web app for Prose flows.

## Premise

Prose already emits the right data. `FlowObserver` (`packages/prose/src/lib/observer.ts`) fires typed lifecycle events for every flow and step: start, complete, error, retry, skip, `breakIf` short-circuit. The optional durability store persists per-execution state keyed by `correlationId`. A web app does not need to add instrumentation — it needs to **render** what observers already see.

This reframes the project: not "build observability for Prose" but "build a UI on top of the observer interface."

## Why now

- Prose competes (per the docs comparison page) against Temporal, Inngest, Effect, and XState. Three of those four ship a UI. Today the Prose answer to "what did my flow just do?" is `pino` logs.
- The MCP server already does static analysis of flow definitions (`analyze-flow`, `list-flows`). That metadata is half of what a console needs — the runtime trace data is the other half.
- The durability store gives a natural persistence boundary: anything the console wants to show about a past execution either came from durability snapshots or was lost when the process exited. No need to invent a new storage layer for v1.

## Proposed shape

A new app at `apps/console/` (sibling of `apps/docs/`) plus a runtime adapter package `@celom/prose-observer`. The package bridges `FlowObserver` events into a wire format; the app renders them. End users install one package and get the UI for free.

Three views, in order of incremental value:

### 1. Trace view *(highest value, ship first)*

Pick an execution by `correlationId`. Render:

- Gantt-style timeline of steps with durations
- Retry attempts shown as stacked bars per step
- Parallel branches rendered as concurrent lanes (the `.parallel()` builder method)
- `breakIf` early exits marked visually with the return value
- `stepIf` skipped steps shown faded
- Input → state-at-step → output diff inspector at each row
- Errors expanded inline with stack trace

Nothing in the Temporal/Inngest/Effect space renders Prose-shaped *type-safe state threading* well. This view is the single biggest differentiator.

### 2. Flow catalog

List of flow definitions, statically analyzed (reuse the MCP `analyze-flow` tool output). Per flow:

- Last N executions, status, duration
- p50/p95 latency per step
- Error rate per step
- Most common `breakIf` exits

This is the "production observability" face — it answers "is checkout healthy?" not "what did this one checkout do?"

### 3. Live tail

WebSocket stream of in-flight executions. Local-dev experience like React DevTools but for flows. Lowest priority, but the easiest demo and the most useful for new users learning the DSL.

## The central fork

Before building, the scope question has to be settled:

| | Local dev tool | Production observability |
|---|---|---|
| Data source | In-process observer → WS to `localhost` | Observer → exporter → backend (DB / OTel) |
| Persistence | Ephemeral, or readback from durability store | Own retention store, indexed by correlationId |
| Auth & multi-tenancy | None | Required |
| Time to ship | ~weeks | ~quarters |
| Competes with | Nothing (gap in the space) | Temporal UI, Inngest dashboard |
| Risk | Limited reach, "yet another devtool" | Big surface, slow feedback loop |

### Recommendation: ship the local dev tool first

A `@celom/prose-observer` package that exposes a `consoleObserver({ port: 4000 })`. Users add it to their `execute()` call alongside `pinoObserver`. The UI at `localhost:4000` shows live and recent executions.

Why this order:

- **No throwaway work.** The data model (events, traces, diffs) is identical to what a hosted backend would store. Backend later just persists the same shape.
- **Concrete comparison-page artifact.** "Prose has a UI" stops being a future bullet and becomes a screenshot.
- **Tightens the dev loop for Prose users today**, including the MCP server's audience of AI coding agents that benefit from being able to "see" what a flow did.
- **Smallest production surface.** No auth, no DB, no SaaS.

## Package shape — `@celom/prose-observer`

A new package at `packages/prose-observer/`, sibling to `packages/prose/`. Depends on `@celom/prose` for the `FlowObserver` interface; the core has no reverse dependency, keeping the lib lean for users who don't want a UI.

Three jobs:

1. **Implements `FlowObserver`** — every hook becomes a typed wire event.
2. **Serves a small HTTP + WebSocket server** — bound to `127.0.0.1:4000` by default. WS streams live events; HTTP serves the static UI bundle.
3. **Holds an in-memory ring buffer** of recent executions, optionally hydrated from a durability store on startup.

The `apps/console/` Vite/Next app is the *source* of the UI. Its build output is copied into `packages/prose-observer/dist/static/` at package-build time via an Nx target dependency. End users never know `apps/console/` exists; you can `nx dev console` against a mock event stream during UI development.

### User-facing API

The whole thing a user writes:

```ts
import { consoleObserver } from '@celom/prose-observer';

const observer = consoleObserver({ port: 4000 });

await checkout.execute(input, deps, { observer, correlationId: req.id });
```

Hit `localhost:4000` in a browser. Compose with `pinoObserver` via a tiny `mergeObservers([pino, console])` helper since `execute()` takes one observer.

Options:

- `durabilityStore` — readback for past executions on startup
- `maxExecutions: 100` — ring buffer cap
- `include: (flowName) => boolean` — filter
- `redact: (event) => event` — secret scrubbing (see security boundary below)
- `host: '127.0.0.1'` — refuse to bind public by default
- `stateCapture: 'full' | 'diff' | 'shallow' | 'off'` — default `'diff'`

### Event protocol

Every observer hook becomes one event, all keyed by `correlationId`:

```
flow.start | flow.complete | flow.error | flow.break
step.start | step.complete | step.error | step.retry | step.skipped
```

Each event carries `{ correlationId, flowName, ts }` plus hook-specific payload. The UI groups by `correlationId` to build the per-execution trace; the same id lets users correlate console traces with `pino` log lines and downstream OTel spans.

This is the **single most important design choice in the package** — everything in the UI hangs off `correlationId`.

### Internal layout

```
packages/prose-observer/src/
  index.ts          # public API: consoleObserver()
  observer.ts       # FlowObserver impl → typed events
  event-stream.ts   # ring buffer + pub/sub for WS subscribers
  diff.ts           # state-before/state-after diff computation
  server.ts         # HTTP (static) + WS (events)
  cli.ts            # `npx @celom/prose console` entry
  redact.ts         # default redaction
  static/           # gitignored; populated by `nx build console`
```

### CLI form

`@celom/prose` already exposes `npx @celom/prose mcp`. A sibling `npx @celom/prose console --store=./durability.db --port=4000` lets users open the UI against a durability store without running their own process — useful for post-incident triage. The `prose` CLI delegates to the `prose-observer` package.

## Known constraints in the current observer interface

Things that need to be fixed in `packages/prose` *before* (or alongside) building the observer package:

1. **`correlationId` is optional in `execute()`** — but the wire protocol requires every event to have one. Options:
   - (a) Auto-generate a UUID per execution inside `consoleObserver` when missing, log a warning. Safe, but the user can't correlate across systems.
   - (b) Make `correlationId` required when `consoleObserver` is attached and throw loudly.

   Lean toward (a) with a one-time warning per process. Either way, this is a decision the brainstorm needs to lock before spec.

2. **Parallel branches lose structure.** `.parallel()` runs N steps concurrently and the current `FlowObserver` just sees N interleaved `onStepStart`/`onStepComplete` calls with no `parentStepName`. The UI can *guess* concurrency from timestamp overlap, but that's fragile. Clean fix: extend `FlowObserver` with an optional `parentStepName` (or `parentId`) field on step events. **This is a core-package change, not an observer-package one.** Small change, big UI payoff. Worth doing first.

## Security boundary — non-negotiable for v1

Inputs, state, and outputs will routinely contain API keys, session tokens, credit-card numbers, and PII. Default redaction has to ship with the package — it is a v1 bar, not a v2 nice-to-have.

- Strip common keys at every event boundary: `authorization`, `password`, `apiKey`, `secret`, `token`, `creditCard`, `cvv`, `ssn`, `pin`. Replace with `'[REDACTED]'`.
- Expose `redact: (event) => event` so users can plug their own scrubber on top of the defaults.
- Bind to `127.0.0.1` by default; require explicit `host: '0.0.0.0'` to expose remotely, with a startup warning.
- Document loudly in the README and the docs guide. A misconfigured observer leaking secrets over HTTP to a public port is the single worst failure mode of this package.

## Other operational concerns

- **State diff memory cost.** Serializing full state on every step doubles the memory cost of a flow. The `stateCapture` knob (above) controls this; default `'diff'`.
- **Backpressure.** High-throughput flows can flood the WS. Need a sampling strategy (always keep errors, sample successes at 1:N) or buffered batching. Pick one before shipping.
- **Hot-reload across restarts.** When a user iterates on a flow and re-runs it, the UI should *not* lose previous traces on process restart. Persist the ring buffer to disk (e.g., `~/.prose-observer/history.json`) even in local-dev mode. Small thing, big DX win.

## Open questions

These need answers before a spec gets written.

1. **Audience.** Is this for Prose users debugging their flows locally, or for Prose-the-product to compete head-to-head with Temporal/Inngest in production observability?
2. **OTel relationship.** Should the observer *replace* OpenTelemetry export for Prose users, or *complement* it — a Prose-shaped view of the same data? Strong argument for complement: don't fight existing observability stacks.
3. **Storage boundary.** Should the local dev tool persist anything across process restarts (see "hot-reload" above), or is "you killed the process, the trace is gone" acceptable for v1? Durability-store readback is a middle path.
4. **Embedding model.** SPA served by the local Node server the observer spins up? Static build hosted on `celom.github.io/prose/console/` that connects to a user-run WS endpoint? Both work; first is simpler, second is more shareable.
5. **Flow definition discovery.** Should the catalog reuse the MCP server's static analysis of `createFlow(...)` calls, or only show flows it has seen at runtime? Static analysis means catalog entries appear before any execution has happened.
6. **`correlationId` enforcement.** Auto-generate (option a) or require (option b)? See "Known constraints" above.

## What this is not (yet)

- Not a workflow scheduler. Prose runs flows; the observer watches.
- Not a competitor to Datadog / Grafana. Out of scope to graph host metrics.
- Not multi-tenant SaaS. That is the v2+ conversation, not v1.

## Next step

Resolve the audience question (open question #1) and the `correlationId` enforcement choice (open question #6). Once those land, this brainstorm becomes a `frame` artifact or a `spec` — depending on how concrete the answers get. The parallel-branch parenting fix in `packages/prose` can land in parallel; it's a small, well-scoped change with value independent of the observer package.
