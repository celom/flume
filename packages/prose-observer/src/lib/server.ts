import { existsSync, promises as fs } from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath, URL as NodeURL } from 'node:url';

import { WebSocketServer, type WebSocket } from 'ws';

import { aggregateExecutions } from './aggregate.js';
import type { EventStream } from './event-stream.js';
import type { ObserverEvent } from './events.js';

export interface StartServerOptions {
  /** Defaults to 4000. Pass 0 to let the OS pick. */
  port?: number;
  /** Defaults to `127.0.0.1`. Non-loopback hosts require `allowRemote: true`. */
  host?: string;
  /**
   * Opt-in to bind to a non-loopback interface. Defaults to false — the
   * Console has no auth and the streamed payloads can include sensitive
   * input/state. Set explicitly when you accept the risk.
   */
  allowRemote?: boolean;
  /** The stream that feeds the JSON + WS endpoints. */
  eventStream: EventStream;
  /**
   * Filesystem directory served at `GET /*`. Slice 9 wires the bundled SPA
   * here; leave undefined for API-only setups.
   */
  staticDir?: string | URL;
}

export interface StartedServer {
  /** Where the server is actually listening (after `port: 0` resolution). */
  readonly url: string;
  readonly port: number;
  readonly host: string;
  /** Closes WS + HTTP cleanly. Idempotent. */
  close(): Promise<void>;
}

const DEFAULT_PORT = 4000;
const DEFAULT_HOST = '127.0.0.1';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
/**
 * Max WS events held in a per-subscriber buffer before we start dropping the
 * OLDEST entries and surfacing a `{ type: 'dropped', count }` heartbeat.
 */
const WS_QUEUE_HIGH_WATER = 256;

/**
 * Resolves the bundled SPA directory shipped inside `dist/static/`.
 *
 * Two cases:
 *   1. Production / consumer install — `import.meta.url` points at
 *      `dist/index.js`, so `./static/` lives right next to it.
 *   2. In-repo source mode (running from TS via `customConditions`) — fall
 *      back to `<workspaceRoot>/apps/console/dist`, which the dev `vite dev`
 *      target keeps up-to-date.
 *
 * Returns `undefined` when neither exists — the server boots in API-only
 * mode and `GET /` returns 404.
 */
export function resolveDefaultStaticDir(): string | undefined {
  // Built mode: dist/index.js sibling.
  const bundled = fileURLToPath(new NodeURL('./static/', import.meta.url));
  if (existsSync(bundled)) return bundled;

  // Source mode: src/lib/server.ts → workspaceRoot/apps/console/dist
  if (import.meta.url.includes('/src/lib/')) {
    const fromSrc = fileURLToPath(
      new NodeURL('../../../../apps/console/dist/', import.meta.url)
    );
    if (existsSync(fromSrc)) return fromSrc;
  }
  return undefined;
}

export async function startServer(
  options: StartServerOptions
): Promise<StartedServer> {
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? DEFAULT_HOST;
  const allowRemote = options.allowRemote ?? false;
  const staticDir = options.staticDir ?? resolveDefaultStaticDir();

  if (!LOOPBACK_HOSTS.has(host) && !allowRemote) {
    throw new Error(
      `[prose-observer] refusing to bind to non-loopback host '${host}' ` +
        `without allowRemote: true. The Console has no auth.`
    );
  }
  if (!LOOPBACK_HOSTS.has(host) && allowRemote) {
    console.warn(
      `\x1b[31m[prose-observer] binding to ${host}:${port}. No auth — ` +
        `flow inputs/state are exposed to anyone on the network.\x1b[0m`
    );
  }

  const resolvedOptions: StartServerOptions = { ...options, staticDir };

  const http = createServer((req, res) => {
    handleHttpRequest(req, res, resolvedOptions).catch((err) => {
      console.error('[prose-observer] request failed', err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'internal_error' });
      } else {
        res.end();
      }
    });
  });

  const wss = new WebSocketServer({ noServer: true });
  http.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/stream') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wireStreamSocket(ws, options.eventStream);
      });
    } else {
      socket.destroy();
    }
  });

  await new Promise<void>((res, rej) => {
    const onError = (err: Error) => {
      http.removeListener('error', onError);
      rej(err);
    };
    http.once('error', onError);
    http.listen(port, host, () => {
      http.removeListener('error', onError);
      res();
    });
  });

  const address = http.address();
  const actualPort =
    typeof address === 'object' && address !== null ? address.port : port;

  return {
    url: `http://${host}:${actualPort}`,
    port: actualPort,
    host,
    async close() {
      await new Promise<void>((res) => {
        // Close WS connections first so http.close() can drain.
        for (const client of wss.clients) {
          try {
            client.terminate();
          } catch {
            // ignore — connection might already be gone
          }
        }
        wss.close(() => {
          http.close(() => res());
        });
      });
    },
  };
}

