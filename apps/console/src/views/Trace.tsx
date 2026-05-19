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
      <EmptyState
        eyebrow="Trace · idle"
        title="No execution selected"
        body={
          <>
            Append{' '}
            <code className="rounded-sm border border-line-2 bg-ink-2 px-1.5 py-0.5 text-fg">
              ?correlationId=&lt;id&gt;
            </code>{' '}
            to the URL, or pick a run from{' '}
            <a className="text-signal hover:underline" href="/catalog">
              /catalog
            </a>{' '}
            or{' '}
            <a className="text-signal hover:underline" href="/live">
              /live
            </a>
            .
          </>
        }
      />
    );
  }
  if (state.kind === 'loading' || state.kind === 'idle') {
    return (
      <EmptyState
        eyebrow="Trace · loading"
        title="Hydrating timeline…"
        body="Streaming events from the observer store."
      />
    );
  }
  if (state.kind === 'not-found') {
    return (
      <EmptyState
        eyebrow="Trace · empty"
        title="No execution found"
        body={
          <>
            Nothing recorded for correlationId{' '}
            <code className="rounded-sm border border-line-2 bg-ink-2 px-1.5 py-0.5 text-fg">
              {cid}
            </code>
            .
          </>
        }
      />
    );
  }
  if (state.kind === 'error') {
    return (
      <EmptyState
        tone="error"
        eyebrow="Trace · error"
        title="Could not load execution"
        body={state.message}
      />
    );
  }

  return <TraceContent record={state.record} />;
}

export interface TraceContentProps {
  record: ExecutionRecord;
}

export function TraceContent({ record }: TraceContentProps) {
  const [selectedRow, setSelectedRow] = useState<GanttRow | null>(null);
  const selectedEvent: ObserverEvent | null = selectedRow?.closingEvent ?? null;

  const stepCount = countSteps(record);
  const errorCount = countEventType(record, 'step.error');
  const retryCount = countEventType(record, 'step.retry');

  return (
    <div className="space-y-8">
      {/* ============ HERO ============ */}
      <section
        className="animate-rise grid grid-cols-12 items-end gap-6"
        style={{ ['--delay' as never]: '40ms' }}
      >
        <div className="col-span-12 md:col-span-7">
          <div className="caps mb-3 text-mute-2">
            Execution Trace ·{' '}
            <span className="text-signal">{record.status}</span>
          </div>
          <h1 className="display text-fg-strong text-[64px] md:text-[88px]">
            {record.flowName}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-3 font-mono text-[11px] text-mute-2">
            <StatusChip status={record.status} />
            <span className="text-line-3">·</span>
            <code className="text-fg">{record.correlationId}</code>
          </div>
        </div>

        <div className="col-span-12 grid grid-cols-2 gap-3 md:col-span-5 md:grid-cols-4">
          <StatBlock
            label="Duration"
            value={
              typeof record.durationMs === 'number'
                ? fmtDuration(record.durationMs)
                : '—'
            }
            tone="signal"
          />
          <StatBlock label="Steps" value={String(stepCount)} />
          <StatBlock
            label="Retries"
            value={String(retryCount)}
            tone={retryCount > 0 ? 'amber' : 'mute'}
          />
          <StatBlock
            label="Errors"
            value={String(errorCount)}
            tone={errorCount > 0 ? 'coral' : 'mute'}
          />
        </div>
      </section>

      {/* status hidden for tests (preserves data-testid) */}
      <span data-testid="trace-status" className="sr-only">
        {record.status}
      </span>

      {/* ============ TIMELINE ============ */}
      <section
        className="animate-rise"
        style={{ ['--delay' as never]: '120ms' }}
      >
        <SectionHeader
          eyebrow="01"
          title="Timeline"
          subtitle="Per-step execution ordering"
        />
        <Gantt
          record={record}
          selectedRowId={selectedRow?.id}
          onSelectRow={setSelectedRow}
        />
      </section>

      {/* ============ INSPECTOR ============ */}
      <section
        className="animate-rise"
        style={{ ['--delay' as never]: '200ms' }}
      >
        <SectionHeader
          eyebrow="02"
          title="Inspector"
          subtitle="Step result, flow input, and state delta"
        />
        <DiffInspector record={record} selectedEvent={selectedEvent} />
      </section>
    </div>
  );
}

/* ---------- helpers ---------- */

function countSteps(record: ExecutionRecord): number {
  const names = new Set<string>();
  for (const e of record.events) {
    if ('stepName' in e && e.stepName && e.type !== 'step.retry') {
      names.add(e.stepName);
    }
  }
  return names.size;
}

function countEventType(
  record: ExecutionRecord,
  type: ObserverEvent['type']
): number {
  return record.events.reduce((acc, e) => (e.type === type ? acc + 1 : acc), 0);
}

function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60_000).toFixed(2)}m`;
}

/* ---------- presentational fragments ---------- */

export function SectionHeader({
  eyebrow,
  title,
  subtitle,
  right,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="hairline-b mb-4 flex items-baseline justify-between gap-4 pb-3">
      <div className="flex items-baseline gap-4">
        {eyebrow ? <span className="num caps text-mute">{eyebrow}</span> : null}
        <h2 className="display text-fg-strong text-[28px] leading-none">
          {title}
        </h2>
        {subtitle ? (
          <span className="caps hidden text-mute md:inline">{subtitle}</span>
        ) : null}
      </div>
      {right ? <div className="flex items-center gap-2">{right}</div> : null}
    </div>
  );
}

function StatBlock({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'signal' | 'coral' | 'amber' | 'mint' | 'mute';
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
      <div
        className={`num display-roman text-[26px] leading-none ${valueTone}`}
      >
        {value}
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: ExecutionRecord['status'] }) {
  const cls =
    status === 'completed'
      ? 'chip chip-mint'
      : status === 'failed'
      ? 'chip chip-coral'
      : status === 'broken'
      ? 'chip chip-violet'
      : status === 'running'
      ? 'chip chip-signal'
      : 'chip';
  return (
    <span className={cls}>
      <span
        className={
          status === 'completed'
            ? 'dot dot-mint'
            : status === 'failed'
            ? 'dot dot-coral'
            : status === 'broken'
            ? 'dot dot-violet'
            : 'dot dot-signal'
        }
      />
      {status}
    </span>
  );
}

function EmptyState({
  eyebrow,
  title,
  body,
  tone,
}: {
  eyebrow: string;
  title: string;
  body: React.ReactNode;
  tone?: 'error';
}) {
  return (
    <div className="animate-rise mx-auto max-w-2xl py-20 text-center">
      <div
        className={`caps mb-4 ${tone === 'error' ? 'text-coral' : 'text-mute'}`}
      >
        {eyebrow}
      </div>
      <h1
        className={`display mb-3 text-[56px] leading-none ${
          tone === 'error' ? 'text-coral' : 'text-fg-strong'
        }`}
      >
        {title}
      </h1>
      <p className="font-mono text-[12px] text-mute-2">{body}</p>
    </div>
  );
}
