import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { connectStream, type StreamMessage } from '../api';

const MAX_ROWS = 500;

export type Subscribe = (
  onEvent: (event: StreamMessage) => void,
) => () => void;

export interface LiveViewProps {
  /** Override the WS subscription for tests. Defaults to `connectStream` from the api. */
  subscribe?: Subscribe;
}

export function LiveView({ subscribe = connectStream }: LiveViewProps) {
  const [rows, setRows] = useState<StreamMessage[]>([]);
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const tailRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const close = subscribe((event) => {
      if (pausedRef.current) return;
      setRows((prev) => {
        const next = prev.length >= MAX_ROWS ? prev.slice(1) : prev.slice();
        next.push(event);
        return next;
      });
    });
    return close;
  }, [subscribe]);

  useEffect(() => {
    // `scrollIntoView` is missing under jsdom; guard so tests don't blow up.
    if (autoScroll && typeof tailRef.current?.scrollIntoView === 'function') {
      tailRef.current.scrollIntoView({ block: 'end' });
    }
  }, [rows, autoScroll]);

  return (
    <div className="p-6 font-mono text-xs">
      <header className="mb-3 flex items-center gap-3">
        <h1 className="text-sm font-semibold text-gray-800">Live tail</h1>
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          className="rounded border border-gray-300 px-2 py-0.5 text-gray-700 hover:bg-gray-50"
          data-testid="pause-toggle"
        >
          {paused ? '▶ resume' : '❚❚ pause'}
        </button>
        <label className="flex items-center gap-1 text-gray-600">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            data-testid="autoscroll-toggle"
          />
          auto-scroll
        </label>
        <span className="ml-auto text-gray-500" data-testid="row-count">
          {rows.length} {rows.length === MAX_ROWS ? '(cap)' : ''}
        </span>
      </header>
      <ul
        className="space-y-0.5"
        data-testid="live-feed"
        aria-live={paused ? 'off' : 'polite'}
      >
        {rows.map((row, i) => (
          <li
            key={i}
            onClick={() => onRowClick(row, navigate)}
            className={rowClass(row)}
            data-testid="live-row"
            data-type={row.type}
          >
            <LiveRow event={row} />
          </li>
        ))}
      </ul>
      <div ref={tailRef} />
    </div>
  );
}

function onRowClick(
  row: StreamMessage,
  navigate: ReturnType<typeof useNavigate>,
): void {
  if (row.type === 'dropped') return;
  navigate(
    `/?correlationId=${encodeURIComponent(row.correlationId)}`,
  );
}

function rowClass(row: StreamMessage): string {
  const base = 'cursor-pointer rounded px-2 py-0.5';
  if (row.type === 'dropped')
    return `${base} bg-amber-50 text-amber-800`;
  if (row.type === 'flow.error' || row.type === 'step.error')
    return `${base} text-red-700 hover:bg-red-50`;
  if (row.type === 'flow.break')
    return `${base} text-purple-700 hover:bg-purple-50`;
  return `${base} text-gray-700 hover:bg-gray-50`;
}

function LiveRow({ event }: { event: StreamMessage }) {
  if (event.type === 'dropped') {
    return (
      <span>
        <span role="img" aria-label="warning">
          ⚠️
        </span>{' '}
        dropped {event.count} backpressured event
        {event.count === 1 ? '' : 's'} — refresh the trace view to backfill
      </span>
    );
  }
  const detail =
    'stepName' in event && event.stepName ? ` · ${event.stepName}` : '';
  const time = new Date(event.ts).toISOString().slice(11, 23);
  return (
    <span>
      <span className="mr-2 text-gray-500">{time}</span>
      <span className="inline-block w-32 text-blue-700">{event.type}</span>
      <span className="inline-block w-48 truncate text-gray-700">
        {event.flowName}
        {detail}
      </span>
      <span className="text-gray-500">{event.correlationId.slice(0, 8)}</span>
    </span>
  );
}
