import { createFlow } from '@celom/prose';
import { afterEach } from 'vitest';
import { WebSocket } from 'ws';

import type { ObserverEvent } from '../events.js';
import { consoleObserver } from '../observer.js';
import { startServer, type StartedServer } from '../server.js';

type EmptyDeps = Record<string, never>;

let server: StartedServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('startServer — HTTP', () => {
  it('binds to an ephemeral port on 127.0.0.1 by default', async () => {
    const observer = consoleObserver();
    server = await startServer({ port: 0, eventStream: observer.events });

    expect(server.host).toBe('127.0.0.1');
    expect(server.port).toBeGreaterThan(0);
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const res = await fetch(server.url + '/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('exposes the execution record + summary endpoints with the live shape', async () => {
    const observer = consoleObserver<{ x: number }, EmptyDeps>();
    server = await startServer({ port: 0, eventStream: observer.events });

    const flow = createFlow<{ x: number }, EmptyDeps>('server-flow')
      .step('one', (ctx) => ({ doubled: ctx.input.x * 2 }))
      .build();
    await flow.execute({ x: 3 }, {}, { observer });

    const summariesRes = await fetch(server.url + '/api/executions');
    const summaries = (await summariesRes.json()) as Array<{
      correlationId: string;
      flowName: string;
      status: string;
    }>;
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.flowName).toBe('server-flow');
    expect(summaries[0]?.status).toBe('completed');

    const cid = summaries[0]!.correlationId;
    const recordRes = await fetch(server.url + '/api/executions/' + cid);
    expect(recordRes.status).toBe(200);
    const record = (await recordRes.json()) as {
      correlationId: string;
      events: ObserverEvent[];
    };
    expect(record.correlationId).toBe(cid);
    expect(record.events.map((e) => e.type)).toEqual([
      'flow.start',
      'step.start',
      'step.complete',
      'flow.complete',
    ]);

    const flowsRes = await fetch(server.url + '/api/flows');
    const flows = (await flowsRes.json()) as Array<{
      flowName: string;
      runs: number;
    }>;
    expect(flows[0]).toMatchObject({ flowName: 'server-flow', runs: 1 });
  });

  it('returns 404 with a json body for an unknown execution', async () => {
    const observer = consoleObserver();
    server = await startServer({ port: 0, eventStream: observer.events });

    const res = await fetch(server.url + '/api/executions/does-not-exist');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('rejects non-GET methods', async () => {
    const observer = consoleObserver();
    server = await startServer({ port: 0, eventStream: observer.events });

    const res = await fetch(server.url + '/api/executions', {
      method: 'POST',
    });
    expect(res.status).toBe(405);
  });

  it('refuses to bind to a non-loopback host without allowRemote', async () => {
    const observer = consoleObserver();
    await expect(
      startServer({
        port: 0,
        host: '0.0.0.0',
        eventStream: observer.events,
      })
    ).rejects.toThrow(/non-loopback host/);
  });
});

describe('startServer — WS /stream', () => {
  it('pushes live events to subscribers and tags the connection on close', async () => {
    const observer = consoleObserver<{ x: number }, EmptyDeps>();
    server = await startServer({ port: 0, eventStream: observer.events });

    const wsUrl = server.url.replace(/^http/, 'ws') + '/stream';
    const ws = new WebSocket(wsUrl);
    const received: ObserverEvent[] = [];
    const done = new Promise<void>((res, rej) => {
      ws.on('message', (data) => {
        received.push(JSON.parse(String(data)) as ObserverEvent);
      });
      ws.on('error', rej);
      ws.once('open', () => res());
    });
    await done;

    const flow = createFlow<{ x: number }, EmptyDeps>('ws-flow')
      .step('one', (ctx) => ({ doubled: ctx.input.x * 2 }))
      .build();
    await flow.execute({ x: 7 }, {}, { observer });

    // The server flushes once per setImmediate tick; wait for two flushes worth.
    await new Promise((r) => setTimeout(r, 50));

    ws.close();
    await new Promise((r) => setTimeout(r, 20));

    const types = received.map((e) => e.type);
    expect(types).toEqual([
      'flow.start',
      'step.start',
      'step.complete',
      'flow.complete',
    ]);
  });

  it('rejects upgrade requests at paths other than /stream', async () => {
    const observer = consoleObserver();
    server = await startServer({ port: 0, eventStream: observer.events });
    const wsUrl = server.url.replace(/^http/, 'ws') + '/not-stream';
    const ws = new WebSocket(wsUrl);
    const err = await new Promise<Error>((resolveFn) => {
      ws.once('error', resolveFn);
      ws.once('open', () => resolveFn(new Error('unexpected open')));
    });
    expect(err).toBeInstanceOf(Error);
  });
});

describe('startServer — backpressure', () => {
  it('drops oldest queued events past the high-water mark and announces them', async () => {
    const observer = consoleObserver<{ x: number }, EmptyDeps>();
    server = await startServer({ port: 0, eventStream: observer.events });

    const wsUrl = server.url.replace(/^http/, 'ws') + '/stream';
    const ws = new WebSocket(wsUrl);
    const messages: unknown[] = [];
    await new Promise<void>((res, rej) => {
      ws.on('message', (data) => messages.push(JSON.parse(String(data))));
      ws.on('error', rej);
      ws.once('open', () => res());
    });

    // Synchronously firehose more events than the high-water mark (256).
    // All these arrive on the WS subscriber in the same microtask before the
    // setImmediate flush gets a chance to run — so the queue overflows and
    // we expect a `dropped` heartbeat.
    const TOTAL = 600;
    for (let i = 0; i < TOTAL; i++) {
      observer.events.push({
        type: 'step.start',
        correlationId: 'flood',
        flowName: 'flood-flow',
        ts: Date.now(),
        stepName: `s${i}`,
      });
    }

    await new Promise((r) => setTimeout(r, 60));
    ws.close();
    await new Promise((r) => setTimeout(r, 20));

    const droppedHeartbeat = messages.find(
      (m): m is { type: 'dropped'; count: number } =>
        typeof m === 'object' &&
        m !== null &&
        (m as { type?: unknown }).type === 'dropped'
    );
    expect(droppedHeartbeat).toBeDefined();
    expect(droppedHeartbeat!.count).toBeGreaterThan(0);

    // Total deliveries (events + dropped count) reconcile to TOTAL.
    const stepStartCount = messages.filter(
      (m) =>
        typeof m === 'object' &&
        m !== null &&
        (m as { type?: unknown }).type === 'step.start'
    ).length;
    expect(stepStartCount + droppedHeartbeat!.count).toBe(TOTAL);
  });
});
