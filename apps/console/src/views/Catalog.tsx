import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  ExecutionSummary,
  FlowAggregate,
  PerStepAggregate,
} from '@celom/prose-observer';

import { listExecutions, listFlows } from '../api';
import { SectionHeader } from './Trace';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | {
      kind: 'loaded';
      flows: FlowAggregate[];
      executions: ExecutionSummary[];
    };

export function CatalogView() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    Promise.all([listFlows(), listExecutions()])
      .then(([flows, executions]) => {
        if (cancelled) return;
        setState({ kind: 'loaded', flows, executions });
      })
      .catch((err: Error) => {
        if (!cancelled) setState({ kind: 'error', message: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === 'loading') {
    return (
      <div className="caps animate-fade py-16 text-center text-mute">
        Loading…
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="panel mx-auto max-w-xl p-6 text-center">
        <div className="caps mb-2 text-coral">Error</div>
        <p className="font-mono text-[12px] text-fg">{state.message}</p>
      </div>
    );
  }
  return <CatalogContent flows={state.flows} executions={state.executions} />;
}

export interface CatalogContentProps {
  flows: FlowAggregate[];
  executions: ExecutionSummary[];
}

export function CatalogContent({ flows, executions }: CatalogContentProps) {
  const [selected, setSelected] = useState<string | null>(
    flows[0]?.flowName ?? null
  );

  const totalRuns = flows.reduce((acc, f) => acc + f.runs, 0);
  const totalErrors = flows.reduce(
    (acc, f) => acc + Math.round(f.runs * f.errorRate),
    0
  );

  return (
    <div className="space-y-8">
      {/* HERO */}
      <section
        className="animate-rise grid grid-cols-12 items-end gap-6"
        style={{ ['--delay' as never]: '40ms' }}
      >
        <div className="col-span-12 md:col-span-7">
          <div className="caps mb-3 text-mute">Catalog</div>
          <h1 className="display text-fg-strong text-[64px] md:text-[88px]">
            Flows
          </h1>
          <p className="mt-3 max-w-xl font-mono text-[11px] text-mute-2">
            Aggregate latency and error metrics, one row per registered flow.
            Pick a flow to drill into per-step stats and recent runs.
          </p>
        </div>
        <div className="col-span-12 grid grid-cols-3 gap-3 md:col-span-5">
          <Stat label="Flows" value={String(flows.length)} />
          <Stat label="Runs" value={fmtCount(totalRuns)} tone="signal" />
          <Stat
            label="Errors"
            value={String(totalErrors)}
            tone={totalErrors > 0 ? 'coral' : 'mute'}
          />
        </div>
      </section>

      {/* CONTENT */}
      <div
        className="animate-rise grid gap-6 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
        style={{ ['--delay' as never]: '140ms' }}
      >
        <FlowList
          flows={flows}
          selected={selected}
          onSelect={(flowName) => setSelected(flowName)}
        />
        {selected ? (
          <FlowDrilldown
            flow={flows.find((f) => f.flowName === selected) ?? null}
            executions={executions
              .filter((e) => e.flowName === selected)
              .sort((a, b) => b.startedAt - a.startedAt)
              .slice(0, 20)}
          />
        ) : (
          <div className="panel-quiet flex items-center justify-center p-10">
            <p className="font-mono text-[12px] text-mute-2">
              {flows.length === 0
                ? 'No executions have run yet. Run a flow with consoleObserver() to see it here.'
                : 'Pick a flow on the left.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function FlowList({
  flows,
  selected,
  onSelect,
}: {
  flows: FlowAggregate[];
  selected: string | null;
  onSelect: (flowName: string) => void;
}) {
  return (
    <div className="panel overflow-hidden">
      <div className="hairline-b flex items-center justify-between px-4 py-2.5">
        <span className="caps text-fg">Index</span>
        <span className="caps text-mute">{flows.length} flows</span>
      </div>
      {flows.length === 0 ? (
        <div className="px-4 py-10 text-center font-mono text-[11px] text-mute-2">
          No flows recorded.
        </div>
      ) : (
        <ol className="font-mono text-[11px]" data-testid="catalog-table">
          {/* Column heads */}
          <li className="hairline-b grid grid-cols-[1fr_56px_64px_64px_56px] items-center gap-3 px-4 py-2 text-[9px] tracking-widest uppercase text-mute">
            <span>flow</span>
            <span className="text-right">runs</span>
            <span className="text-right">p50</span>
            <span className="text-right">p95</span>
            <span className="text-right">err%</span>
          </li>
          {flows.map((flow, idx) => {
            const isSel = flow.flowName === selected;
            return (
              <li
                key={flow.flowName}
                data-testid={`flow-row-${flow.flowName}`}
                onClick={() => onSelect(flow.flowName)}
                className={[
                  'hairline-b group grid cursor-pointer grid-cols-[1fr_56px_64px_64px_56px] items-center gap-3 px-4 py-2.5 transition-colors last:border-b-0',
                  isSel ? 'bg-signal/[0.06]' : 'hover:bg-ink-3/40',
                ].join(' ')}
                style={{
                  animationDelay: `${idx * 24}ms`,
                }}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={`h-3 w-[2px] rounded-[1px] ${
                      isSel ? 'bg-signal' : 'bg-line-2 group-hover:bg-line-3'
                    }`}
                  />
                  <span
                    className={`truncate text-[12px] ${
                      isSel ? 'text-signal' : 'text-fg'
                    }`}
                  >
                    {flow.flowName}
                  </span>
                </span>
                <span className="num text-right text-fg">{flow.runs}</span>
                <span className="num text-right text-mute-2">
                  {fmtMs(flow.p50)}
                </span>
                <span className="num text-right text-mute-2">
                  {fmtMs(flow.p95)}
                </span>
                <span
                  className={`num text-right ${
                    flow.errorRate > 0 ? 'text-coral' : 'text-mute'
                  }`}
                >
                  {fmtPct(flow.errorRate)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function FlowDrilldown({
  flow,
  executions,
}: {
  flow: FlowAggregate | null;
  executions: ExecutionSummary[];
}) {
  if (!flow) return null;
  return (
    <div className="space-y-6">
      {/* drilldown hero */}
      <div className="panel-raised px-5 py-4">
        <div className="caps mb-2 text-mute">Selected flow</div>
        <h2 className="display mb-3 text-fg-strong text-[34px] leading-none">
          {flow.flowName}
        </h2>
        <div className="grid grid-cols-4 gap-3">
          <MiniStat label="Runs" value={String(flow.runs)} />
          <MiniStat label="P50" value={fmtMs(flow.p50)} />
          <MiniStat label="P95" value={fmtMs(flow.p95)} tone="signal" />
          <MiniStat
            label="Err%"
            value={fmtPct(flow.errorRate)}
            tone={flow.errorRate > 0 ? 'coral' : 'mute'}
          />
        </div>
      </div>

      <div>
        <SectionHeader
          eyebrow="01"
          title="Steps"
          subtitle="Aggregates per step name"
        />
        <PerStepTable steps={flow.perStep} />
      </div>

      <div>
        <SectionHeader
          eyebrow="02"
          title={`Last ${executions.length} executions`}
          right={<span className="caps text-mute">click to open trace</span>}
        />
        <RecentExecutions executions={executions} />
      </div>
    </div>
  );
}

function PerStepTable({ steps }: { steps: PerStepAggregate[] }) {
  return (
    <div className="panel overflow-hidden">
      <table
        className="w-full font-mono text-[11px]"
        data-testid="per-step-table"
      >
        <thead>
          <tr className="hairline-b">
            <th className="px-3 py-2 text-left text-[9px] tracking-widest uppercase text-mute">
              step
            </th>
            <th className="px-3 py-2 text-right text-[9px] tracking-widest uppercase text-mute">
              runs
            </th>
            <th className="px-3 py-2 text-right text-[9px] tracking-widest uppercase text-mute">
              p50
            </th>
            <th className="px-3 py-2 text-right text-[9px] tracking-widest uppercase text-mute">
              p95
            </th>
            <th className="px-3 py-2 text-right text-[9px] tracking-widest uppercase text-mute">
              err%
            </th>
            <th className="px-3 py-2 text-right text-[9px] tracking-widest uppercase text-mute">
              retry/run
            </th>
          </tr>
        </thead>
        <tbody>
          {steps.map((step) => (
            <tr
              key={step.stepName}
              data-testid={`step-row-${step.stepName}`}
              className="hairline-b last:border-b-0 hover:bg-ink-3/30"
            >
              <td className="px-3 py-2 text-fg">{step.stepName}</td>
              <td className="num px-3 py-2 text-right text-fg">{step.runs}</td>
              <td className="num px-3 py-2 text-right text-mute-2">
                {fmtMs(step.p50)}
              </td>
              <td className="num px-3 py-2 text-right text-mute-2">
                {fmtMs(step.p95)}
              </td>
              <td
                className={`num px-3 py-2 text-right ${
                  step.errorRate > 0 ? 'text-coral' : 'text-mute'
                }`}
              >
                {fmtPct(step.errorRate)}
              </td>
              <td
                className={`num px-3 py-2 text-right ${
                  step.retryRate > 0 ? 'text-amber' : 'text-mute'
                }`}
              >
                {step.retryRate.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecentExecutions({ executions }: { executions: ExecutionSummary[] }) {
  if (executions.length === 0) {
    return (
      <div className="panel-quiet px-4 py-6 text-center font-mono text-[11px] text-mute">
        No recent runs.
      </div>
    );
  }
  return (
    <div className="panel overflow-hidden" data-testid="recent-executions">
      <table className="w-full font-mono text-[11px]">
        <thead>
          <tr className="hairline-b">
            <th className="px-3 py-2 text-left text-[9px] tracking-widest uppercase text-mute">
              correlationId
            </th>
            <th className="px-3 py-2 text-left text-[9px] tracking-widest uppercase text-mute">
              status
            </th>
            <th className="px-3 py-2 text-right text-[9px] tracking-widest uppercase text-mute">
              duration
            </th>
          </tr>
        </thead>
        <tbody>
          {executions.map((exec) => (
            <tr
              key={exec.correlationId}
              className="hairline-b group last:border-b-0 hover:bg-ink-3/40"
            >
              <td className="px-3 py-2">
                <Link
                  to={`/?correlationId=${encodeURIComponent(
                    exec.correlationId
                  )}`}
                  className="font-mono text-fg group-hover:text-signal"
                >
                  {exec.correlationId}
                </Link>
              </td>
              <td className="px-3 py-2">
                <StatusPill status={exec.status} />
                <span
                  className="sr-only"
                  data-testid={`status-${exec.correlationId}`}
                >
                  {exec.status}
                </span>
              </td>
              <td className="num px-3 py-2 text-right text-mute-2">
                {typeof exec.durationMs === 'number'
                  ? fmtMs(exec.durationMs)
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- presentational ---------- */

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'signal' | 'coral' | 'mute';
}) {
  const valueTone =
    tone === 'signal'
      ? 'text-signal'
      : tone === 'coral'
      ? 'text-coral'
      : tone === 'mute'
      ? 'text-fg-strong'
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

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'signal' | 'coral' | 'mute';
}) {
  const valueTone =
    tone === 'signal'
      ? 'text-signal'
      : tone === 'coral'
      ? 'text-coral'
      : 'text-fg-strong';
  return (
    <div className="rounded-[2px] border border-line bg-ink-1/60 px-3 py-2">
      <div className="caps mb-1">{label}</div>
      <div className={`num text-[16px] ${valueTone}`}>{value}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: 'chip chip-mint',
    failed: 'chip chip-coral',
    broken: 'chip chip-violet',
    running: 'chip chip-signal',
  };
  const dotCls: Record<string, string> = {
    completed: 'dot dot-mint',
    failed: 'dot dot-coral',
    broken: 'dot dot-violet',
    running: 'dot dot-signal',
  };
  return (
    <span className={map[status] ?? 'chip'}>
      <span className={dotCls[status] ?? 'dot'} />
      {status}
    </span>
  );
}

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms === 0) return '0ms';
  if (ms < 10) return `${ms.toFixed(1)}ms`;
  return `${Math.round(ms)}ms`;
}

function fmtPct(p: number): string {
  if (p === 0) return '0';
  return `${(p * 100).toFixed(1)}`;
}

function fmtCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}m`;
}
