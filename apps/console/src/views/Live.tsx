import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { connectStream, type StreamMessage } from '../api';

const MAX_ROWS = 500;

export type Subscribe = (onEvent: (event: StreamMessage) => void) => () => void;

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
    if (autoScroll && typeof tailRef.current?.scrollIntoView === 'function') {
      tailRef.current.scrollIntoView({ block: 'end' });
    }
  }, [rows, autoScroll]);

  const atCap = rows.length === MAX_ROWS;

  return (
    <div className="space-y-6">
      {/* HERO */}
      <section
        className="animate-rise grid grid-cols-12 items-end gap-6"
        style={{ ['--delay' as never]: '40ms' }}
      >
        <div className="col-span-12 md:col-span-7">
          <div className="caps mb-3 flex items-center gap-2 text-mute">
            <span className="dot dot-signal animate-pulse-signal" />
            <span>Live · streaming</span>
          </div>
          <h1 className="display text-fg-strong text-[64px] md:text-[88px]">
            Tail
          </h1>
          <p className="mt-3 max-w-xl font-mono text-[11px] text-mute-2">
            Real-time observer event feed. Click any row to open its trace.
            Drops are surfaced as amber rows.
          </p>
        </div>
        <div className="col-span-12 grid grid-cols-3 gap-3 md:col-span-5">
          <CountBlock
            label="Rows"
            value={String(rows.length)}
            note={atCap ? '(cap)' : `/ ${MAX_ROWS}`}
            tone={atCap ? 'amber' : 'signal'}
          />
          <CountBlock
            label="State"
            value={paused ? 'paused' : 'streaming'}
            tone={paused ? 'amber' : 'mint'}
          />
          <CountBlock label="Scroll" value={autoScroll ? 'follow' : 'free'} />
        </div>
      </section>

      {/* CONTROLS */}
      <section
        className="animate-rise panel flex items-center justify-between gap-4 px-4 py-2"
        style={{ ['--delay' as never]: '120ms' }}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            data-testid="pause-toggle"
            data-active={!paused}
            className="btn-quiet"
          >
            <span className="text-[10px]">{paused ? '▶' : '❚❚'}</span>
            <span>{paused ? 'resume' : 'pause'}</span>
          </button>
          <label className="flex cursor-pointer items-center gap-2 select-none">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              data-testid="autoscroll-toggle"
              className="sr-only"
            />
            <span
              className={`relative inline-flex h-4 w-7 items-center rounded-full border transition-colors ${
                autoScroll
                  ? 'border-signal/50 bg-signal/20'
                  : 'border-line-2 bg-ink-3'
              }`}
              aria-hidden="true"
            >
              <span
                className={`absolute h-3 w-3 rounded-full transition-all ${
                  autoScroll ? 'left-[14px] bg-signal' : 'left-[2px] bg-mute-2'
                }`}
              />
            </span>
            <span
              className={`caps transition-colors ${
                autoScroll ? 'text-fg' : 'text-mute-2'
              }`}
            >
              auto-scroll
            </span>
          </label>
        </div>
        <div className="flex items-center gap-3">
          <span className="caps text-mute">events</span>
          <span
            data-testid="row-count"
            className={`num text-[12px] ${atCap ? 'text-amber' : 'text-fg'}`}
          >
            {rows.length} {atCap ? '(cap)' : ''}
          </span>
        </div>
      </section>

      {/* FEED */}
      <section
        className="animate-rise"
        style={{ ['--delay' as never]: '200ms' }}
      >
        <div className="panel overflow-hidden">
          {/* col heads */}
          <div className="hairline-b grid grid-cols-[14px_92px_140px_1fr_84px] items-center gap-3 px-3 py-2 text-[9px] tracking-widest uppercase text-mute">
            <span></span>
            <span>time</span>
            <span>type</span>
            <span>flow · step</span>
            <span className="text-right">cid</span>
          </div>
          <ul
            data-testid="live-feed"
            aria-live={paused ? 'off' : 'polite'}
            className="max-h-[60vh] overflow-y-auto font-mono text-[11px]"
          >
            {rows.length === 0 ? (
              <li className="px-6 py-12 text-center text-mute">
                Waiting for events…
              </li>
            ) : (
              rows.map((row, i) => (
                <li
                  key={i}
                  onClick={() => onRowClick(row, navigate)}
                  data-testid="live-row"
                  data-type={row.type}
                  className={`group hairline-b last:border-b-0 grid cursor-pointer grid-cols-[14px_92px_140px_1fr_84px] items-center gap-3 px-3 py-1.5 transition-colors ${rowHoverClass(
                    row
                  )}`}
                >
                  <LiveRow event={row} />
                </li>
              ))
            )}
          </ul>
          <div ref={tailRef} />
        </div>
      </section>
    </div>
  );
}

