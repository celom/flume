import { fireEvent, render, screen } from '@testing-library/react';
import type { ExecutionRecord, ObserverEvent } from '@celom/prose-observer';

import { TraceContent } from '../Trace';

const cid = 'fixture-cid';
const flowName = 'order.create';

function fixtureRecord(): ExecutionRecord {
  let ts = 1_000;
  const events: ObserverEvent[] = [
    {
      type: 'flow.start',
      correlationId: cid,
      flowName,
      ts: ts,
      input: { user: 'alice' },
    },
    {
      type: 'step.start',
      correlationId: cid,
      flowName,
      ts: (ts += 10),
      stepName: 'validate',
    },
    {
      type: 'step.complete',
      correlationId: cid,
      flowName,
      ts: (ts += 10),
      stepName: 'validate',
      result: { valid: true },
      durationMs: 10,
      state: {
        mode: 'diff',
        diff: { added: { valid: true }, removed: [], changed: {} },
      },
    },
    // Step that retries once before completing.
    {
      type: 'step.start',
      correlationId: cid,
      flowName,
      ts: (ts += 10),
      stepName: 'charge',
    },
    {
      type: 'step.retry',
      correlationId: cid,
      flowName,
      ts: (ts += 5),
      stepName: 'charge',
      attempt: 1,
      maxAttempts: 3,
      error: { name: 'Error', message: 'transient' },
    },
    {
      type: 'step.complete',
      correlationId: cid,
      flowName,
      ts: (ts += 20),
      stepName: 'charge',
      result: { charged: true },
      durationMs: 25,
      state: {
        mode: 'diff',
        diff: { added: { charged: true }, removed: [], changed: {} },
      },
    },
    // A step skipped via condition.
    {
      type: 'step.skipped',
      correlationId: cid,
      flowName,
      ts: (ts += 5),
      stepName: 'gift-wrap',
    },
    // A break: the step completes, then flow.break promotes its row to 'broken'.
    {
      type: 'step.start',
      correlationId: cid,
      flowName,
      ts: (ts += 5),
      stepName: 'guard',
    },
    {
      type: 'step.complete',
      correlationId: cid,
      flowName,
      ts: (ts += 5),
      stepName: 'guard',
      result: { early: true },
      durationMs: 5,
      state: {
        mode: 'diff',
        diff: { added: { early: true }, removed: [], changed: {} },
      },
    },
    {
      type: 'flow.break',
      correlationId: cid,
      flowName,
      ts: ts,
      stepName: 'guard',
      returnValue: { early: true },
      durationMs: ts - 1_000,
    },
    // The parallel block — observer emits ONE start/complete pair per slice 2.
    {
      type: 'step.start',
      correlationId: cid,
      flowName,
      ts: (ts += 5),
      stepName: 'notify',
    },
    {
      type: 'step.complete',
      correlationId: cid,
      flowName,
      ts: (ts += 15),
      stepName: 'notify',
      result: { emailQueued: true, smsQueued: true },
      durationMs: 15,
      state: {
        mode: 'diff',
        diff: {
          added: { emailQueued: true, smsQueued: true },
          removed: [],
          changed: {},
        },
      },
    },
  ];
  return {
    correlationId: cid,
    flowName,
    startedAt: 1_000,
    endedAt: ts,
    durationMs: ts - 1_000,
    status: 'broken',
    events,
  };
}

describe('TraceContent', () => {
  it('emits one Gantt row per step regardless of retry / parallel', () => {
    render(<TraceContent record={fixtureRecord()} />);
    // 5 distinct step names: validate, charge, gift-wrap, guard, notify.
    expect(screen.getByTestId('gantt-row-validate')).toBeTruthy();
    expect(screen.getByTestId('gantt-row-charge')).toBeTruthy();
    expect(screen.getByTestId('gantt-row-gift-wrap')).toBeTruthy();
    expect(screen.getByTestId('gantt-row-guard')).toBeTruthy();
    expect(screen.getByTestId('gantt-row-notify')).toBeTruthy();
    expect(screen.getByText(/5 step rows/)).toBeTruthy();
  });

  it('tags skipped, broken, and complete rows with the right data-status', () => {
    render(<TraceContent record={fixtureRecord()} />);
    expect(
      screen.getByTestId('gantt-row-gift-wrap').getAttribute('data-status')
    ).toBe('skipped');
    expect(
      screen.getByTestId('gantt-row-guard').getAttribute('data-status')
    ).toBe('broken');
    expect(
      screen.getByTestId('gantt-row-validate').getAttribute('data-status')
    ).toBe('complete');
  });

  it('shows the retry count badge on a step that retried', () => {
    render(<TraceContent record={fixtureRecord()} />);
    const chargeRow = screen.getByTestId('gantt-row-charge');
    expect(chargeRow.textContent).toMatch(/⟲1/);
  });

  it('selecting a row reveals its result + state diff in the inspector', () => {
    render(<TraceContent record={fixtureRecord()} />);
    expect(screen.getByText(/Select a step row above/i)).toBeTruthy();
    fireEvent.click(screen.getByTestId('gantt-row-charge'));
    // After selection: result panel mentions `charged: true` and diff is visible.
    expect(screen.getAllByText(/charged/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('state-pane-diff')).toBeTruthy();
  });

  it('renders the parallel block as one row even though it merged multiple results', () => {
    render(<TraceContent record={fixtureRecord()} />);
    // The notify row exists exactly once.
    const matches = screen.queryAllByTestId('gantt-row-notify');
    expect(matches).toHaveLength(1);
    fireEvent.click(matches[0]!);
    // The merged result includes both branch outputs.
    expect(screen.getAllByText(/emailQueued/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/smsQueued/).length).toBeGreaterThan(0);
  });
});
