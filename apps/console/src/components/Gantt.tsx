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

  // Tracks an in-flight step. Map by stepName, since the executor doesn't
  // start two instances of the same step concurrently.
  const inflight = new Map<
    string,
    { startMs: number; retries: number }
  >();
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
        // The break step normally also gets a `step.complete`; promote that
        // row from 'complete' to 'broken' so the timeline shows the
        // short-circuit, and attach the flow.break event for the diff inspector.
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

  // Any still-in-flight steps mean the flow died mid-step. Emit running rows
  // capped at flowEndMs so the bar is visible.
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
    <div className="font-mono text-xs">
      <div className="mb-2 flex items-center justify-between text-gray-600">
        <span>{rows.length} step rows</span>
        <span>{totalMs}ms total</span>
      </div>
      <div className="space-y-1">
        {rows.map((row) => {
          const left = (row.startMs / totalMs) * 100;
          // Skipped rows have zero width — render a small fixed pip so the row is visible.
          const width = Math.max(
            row.status === 'skipped' ? 0.5 : 0.5,
            ((row.endMs - row.startMs) / totalMs) * 100,
          );
          const isSelected = row.id === selectedRowId;
          return (
            <button
              key={row.id}
              type="button"
              onClick={() => onSelectRow?.(row)}
              data-testid={`gantt-row-${row.stepName}`}
              data-status={row.status}
              className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-gray-100 ${
                isSelected ? 'bg-blue-50' : ''
              }`}
            >
              <span className="inline-block w-40 truncate text-gray-800">
                {row.stepName}
                {row.retries > 0 ? (
                  <span className="ml-1 text-amber-700">
                    ⟲{row.retries}
                  </span>
                ) : null}
              </span>
              <span className="relative h-4 flex-1 rounded bg-gray-100">
                <span
                  className={statusBarClass(row.status)}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  data-testid={`gantt-bar-${row.stepName}`}
                />
              </span>
              <span className="w-20 text-right tabular-nums text-gray-500">
                {row.endMs - row.startMs}ms
              </span>
            </button>
          );
        })}
        {rows.length === 0 ? (
          <div className="p-4 text-gray-500">No step events yet.</div>
        ) : null}
      </div>
    </div>
  );
}

function statusBarClass(status: GanttRowStatus): string {
  // Absolutely positioned inside the rail; colours encode status.
  const base = 'absolute top-0 bottom-0 rounded';
  switch (status) {
    case 'complete':
      return `${base} bg-emerald-500`;
    case 'error':
      return `${base} bg-red-500`;
    case 'skipped':
      return `${base} bg-gray-300 opacity-60`;
    case 'broken':
      return `${base} bg-purple-500`;
    case 'running':
      return `${base} bg-blue-300 opacity-70`;
  }
}
