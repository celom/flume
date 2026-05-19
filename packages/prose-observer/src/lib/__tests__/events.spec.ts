import type { ObserverEvent } from '../events.js';

describe('ObserverEvent (discriminated union)', () => {
  it('narrows by `type` so each variant exposes its own payload', () => {
    const events: ObserverEvent[] = [
      {
        type: 'flow.start',
        correlationId: 'c1',
        flowName: 'order.create',
        ts: 1_700_000_000_000,
        input: { foo: 1 },
      },
      {
        type: 'step.complete',
        correlationId: 'c1',
        flowName: 'order.create',
        ts: 1_700_000_000_010,
        stepName: 'validate',
        result: { ok: true },
        durationMs: 5,
      },
      {
        type: 'flow.error',
        correlationId: 'c1',
        flowName: 'order.create',
        ts: 1_700_000_000_020,
        error: { name: 'Error', message: 'boom' },
        durationMs: 20,
      },
    ];

    const stepNames: string[] = [];
    for (const event of events) {
      switch (event.type) {
        case 'flow.start':
          expect(event.input).toBeDefined();
          break;
        case 'step.complete':
          stepNames.push(event.stepName);
          expect(event.durationMs).toBeGreaterThan(0);
          break;
        case 'flow.error':
          expect(event.error.message).toBe('boom');
          break;
        default:
          throw new Error(`unexpected event type ${event.type}`);
      }
    }

    expect(stepNames).toEqual(['validate']);
  });
});