async function handleHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: StartServerOptions
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (path === '/healthz') return sendJson(res, 200, { ok: true });

  if (path === '/api/executions') {
    return sendJson(res, 200, opts.eventStream.listExecutions());
  }

  if (path.startsWith('/api/executions/')) {
    const cid = decodeURIComponent(path.slice('/api/executions/'.length));
    const record = opts.eventStream.getExecution(cid);
    if (!record) return sendJson(res, 404, { error: 'not_found' });
    return sendJson(res, 200, record);
  }

  if (path === '/api/flows') {
    return sendJson(
      res,
      200,
      aggregateExecutions(opts.eventStream.listRecords())
    );
  }

  // Fall through to static serving when configured.
  if (opts.staticDir) {
    const served = await tryServeStatic(res, opts.staticDir, path);
    if (served) return;
  }

  sendJson(res, 404, { error: 'not_found' });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function tryServeStatic(
  res: ServerResponse,
  staticDir: string | URL,
  urlPath: string
): Promise<boolean> {
  const dir = staticDir instanceof URL ? fileURLToPath(staticDir) : staticDir;
  const rooted = resolve(dir);
  const requested = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
  const resolved = resolve(join(rooted, requested));
  if (!resolved.startsWith(rooted)) {
    // path traversal attempt
    sendJson(res, 403, { error: 'forbidden' });
    return true;
  }
  try {
    const data = await fs.readFile(resolved);
    res.writeHead(200, {
      'content-type': mimeFor(extname(resolved)),
      'content-length': data.length,
    });
    res.end(data);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    if ((err as NodeJS.ErrnoException).code === 'EISDIR') {
      // Try index.html inside the directory before giving up.
      try {
        const indexPath = resolve(join(resolved, 'index.html'));
        const data = await fs.readFile(indexPath);
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-length': data.length,
        });
        res.end(data);
        return true;
      } catch {
        return false;
      }
    }
    throw err;
  }
}

function mimeFor(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'application/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.ico':
      return 'image/x-icon';
    case '.map':
      return 'application/json; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Wire one WS client. Backpressure model: buffer events into a small queue,
 * flush once per `setImmediate` tick. When the queue hits high-water,
 * drop OLDEST events and surface the count to the client so it can
 * re-fetch the affected execution from `/api/executions/:id`.
 */
function wireStreamSocket(ws: WebSocket, stream: EventStream): void {
  let queue: ObserverEvent[] = [];
  let dropped = 0;
  let scheduled = false;

  const flush = () => {
    scheduled = false;
    if (ws.readyState !== ws.OPEN) {
      queue = [];
      dropped = 0;
      return;
    }
    if (dropped > 0) {
      safeSend(ws, JSON.stringify({ type: 'dropped', count: dropped }));
      dropped = 0;
    }
    if (queue.length > 0) {
      const batch = queue;
      queue = [];
      for (const event of batch) {
        safeSend(ws, JSON.stringify(event));
      }
    }
  };

  const unsubscribe = stream.subscribe((event) => {
    if (queue.length >= WS_QUEUE_HIGH_WATER) {
      queue.shift();
      dropped++;
    }
    queue.push(event);
    if (!scheduled) {
      scheduled = true;
      setImmediate(flush);
    }
  });

  ws.on('close', () => {
    unsubscribe();
  });
  ws.on('error', () => {
    unsubscribe();
  });
}

function safeSend(ws: WebSocket, data: string): void {
  try {
    ws.send(data);
  } catch {
    // Connection may have closed mid-flush. Drop and rely on `close` to clean up.
  }
}
