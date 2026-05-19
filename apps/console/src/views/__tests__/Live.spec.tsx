import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ObserverEvent } from '@celom/prose-observer';

import { type StreamMessage } from '../../api';
import { LiveView } from '../Live';

function makeStream() {
  let emit: (event: StreamMessage) => void = () => undefined;
  let closed = false;
  const subscribe = (onEvent: (event: StreamMessage) => void) => {
    emit = onEvent;
    return () => {
      closed = true;
    };
  };
  return {
    subscribe,
    // wrap in act() so React commits the setState before the next assertion
    fire: (event: StreamMessage) => act(() => emit(event)),
    isClosed: () => closed,
  };
}

const event = (
  type: ObserverEvent['type'],
  overrides: Partial<ObserverEvent> = {}
): ObserverEvent => {
  const base = {
    correlationId: 'cid',
    flowName: 'demo.flow',
    ts: Date.now(),
    ...overrides,
  };
  switch (type) {
    case 'flow.start':
      return { ...base, type, input: {} };
    case 'step.start':
      return { ...base, type, stepName: 'step' } as ObserverEvent;
    case 'step.complete':
      return {
        ...base,
        type,
        stepName: 'step',
        result: {},
        durationMs: 1,
      } as ObserverEvent;
    case 'step.error':
      return {
        ...base,
        type,
        stepName: 'step',
        error: { name: 'Error', message: 'boom' },
        durationMs: 1,
      } as ObserverEvent;
    default:
      return base as ObserverEvent;
  }
};

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname + loc.search}</div>;
}

describe('LiveView', () => {
  it('renders incoming events in arrival order', () => {
    const stream = makeStream();
    render(
      <MemoryRouter>
        <LiveView subscribe={stream.subscribe} />
      </MemoryRouter>
    );

    stream.fire(event('flow.start', { correlationId: 'a' }));
    stream.fire(event('step.start', { correlationId: 'a' }));
    stream.fire(event('step.complete', { correlationId: 'a' }));

    const rows = screen.getAllByTestId('live-row');
    expect(rows.map((r) => r.getAttribute('data-type'))).toEqual([
      'flow.start',
      'step.start',
      'step.complete',
    ]);
  });

  it('pause halts the feed; resume restarts it', () => {
    const stream = makeStream();
    render(
      <MemoryRouter>
        <LiveView subscribe={stream.subscribe} />
      </MemoryRouter>
    );

    stream.fire(event('flow.start', { correlationId: 'a' }));
    fireEvent.click(screen.getByTestId('pause-toggle'));
    stream.fire(event('step.start', { correlationId: 'a' }));
    stream.fire(event('step.complete', { correlationId: 'a' }));
    expect(screen.getAllByTestId('live-row')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('pause-toggle')); // resume
    stream.fire(
      event('flow.complete', { correlationId: 'a' }) as StreamMessage
    );
    expect(screen.getAllByTestId('live-row')).toHaveLength(2);
  });

  it('renders the `dropped` heartbeat as an amber row', () => {
    const stream = makeStream();
    render(
      <MemoryRouter>
        <LiveView subscribe={stream.subscribe} />
      </MemoryRouter>
    );
    stream.fire({ type: 'dropped', count: 7 });
    const row = screen.getByTestId('live-row');
    expect(row.getAttribute('data-type')).toBe('dropped');
    expect(row.textContent).toMatch(/7 backpressured/i);
  });

  it('clicking a row navigates to the trace view with its correlationId', () => {
    const stream = makeStream();
    render(
      <MemoryRouter initialEntries={['/live']}>
        <Routes>
          <Route
            path="/live"
            element={
              <>
                <LiveView subscribe={stream.subscribe} />
                <LocationProbe />
              </>
            }
          />
          <Route path="/" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    );
    stream.fire(event('flow.start', { correlationId: 'cid-abc' }));
    fireEvent.click(screen.getByTestId('live-row'));
    expect(screen.getByTestId('loc').textContent).toBe(
      '/?correlationId=cid-abc'
    );
  });

  it('unsubscribes the stream when the component unmounts', () => {
    const stream = makeStream();
    const { unmount } = render(
      <MemoryRouter>
        <LiveView subscribe={stream.subscribe} />
      </MemoryRouter>
    );
    expect(stream.isClosed()).toBe(false);
    unmount();
    expect(stream.isClosed()).toBe(true);
  });
});
