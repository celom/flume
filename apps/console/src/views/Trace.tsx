import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ExecutionRecord, ObserverEvent } from '@celom/prose-observer';

import { fetchExecution } from '../api';
import { DiffInspector } from '../components/DiffInspector';
import { Gantt, type GanttRow } from '../components/Gantt';

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; record: ExecutionRecord };

/**
 * Routing + fetch shell. Pure render lives in `TraceContent` so the component
 * can be unit-tested with a fixture record (no network mocking).
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
      <Hint>
        Append <code>?correlationId=&lt;id&gt;</code> to the URL. Find ids
        from <a href="/catalog">/catalog</a> or <a href="/live">/live</a>.
      </Hint>
    );
  }
  if (state.kind === 'loading' || state.kind === 'idle') {
    return <Hint>Loading…</Hint>;
  }
  if (state.kind === 'not-found') {
    return (
      <Hint>
        No execution with correlationId <code>{cid}</code>.
      </Hint>
    );
  }
  if (state.kind === 'error') {
    return <Hint tone="error">Error: {state.message}</Hint>;
  }

  return <TraceContent record={state.record} />;
}

export interface TraceContentProps {
  record: ExecutionRecord;
}

export function TraceContent({ record }: TraceContentProps) {
  const [selectedRow, setSelectedRow] = useState<GanttRow | null>(null);
  const selectedEvent: ObserverEvent | null = selectedRow?.closingEvent ?? null;

  return (
    <div className="space-y-4 p-6">
      <header className="font-mono text-xs">
        <div className="text-sm font-semibold text-gray-800">
          {record.flowName}
        </div>
        <div className="text-gray-600">
          <code>{record.correlationId}</code>
          {' · '}
          <span data-testid="trace-status">{record.status}</span>
          {typeof record.durationMs === 'number' ? (
            <span> · {record.durationMs}ms</span>
          ) : null}
        </div>
      </header>
      <Gantt
        record={record}
        selectedRowId={selectedRow?.id}
        onSelectRow={setSelectedRow}
      />
      <DiffInspector record={record} selectedEvent={selectedEvent} />
    </div>
  );
}

function Hint({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: 'error';
}) {
  return (
    <div
      className={`p-6 font-mono text-sm ${
        tone === 'error' ? 'text-red-600' : ''
      }`}
    >
      {children}
    </div>
  );
}
