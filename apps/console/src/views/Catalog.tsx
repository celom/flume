import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  ExecutionSummary,
  FlowAggregate,
  PerStepAggregate,
} from '@celom/prose-observer';

import { listExecutions, listFlows } from '../api';

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
    return <div className="p-6 font-mono text-sm">Loading…</div>;
  }
  if (state.kind === 'error') {
    return (
      <div className="p-6 font-mono text-sm text-red-600">
        Error: {state.message}
      </div>
    );
  }
  return (
    <CatalogContent flows={state.flows} executions={state.executions} />
  );
}

export interface CatalogContentProps {
  flows: FlowAggregate[];
  executions: ExecutionSummary[];
}

export function CatalogContent({ flows, executions }: CatalogContentProps) {
  const [selected, setSelected] = useState<string | null>(
    flows[0]?.flowName ?? null,
  );

  return (
    <div className="grid gap-6 p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
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
        <div className="font-mono text-sm text-gray-500">
          {flows.length === 0
            ? 'No executions have run yet. Run a flow with consoleObserver() to see it here.'
            : 'Pick a flow on the left.'}
        </div>
      )}
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
    <div className="font-mono text-xs">
      <h1 className="mb-2 text-sm font-semibold text-gray-700">Flows</h1>
      {flows.length === 0 ? (
        <div className="text-gray-500">No flows recorded.</div>
      ) : (
        <table className="w-full border-collapse" data-testid="catalog-table">
          <thead className="text-left text-gray-600">
            <tr>
              <th className="border-b border-gray-200 py-1 pr-2">flow</th>
              <th className="border-b border-gray-200 py-1 pr-2 text-right">
                runs
              </th>
              <th className="border-b border-gray-200 py-1 pr-2 text-right">
                p50
              </th>
              <th className="border-b border-gray-200 py-1 pr-2 text-right">
                p95
              </th>
              <th className="border-b border-gray-200 py-1 pr-2 text-right">
                err%
              </th>
            </tr>
          </thead>
          <tbody>
            {flows.map((flow) => {
              const isSel = flow.flowName === selected;
              return (
                <tr
                  key={flow.flowName}
                  data-testid={`flow-row-${flow.flowName}`}
                  onClick={() => onSelect(flow.flowName)}
                  className={`cursor-pointer ${
                    isSel ? 'bg-blue-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <td className="border-b border-gray-100 py-1 pr-2">
                    {flow.flowName}
                  </td>
                  <td className="border-b border-gray-100 py-1 pr-2 text-right tabular-nums">
                    {flow.runs}
                  </td>
                  <td className="border-b border-gray-100 py-1 pr-2 text-right tabular-nums">
                    {fmtMs(flow.p50)}
                  </td>
                  <td className="border-b border-gray-100 py-1 pr-2 text-right tabular-nums">
                    {fmtMs(flow.p95)}
                  </td>
                  <td className="border-b border-gray-100 py-1 pr-2 text-right tabular-nums">
                    {fmtPct(flow.errorRate)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
    <div className="font-mono text-xs">
      <h2 className="mb-2 text-sm font-semibold text-gray-700">
        {flow.flowName}
      </h2>
      <PerStepTable steps={flow.perStep} />
      <h3 className="mt-4 mb-2 text-sm font-semibold text-gray-700">
        Last {executions.length} executions
      </h3>
      <RecentExecutions executions={executions} />
    </div>
  );
}

function PerStepTable({ steps }: { steps: PerStepAggregate[] }) {
  return (
    <table className="w-full border-collapse" data-testid="per-step-table">
      <thead className="text-left text-gray-600">
        <tr>
          <th className="border-b border-gray-200 py-1 pr-2">step</th>
          <th className="border-b border-gray-200 py-1 pr-2 text-right">runs</th>
          <th className="border-b border-gray-200 py-1 pr-2 text-right">p50</th>
          <th className="border-b border-gray-200 py-1 pr-2 text-right">p95</th>
          <th className="border-b border-gray-200 py-1 pr-2 text-right">err%</th>
          <th className="border-b border-gray-200 py-1 pr-2 text-right">retry/run</th>
        </tr>
      </thead>
      <tbody>
        {steps.map((step) => (
          <tr key={step.stepName} data-testid={`step-row-${step.stepName}`}>
            <td className="border-b border-gray-100 py-1 pr-2">{step.stepName}</td>
            <td className="border-b border-gray-100 py-1 pr-2 text-right tabular-nums">
              {step.runs}
            </td>
            <td className="border-b border-gray-100 py-1 pr-2 text-right tabular-nums">
              {fmtMs(step.p50)}
            </td>
            <td className="border-b border-gray-100 py-1 pr-2 text-right tabular-nums">
              {fmtMs(step.p95)}
            </td>
            <td className="border-b border-gray-100 py-1 pr-2 text-right tabular-nums">
              {fmtPct(step.errorRate)}
            </td>
            <td className="border-b border-gray-100 py-1 pr-2 text-right tabular-nums">
              {step.retryRate.toFixed(2)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RecentExecutions({ executions }: { executions: ExecutionSummary[] }) {
  if (executions.length === 0) {
    return <div className="text-gray-500">No recent runs.</div>;
  }
  return (
    <table className="w-full border-collapse" data-testid="recent-executions">
      <thead className="text-left text-gray-600">
        <tr>
          <th className="border-b border-gray-200 py-1 pr-2">correlationId</th>
          <th className="border-b border-gray-200 py-1 pr-2">status</th>
          <th className="border-b border-gray-200 py-1 pr-2 text-right">duration</th>
        </tr>
      </thead>
      <tbody>
        {executions.map((exec) => (
          <tr key={exec.correlationId}>
            <td className="border-b border-gray-100 py-1 pr-2">
              <Link
                to={`/?correlationId=${encodeURIComponent(exec.correlationId)}`}
                className="text-blue-700 hover:underline"
              >
                {exec.correlationId}
              </Link>
            </td>
            <td className="border-b border-gray-100 py-1 pr-2">
              <span data-testid={`status-${exec.correlationId}`}>
                {exec.status}
              </span>
            </td>
            <td className="border-b border-gray-100 py-1 pr-2 text-right tabular-nums">
              {typeof exec.durationMs === 'number' ? fmtMs(exec.durationMs) : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
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