function onRowClick(
  row: StreamMessage,
  navigate: ReturnType<typeof useNavigate>
): void {
  if (row.type === 'dropped') return;
  navigate(`/?correlationId=${encodeURIComponent(row.correlationId)}`);
}

function rowHoverClass(row: StreamMessage): string {
  if (row.type === 'dropped') return 'bg-amber/[0.06] hover:bg-amber/[0.10]';
  return 'hover:bg-ink-3/40';
}

function LiveRow({ event }: { event: StreamMessage }) {
  if (event.type === 'dropped') {
    return (
      <>
        <span className="row-indicator bg-amber/60" />
        <span className="caps text-amber">dropped</span>
        <span className="text-amber">heartbeat</span>
        <span className="truncate text-amber">
          {event.count} backpressured event{event.count === 1 ? '' : 's'} —
          refresh the trace view to backfill
        </span>
        <span></span>
      </>
    );
  }
  const detail = 'stepName' in event && event.stepName ? event.stepName : null;
  const time = new Date(event.ts).toISOString().slice(11, 23);
  const tone = toneFor(event.type);
  return (
    <>
      <span className={`row-indicator ${tone.indicator}`} />
      <span className="num text-mute">{time}</span>
      <span className="flex items-center gap-1.5">
        <span className={`dot ${tone.dot}`} />
        <span className={`text-[10.5px] ${tone.text}`}>{event.type}</span>
      </span>
      <span className="min-w-0 truncate">
        <span className="text-fg">{event.flowName}</span>
        {detail ? (
          <>
            <span className="mx-1.5 text-line-3">·</span>
            <span className="text-mute-2">{detail}</span>
          </>
        ) : null}
      </span>
      <span className="num truncate text-right text-mute group-hover:text-fg">
        {event.correlationId.slice(0, 8)}
      </span>
    </>
  );
}

function toneFor(type: string): {
  indicator: string;
  dot: string;
  text: string;
} {
  if (type === 'flow.error' || type === 'step.error') {
    return {
      indicator: 'bg-coral/70',
      dot: 'dot-coral',
      text: 'text-coral',
    };
  }
  if (type === 'flow.break') {
    return {
      indicator: 'bg-violet/70',
      dot: 'dot-violet',
      text: 'text-violet',
    };
  }
  if (type === 'step.retry') {
    return {
      indicator: 'bg-amber/70',
      dot: 'dot-amber',
      text: 'text-amber',
    };
  }
  if (type === 'flow.start' || type === 'step.start') {
    return {
      indicator: 'bg-signal/70',
      dot: 'dot-signal',
      text: 'text-signal',
    };
  }
  if (type === 'flow.complete' || type === 'step.complete') {
    return {
      indicator: 'bg-mint/70',
      dot: 'dot-mint',
      text: 'text-mint',
    };
  }
  return {
    indicator: 'bg-line-3',
    dot: 'bg-mute',
    text: 'text-mute-2',
  };
}

function CountBlock({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: 'signal' | 'coral' | 'amber' | 'mint';
}) {
  const valueTone =
    tone === 'signal'
      ? 'text-signal'
      : tone === 'coral'
      ? 'text-coral'
      : tone === 'amber'
      ? 'text-amber'
      : tone === 'mint'
      ? 'text-mint'
      : 'text-fg-strong';
  return (
    <div className="panel px-4 py-3">
      <div className="caps mb-2">{label}</div>
      <div className="flex items-baseline gap-2">
        <span
          className={`num display-roman text-[22px] leading-none ${valueTone}`}
        >
          {value}
        </span>
        {note ? (
          <span className="num text-[10px] text-mute">{note}</span>
        ) : null}
      </div>
    </div>
  );
}
