import type { ExecutionRecord, ObserverEvent } from '@celom/prose-observer';

export type GanttRowStatus =
  | 'complete'
  | 'error'
  | 'skipped'
  | 'broken'
  | 'running';

export interface GanttRow {
  /** Stable key — `stepName` is reused if a flow re-enters the same step on resume. */
  id: string;
  stepName: string;
  /** Offset from flow start in ms. */
  startMs: number;
  endMs: number;
  status: GanttRowStatus;
  /** Number of `step.retry` events observed for this step. */
  retries: number;
  /**
   * The event that closed this row. Used by the diff inspector to render the
   * step's result / state-delta. `null` for skipped rows (no completion).
   */
  closingEvent: ObserverEvent | null;
}

interface BuiltRows {
  rows: GanttRow[];
  flowStartMs: number;
  flowEndMs: number;
}

/**
 * Walk an `ExecutionRecord`'s events into Gantt rows. Each step gets exactly
 * one row — including `.parallel()` blocks, which the observer already emits
 * as a single start/complete pair (locked in by slice 2's parallel test).
 *
 * Status priorities (highest wins): `broken` → `error` → `skipped` → `complete` → `running`.
 */
export function buildRows(record: ExecutionRecord): BuiltRows {
  const flowStartMs = record.startedAt;
  const flowEndMs = record.endedAt ?? lastEventTs(record.events) ?? flowStartMs;

  const inflight = new Map<string, { startMs: number; retries: number }>();
  const rows: GanttRow[] = [];

  for (const event of record.events) {
    const offset = event.ts - flowStartMs;
    switch (event.type) {
      case 'step.start': {
        inflight.set(event.stepName, { startMs: offset, retries: 0 });
        break;
      }
      case 'step.retry': {
        const slot = inflight.get(event.stepName);
        if (slot) slot.retries++;
        break;
      }
      case 'step.complete': {
        const slot = inflight.get(event.stepName) ?? {
          startMs: offset,
          retries: 0,
        };
        inflight.delete(event.stepName);
        rows.push({
          id: `${event.stepName}@${slot.startMs}`,
          stepName: event.stepName,
          startMs: slot.startMs,
          endMs: offset,
          status: 'complete',
          retries: slot.retries,
          closingEvent: event,
        });
        break;
      }
      case 'step.error': {
        const slot = inflight.get(event.stepName) ?? {
          startMs: offset,
          retries: 0,
        };
        inflight.delete(event.stepName);
        rows.push({
          id: `${event.stepName}@${slot.startMs}`,
          stepName: event.stepName,
          startMs: slot.startMs,
          endMs: offset,
          status: 'error',
          retries: slot.retries,
          closingEvent: event,
        });
        break;
      }
      case 'step.skipped': {
        rows.push({
          id: `${event.stepName}@${offset}`,
          stepName: event.stepName,
          startMs: offset,
          endMs: offset,
          status: 'skipped',
          retries: 0,
          closingEvent: event,
        });
        break;
      }
      case 'flow.break': {
        const existing = rows.find((r) => r.stepName === event.stepName);
        if (existing) {
          existing.status = 'broken';
          existing.closingEvent = event;
        }
        break;
      }
      default:
        break;
    }
  }

  for (const [stepName, slot] of inflight) {
    rows.push({
      id: `${stepName}@${slot.startMs}`,
      stepName,
      startMs: slot.startMs,
      endMs: flowEndMs - flowStartMs,
      status: 'running',
      retries: slot.retries,
      closingEvent: null,
    });
  }

  return { rows, flowStartMs, flowEndMs };
}

function lastEventTs(events: ReadonlyArray<ObserverEvent>): number | undefined {
  return events[events.length - 1]?.ts;
}

export interface GanttProps {
  record: ExecutionRecord;
  selectedRowId?: string;
  onSelectRow?: (row: GanttRow) => void;
}

