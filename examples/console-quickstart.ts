/**
 * Local-dev script that boots the Prose Console server and fires a
 * synthetic flow every 2s so the SPA has something to render.
 *
 * Run from the repo root with:
 *
 *     npm exec nx build prose prose-observer
 *     node --experimental-strip-types examples/console-quickstart.ts
 *
 * Then open http://127.0.0.1:4000 (production bundle) or open the Vite
 * dev server at http://localhost:4200 — the proxy in
 * apps/console/vite.config.mts forwards /api and /stream to port 4000.
 *
 * Ctrl-C stops both the flow loop and the HTTP server.
 */

import { randomUUID } from 'node:crypto';

import { createFlow } from '@celom/prose';
import { consoleObserver, startServer } from '@celom/prose-observer';

type Deps = Record<string, never>;

interface Input {
  userId: string;
  authorization: string;
}

const flow = createFlow<Input, Deps>('demo.order.create')
  .step('validate', (ctx) => {
    if (!ctx.input.userId.startsWith('u')) {
      throw new Error('invalid userId');
    }
  })
  .step('fetch-user', (ctx) => ({
    user: { id: ctx.input.userId, name: 'Alice' },
  }))
  .step('build-order', () => ({
    order: { items: ['pen', 'paper'], total: 12.5 },
  }))
  .parallel(
    'notify',
    'shallow',
    () => ({ emailQueued: true }),
    () => ({ smsQueued: true })
  )
  .step('persist', () => ({ persisted: true }))
  .build();

async function main(): Promise<void> {
  const observer = consoleObserver<Input, Deps>();
  const server = await startServer({
    port: 4000,
    eventStream: observer.events,
  });
  // eslint-disable-next-line no-console
  console.log(`Prose Console: ${server.url}`);

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    // eslint-disable-next-line no-console
    console.log('\nshutting down…');
    await server.close();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  while (!stopped) {
    const userId = Math.random() < 0.1 ? 'invalid' : `u${Date.now()}`;
    try {
      await flow.execute(
        { userId, authorization: `Bearer ${randomUUID()}` },
        {},
        { observer, correlationId: randomUUID() }
      );
    } catch {
      // Flow errors are surfaced via flow.error events; swallow here so the
      // loop keeps producing variety for the catalog view.
    }
    await new Promise((res) => setTimeout(res, 2000));
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
