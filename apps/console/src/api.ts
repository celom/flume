import type {
  ExecutionRecord,
  ExecutionSummary,
  FlowAggregate,
  ObserverEvent,
} from '@celom/prose-observer';

/**
 * WS `/stream` payloads: every `ObserverEvent` plus the backpressure
 * heartbeat the server emits when it drops oldest queued entries.
 */
export type StreamMessage = ObserverEvent | { type: 'dropped'; count: number };

export async function listExecutions(): Promise<ExecutionSummary[]> {
  const res = await fetch('/api/executions');
  if (!res.ok) throw new Error(`listExecutions failed: ${res.status}`);
  return (await res.json()) as ExecutionSummary[];
}

export async function fetchExecution(
  correlationId: string
): Promise<ExecutionRecord | null> {
  const res = await fetch(
    `/api/executions/${encodeURIComponent(correlationId)}`
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetchExecution failed: ${res.status}`);
  return (await res.json()) as ExecutionRecord;
}

export async function listFlows(): Promise<FlowAggregate[]> {
  const res = await fetch('/api/flows');
  if (!res.ok) throw new Error(`listFlows failed: ${res.status}`);
  return (await res.json()) as FlowAggregate[];
}

/**
 * Open a WS subscription to `/stream`. Returns a `close()` function — call
 * it from `useEffect` cleanup.
 *
 * Reconnects are deliberately NOT handled here in v1; the catalog/trace
 * views poll-on-mount, so a transient stream drop just means the live tail
 * stops updating until the user reloads.
 */
export function connectStream(
  onEvent: (event: StreamMessage) => void,
  onError?: (err: Event) => void
): () => void {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${window.location.host}/stream`);
  ws.onmessage = (event) => {
    try {
      onEvent(JSON.parse(event.data) as StreamMessage);
    } catch {
      // Malformed frames are silently dropped — the server only emits JSON.
    }
  };
  if (onError) ws.onerror = onError;
  return () => {
    try {
      ws.close();
    } catch {
      // ignore
    }
  };
}