export function Gantt({ record, selectedRowId, onSelectRow }: GanttProps) {
  const { rows, flowStartMs, flowEndMs } = buildRows(record);
  const totalMs = Math.max(1, flowEndMs - flowStartMs);

  return (
    <div className="panel overflow-hidden">
      {/* meta strip */}
      <div className="hairline-b flex items-center justify-between px-4 py-2.5 text-[11px]">
        <div className="flex items-center gap-4 text-mute-2">
          <span className="caps">Step rows</span>
          <span className="num text-fg">{rows.length} step rows</span>
        </div>
        <div className="flex items-center gap-4 text-mute-2">
          <Legend />
          <span className="caps">Total</span>
          <span className="num text-signal">{totalMs}ms</span>
        </div>
      </div>

      {/* timeline ruler */}
      <Ruler totalMs={totalMs} />

      {/* rows */}
      <ol className="space-y-0">
        {rows.map((row, idx) => {
          const left = (row.startMs / totalMs) * 100;
          const widthRaw = ((row.endMs - row.startMs) / totalMs) * 100;
          const width = Math.max(
            row.status === 'skipped' ? 0.6 : 0.6,
            widthRaw
          );
          const isSelected = row.id === selectedRowId;
          const dur = row.endMs - row.startMs;
          return (
            <li
              key={row.id}
              className={`hairline-b last:border-b-0 ${
                idx % 2 === 1 ? 'bg-ink-2/30' : ''
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectRow?.(row)}
                data-testid={`gantt-row-${row.stepName}`}
                data-status={row.status}
                className={[
                  'group grid w-full grid-cols-[200px_1fr_88px] items-center gap-4 px-4 py-2.5 text-left transition-colors',
                  isSelected ? 'bg-signal/[0.06]' : 'hover:bg-ink-3/40',
                ].join(' ')}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <StatusGlyph status={row.status} active={isSelected} />
                  <span
                    className={`truncate text-[12px] ${
                      isSelected ? 'text-signal' : 'text-fg'
                    }`}
                  >
                    {row.stepName}
                  </span>
                  {row.retries > 0 ? (
                    <span
                      className="chip chip-amber !py-0 !text-[9px]"
                      aria-label={`${row.retries} retries`}
                    >
                      ⟲{row.retries}
                    </span>
                  ) : null}
                </div>

                {/* timeline rail */}
                <div className="timeline-grid relative h-5 rounded-sm border border-line/60 bg-ink-2/60">
                  <span
                    className={`animate-bar absolute top-1/2 -translate-y-1/2 ${barClass(
                      row.status,
                      isSelected
                    )}`}
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      animationDelay: `${idx * 28}ms`,
                    }}
                    data-testid={`gantt-bar-${row.stepName}`}
                  />
                  {row.status === 'skipped' ? (
                    <span
                      className="absolute top-1/2 z-10 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-mute-2/60 bg-ink-2"
                      style={{ left: `${left}%` }}
                      aria-hidden="true"
                    />
                  ) : null}
                </div>

                <div className="num text-right text-[11px] text-mute-2">
                  {dur > 0 ? `${dur}ms` : '·'}
                </div>
              </button>
            </li>
          );
        })}
        {rows.length === 0 ? (
          <li className="px-4 py-12 text-center text-[12px] text-mute-2">
            No step events yet.
          </li>
        ) : null}
      </ol>
    </div>
  );
}

function Ruler({ totalMs }: { totalMs: number }) {
  const ticks = [0, 25, 50, 75, 100];
  return (
    <div
      className="hairline-b grid grid-cols-[200px_1fr_88px] items-center gap-4 px-4 py-1.5"
      aria-hidden="true"
    >
      <div className="caps text-mute">Step</div>
      <div className="relative h-3 text-[9px]">
        {ticks.map((p) => (
          <span
            key={p}
            className="absolute top-0 -translate-x-1/2 text-mute"
            style={{ left: `${p}%` }}
          >
            {Math.round((totalMs * p) / 100)}ms
          </span>
        ))}
      </div>
      <div className="caps text-right text-mute">Δ</div>
    </div>
  );
}

function Legend() {
  return (
    <div className="hidden items-center gap-2 md:flex">
      <Swatch label="complete" cls="bg-mint" />
      <Swatch label="error" cls="bg-coral" />
      <Swatch label="broken" cls="bg-violet" />
      <Swatch label="running" cls="bg-signal" />
    </div>
  );
}

function Swatch({ label, cls }: { label: string; cls: string }) {
  return (
    <span className="caps flex items-center gap-1 text-[8px] text-mute">
      <span className={`h-2 w-2 rounded-[1px] ${cls}`} />
      {label}
    </span>
  );
}

function StatusGlyph({
  status,
  active,
}: {
  status: GanttRowStatus;
  active: boolean;
}) {
  const tone =
    status === 'complete'
      ? 'text-mint border-mint/40'
      : status === 'error'
      ? 'text-coral border-coral/50'
      : status === 'broken'
      ? 'text-violet border-violet/50'
      : status === 'running'
      ? 'text-signal border-signal/50'
      : 'text-mute-2 border-line-2';
  return (
    <span
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border bg-ink-1 text-[9px] ${tone} ${
        active
          ? 'shadow-[0_0_0_2px_color-mix(in_oklab,var(--color-signal)_30%,transparent)]'
          : ''
      }`}
      aria-hidden="true"
    >
      {glyphFor(status)}
    </span>
  );
}

function glyphFor(status: GanttRowStatus): string {
  switch (status) {
    case 'complete':
      return '✓';
    case 'error':
      return '×';
    case 'broken':
      return '◇';
    case 'skipped':
      return '–';
    case 'running':
      return '·';
  }
}

function barClass(status: GanttRowStatus, selected: boolean): string {
  const base =
    'h-3 rounded-[2px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]';
  const hl = selected ? 'ring-1 ring-signal/40' : '';
  switch (status) {
    case 'complete':
      return `${base} ${hl} bg-gradient-to-r from-mint to-mint/80`;
    case 'error':
      return `${base} ${hl} bg-gradient-to-r from-coral to-coral/80`;
    case 'broken':
      return `${base} ${hl} bg-gradient-to-r from-violet to-violet/80`;
    case 'skipped':
      return `${base} bg-line-2 opacity-60`;
    case 'running':
      return `${base} ${hl} bg-gradient-to-r from-signal to-signal/70 opacity-90`;
  }
}
