import type {
  ExecutionRecord,
  ObserverEvent,
  StateCapture,
  StateDiff,
} from '@celom/prose-observer';

export interface DiffInspectorProps {
  record: ExecutionRecord;
  /** The event that closed the selected Gantt row, or `null` if nothing is selected. */
  selectedEvent: ObserverEvent | null;
}

export function DiffInspector({ record, selectedEvent }: DiffInspectorProps) {
  const flowStart = record.events.find((e) => e.type === 'flow.start');
  const inputJson = flowStart && 'input' in flowStart ? flowStart.input : null;

  if (!selectedEvent) {
    return (
      <div className="font-mono text-xs text-gray-500">
        Select a step row above to see the per-step result and state diff.
      </div>
    );
  }

  const stepName = stepNameOf(selectedEvent);

  return (
    <div className="font-mono text-xs">
      <h2 className="mb-2 text-sm font-semibold text-gray-700">
        {stepName ?? '(unknown step)'}
      </h2>
      <div className="grid gap-3 md:grid-cols-3">
        <Pane title="Flow input" body={inputJson} />
        <Pane title="Step result" body={resultOf(selectedEvent)} />
        <StatePane event={selectedEvent} />
      </div>
    </div>
  );
}

function stepNameOf(event: ObserverEvent): string | null {
  if ('stepName' in event) return event.stepName ?? null;
  return null;
}

function resultOf(event: ObserverEvent): unknown {
  switch (event.type) {
    case 'step.complete':
      return event.result;
    case 'step.error':
      return event.error;
    case 'flow.break':
      return { __broken: true, returnValue: event.returnValue };
    case 'step.skipped':
      return { __skipped: true };
    default:
      return null;
  }
}

function StatePane({ event }: { event: ObserverEvent }) {
  if (event.type !== 'step.complete') {
    return <Pane title="State" body={null} note="N/A for this event type" />;
  }
  const state: StateCapture | undefined = event.state;
  if (!state) {
    return (
      <Pane
        title="State"
        body={null}
        note="stateCapture: 'off' — turn it on to inspect deltas."
      />
    );
  }
  if (state.mode === 'full') {
    return (
      <div data-testid="state-pane-full" className="rounded border border-gray-200 p-2">
        <div className="mb-1 text-gray-600">State (full snapshot)</div>
        <details open className="mb-2">
          <summary className="cursor-pointer">before</summary>
          <Json value={state.before} />
        </details>
        <details open>
          <summary className="cursor-pointer">after</summary>
          <Json value={state.after} />
        </details>
      </div>
    );
  }
  return <DiffPane diff={state.diff} />;
}

function DiffPane({ diff }: { diff: StateDiff }) {
  const empty =
    Object.keys(diff.added).length === 0 &&
    diff.removed.length === 0 &&
    Object.keys(diff.changed).length === 0;
  return (
    <div data-testid="state-pane-diff" className="rounded border border-gray-200 p-2">
      <div className="mb-1 text-gray-600">State diff (shallow)</div>
      {empty ? (
        <div className="text-gray-500">no state changes</div>
      ) : (
        <>
          {Object.keys(diff.added).length > 0 ? (
            <Section label="added" tone="text-emerald-700">
              <Json value={diff.added} />
            </Section>
          ) : null}
          {diff.removed.length > 0 ? (
            <Section label="removed" tone="text-red-700">
              <Json value={diff.removed} />
            </Section>
          ) : null}
          {Object.keys(diff.changed).length > 0 ? (
            <Section label="changed" tone="text-amber-700">
              <Json value={diff.changed} />
            </Section>
          ) : null}
        </>
      )}
    </div>
  );
}

function Pane({
  title,
  body,
  note,
}: {
  title: string;
  body: unknown;
  note?: string;
}) {
  return (
    <div className="rounded border border-gray-200 p-2">
      <div className="mb-1 text-gray-600">{title}</div>
      {note ? <div className="text-gray-500">{note}</div> : <Json value={body} />}
    </div>
  );
}

function Section({
  label,
  tone,
  children,
}: {
  label: string;
  tone: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-1">
      <div className={`text-[10px] uppercase ${tone}`}>{label}</div>
      {children}
    </div>
  );
}

function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <pre className="text-gray-500">null</pre>;
  }
  return (
    <pre className="whitespace-pre-wrap break-words text-gray-800">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
