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
      <div className="panel-quiet px-6 py-10 text-center">
        <div className="caps mb-3 text-mute">Inspector · empty</div>
        <p className="font-mono text-[12px] text-mute-2">
          Select a step row above to see the per-step result and state diff.
        </p>
      </div>
    );
  }

  const stepName = stepNameOf(selectedEvent);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-3">
          <span className="caps text-mute">Selected step</span>
          <h3 className="display text-fg-strong text-[22px] leading-none">
            {stepName ?? '(unknown step)'}
          </h3>
        </div>
        <span className="chip">
          <span className="dot dot-signal" /> {selectedEvent.type}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
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
      <div data-testid="state-pane-full" className="panel">
        <PaneHeader title="State (full snapshot)" />
        <div className="px-3 py-3">
          <details open className="group mb-2">
            <summary className="caps mb-2 cursor-pointer text-mute-2 hover:text-fg">
              before
            </summary>
            <Json value={state.before} />
          </details>
          <details open className="group">
            <summary className="caps mb-2 cursor-pointer text-mute-2 hover:text-fg">
              after
            </summary>
            <Json value={state.after} />
          </details>
        </div>
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
    <div data-testid="state-pane-diff" className="panel">
      <PaneHeader title="State diff" hint="shallow" />
      <div className="px-3 py-3">
        {empty ? (
          <div className="font-mono text-[11px] text-mute">
            no state changes
          </div>
        ) : (
          <div className="space-y-3">
            {Object.keys(diff.added).length > 0 ? (
              <Section label="added" tone="mint">
                <Json value={diff.added} />
              </Section>
            ) : null}
            {diff.removed.length > 0 ? (
              <Section label="removed" tone="coral">
                <Json value={diff.removed} />
              </Section>
            ) : null}
            {Object.keys(diff.changed).length > 0 ? (
              <Section label="changed" tone="amber">
                <Json value={diff.changed} />
              </Section>
            ) : null}
          </div>
        )}
      </div>
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
    <div className="panel">
      <PaneHeader title={title} />
      <div className="px-3 py-3">
        {note ? (
          <div className="font-mono text-[11px] text-mute">{note}</div>
        ) : (
          <Json value={body} />
        )}
      </div>
    </div>
  );
}

function PaneHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="hairline-b flex items-center justify-between px-3 py-2">
      <span className="caps text-fg">{title}</span>
      {hint ? <span className="caps text-mute">{hint}</span> : null}
    </div>
  );
}

function Section({
  label,
  tone,
  children,
}: {
  label: string;
  tone: 'mint' | 'coral' | 'amber';
  children: React.ReactNode;
}) {
  const ring =
    tone === 'mint'
      ? 'border-mint/30 bg-mint/[0.04]'
      : tone === 'coral'
      ? 'border-coral/30 bg-coral/[0.04]'
      : 'border-amber/30 bg-amber/[0.04]';
  const text =
    tone === 'mint'
      ? 'text-mint'
      : tone === 'coral'
      ? 'text-coral'
      : 'text-amber';
  const glyph = tone === 'mint' ? '+' : tone === 'coral' ? '−' : '~';
  return (
    <div className={`rounded-[2px] border ${ring}`}>
      <div className="hairline-b flex items-center gap-2 px-2.5 py-1.5">
        <span className={`font-mono text-[12px] leading-none ${text}`}>
          {glyph}
        </span>
        <span className={`caps ${text}`}>{label}</span>
      </div>
      <div className="px-2.5 py-2">{children}</div>
    </div>
  );
}

function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <pre className="font-mono text-[11px] text-mute">null</pre>;
  }
  return (
    <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-fg">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
