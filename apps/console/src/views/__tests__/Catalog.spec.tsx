import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ExecutionSummary, FlowAggregate } from '@celom/prose-observer';

import { CatalogContent } from '../Catalog';

const flows: FlowAggregate[] = [
  {
    flowName: 'order.create',
    runs: 10,
    p50: 120,
    p95: 380,
    errorRate: 0.2,
    perStep: [
      {
        stepName: 'validate',
        runs: 10,
        p50: 5,
        p95: 9,
        errorRate: 0,
        retryRate: 0,
      },
      {
        stepName: 'charge',
        runs: 10,
        p50: 80,
        p95: 320,
        errorRate: 0.2,
        retryRate: 0.4,
      },
    ],
  },
  {
    flowName: 'user.signup',
    runs: 3,
    p50: 30,
    p95: 50,
    errorRate: 0,
    perStep: [
      {
        stepName: 'persist',
        runs: 3,
        p50: 30,
        p95: 50,
        errorRate: 0,
        retryRate: 0,
      },
    ],
  },
];

const executions: ExecutionSummary[] = [
  {
    correlationId: 'order-1',
    flowName: 'order.create',
    startedAt: 100,
    endedAt: 220,
    durationMs: 120,
    status: 'completed',
  },
  {
    correlationId: 'order-2',
    flowName: 'order.create',
    startedAt: 200,
    endedAt: 580,
    durationMs: 380,
    status: 'failed',
  },
  {
    correlationId: 'signup-1',
    flowName: 'user.signup',
    startedAt: 50,
    endedAt: 80,
    durationMs: 30,
    status: 'completed',
  },
];

describe('CatalogContent', () => {
  it('renders one row per flow with runs / p50 / p95 / error rate', () => {
    render(
      <MemoryRouter>
        <CatalogContent flows={flows} executions={executions} />
      </MemoryRouter>
    );
    expect(screen.getByTestId('flow-row-order.create')).toBeTruthy();
    expect(screen.getByTestId('flow-row-user.signup')).toBeTruthy();
    const row = screen.getByTestId('flow-row-order.create');
    expect(row.textContent).toMatch(/order\.create/);
    expect(row.textContent).toMatch(/10/);
    expect(row.textContent).toMatch(/120ms/);
    expect(row.textContent).toMatch(/380ms/);
    expect(row.textContent).toMatch(/20\.0/);
  });

  it('shows the per-step drilldown for the first flow by default', () => {
    render(
      <MemoryRouter>
        <CatalogContent flows={flows} executions={executions} />
      </MemoryRouter>
    );
    expect(screen.getByTestId('per-step-table')).toBeTruthy();
    expect(screen.getByTestId('step-row-validate')).toBeTruthy();
    expect(screen.getByTestId('step-row-charge')).toBeTruthy();
    expect(screen.getByTestId('step-row-charge').textContent).toMatch(/0\.40/);
  });

  it('clicking a flow swaps the drilldown', () => {
    render(
      <MemoryRouter>
        <CatalogContent flows={flows} executions={executions} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByTestId('flow-row-user.signup'));
    expect(screen.getByTestId('step-row-persist')).toBeTruthy();
    expect(screen.queryByTestId('step-row-charge')).toBeNull();
  });

  it('lists recent executions for the selected flow and links each to its trace', () => {
    render(
      <MemoryRouter>
        <CatalogContent flows={flows} executions={executions} />
      </MemoryRouter>
    );
    const recent = screen.getByTestId('recent-executions');
    // order.create starts as the selection — its two executions appear.
    expect(recent.textContent).toMatch(/order-1/);
    expect(recent.textContent).toMatch(/order-2/);
    // user.signup's executions are filtered out.
    expect(recent.textContent).not.toMatch(/signup-1/);

    const link = screen.getByText('order-2') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/?correlationId=order-2');
  });

  it('handles the empty state when no flows have been recorded', () => {
    render(
      <MemoryRouter>
        <CatalogContent flows={[]} executions={[]} />
      </MemoryRouter>
    );
    expect(screen.getByText(/No executions have run yet/i)).toBeTruthy();
  });
});
