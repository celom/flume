import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ExecutionRecord } from '@celom/prose-observer';

import { fetchExecution } from '../api';

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; record: ExecutionRecord };

/**
 * Slice 5 placeholder. Pulls the execution record for `?correlationId=...`
 * and dumps the raw events as a list — intentionally ugly. Slice 6
 * replaces this view with the Gantt timeline + diff inspector.
 */
export function TraceView() {
  const [params] = useSearchParams();
  const cid = params.get('correlationId');
  const [state, setState] = useState<State>({ kind: 'idle' });

  useEffect(() => {
    if (!cid) {
      setState({ kind: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ kind: 'loading' });
    fetchExecution(cid)
      .then((record) => {
        if (cancelled) return;
        setState(record ? { kind: 'loaded', record } : { kind: 'not-found' });
      })
      .catch((err: Error) => {
        if (!cancelled) setState({ kind: 'error', message: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [cid]);

  if (!cid) {
    return (
      <div className="p-6 font-mono text-sm">
        <p>
          Append <code>?correlationId=&lt;id&gt;</code> to the URL.
        </p>
        <p>
          See <a href="/catalog">/catalog</a> or{' '}
          <a href="/live">/live</a> to find one.
        </p>
      </div>
    );
  }

  if (state.kind === 'loading' || state.kind === 'idle') {
    return <div className="p-6 font-mono text-sm">Loading…</div>;
  }
  if (state.kind === 'not-found') {
    return (
      <div className="p-6 font-mono text-sm">
        No execution with correlationId <code>{cid}</code>.
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="p-6 font-mono text-sm text-red-600">
        Error: {state.message}
      </div>
    );
  }

  const { record } = state;
  return (
    <div className="p-6 font-mono text-sm">
      <h1 className="text-lg font-bold">{record.flowName}</h1>
      <p className="text-gray-600">
        <code>{record.correlationId}</code> · {record.status}
        {typeof record.durationMs === 'number'
          ? ` · ${record.durationMs}ms`
          : ''}
      </p>
      <ul className="mt-4 space-y-1">
        {record.events.map((event, i) => (
          <li key={i} data-testid="event-row">
            <span className="inline-block w-32 text-blue-700">{event.type}</span>
            <code className="text-gray-700">
              {JSON.stringify(event).slice(0, 240)}
            </code>
          </li>
        ))}
      </ul>
    </div>
  );
}
