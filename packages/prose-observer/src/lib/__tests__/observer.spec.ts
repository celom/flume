import { createFlow } from '@celom/prose';

import { __resetCorrelationWarningForTests } from '../correlation.js';
import type { ObserverEvent } from '../events.js';
import { mergeObservers } from '../merge-observers.js';
import { consoleObserver } from '../observer.js';

type EmptyDeps = Record<string, never>;

describe('consoleObserver — integration with @celom/prose', () => {
  beforeEach(() => {
    __resetCorrelationWarningForTests();
  });

  it('emits a full flow lifecycle in order with one correlationId', async () => {
    const observer = consoleObserver<{ x: number }, EmptyDeps>();

    const flow = createFlow<{ x: number }, EmptyDeps>('lifecycle')
      .step('one', (ctx) => ({ doubled: ctx.input.x * 2 }))
      .step('two', (ctx) => ({ tripled: ctx.input.x * 3 }))
      .build();

    await flow.execute({ x: 5 }, {}, { observer, correlationId: 'user-cid-1' });

    const summaries = observer.events.listExecutions();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.flowName).toBe('lifecycle');
    expect(summaries[0]?.status).toBe('completed');

    const record = observer.events.getExecution(summaries[0]!.correlationId);
    const types = record!.events.map((e) => e.type);
    expect(types).toEqual([
      'flow.start',
      'step.start',
      'step.complete',
      'step.start',
      'step.complete',
      'flow.complete',
    ]);

    // Every event shares the same correlationId — the observer's own,
    // not the user-supplied one (which is captured for slice 7's catalog).
    const cidSet = new Set(record!.events.map((e) => e.correlationId));
    expect(cidSet.size).toBe(1);
  });

  it('records a parallel block as exactly ONE step.start / step.complete pair (v1 contract)', async () => {
    const observer = consoleObserver<{ org: string }, EmptyDeps>();

    const flow = createFlow<{ org: string }, EmptyDeps>('parallel-trace')
      .parallel(
        'fanout',
        'shallow',
        () => ({ users: ['u1', 'u2'] }),
        () => ({ posts: ['p1'] }),
        () => ({ comments: ['c1', 'c2', 'c3'] })
      )
      .build();

    await flow.execute({ org: 'acme' }, {}, { observer });

    const exec = observer.events.listExecutions()[0]!;
    const events = observer.events.getExecution(exec.correlationId)!.events;
    const starts = events.filter(
      (e) => e.type === 'step.start' && e.stepName === 'fanout'
    );
    const completes = events.filter(
      (e) => e.type === 'step.complete' && e.stepName === 'fanout'
    );
    expect(starts).toHaveLength(1);
    expect(completes).toHaveLength(1);
  });

  it('redacts default-listed keys in step input/result payloads', async () => {
    const observer = consoleObserver<
      { authorization: string; user: string },
      EmptyDeps
    >();

    const flow = createFlow<{ authorization: string; user: string }, EmptyDeps>(
      'redact-flow'
    )
      .step('echo', (ctx) => ({
        echoed: {
          tokenWrap: { token: 'super-secret-token' },
          name: ctx.input.user,
        },
      }))
      .build();

    await flow.execute(
      { authorization: 'Bearer xyz', user: 'alice' },
      {},
      { observer }
    );

    const events = observer.events.getExecution(
      observer.events.listExecutions()[0]!.correlationId
    )!.events;

    const flowStart = events.find((e) => e.type === 'flow.start');
    expect(flowStart).toBeDefined();
    expect(
      (flowStart as { input: { authorization: unknown; user: unknown } }).input
    ).toEqual({ authorization: '[REDACTED]', user: 'alice' });

    const stepComplete = events.find(
      (e) => e.type === 'step.complete'
    ) as Extract<ObserverEvent, { type: 'step.complete' }>;
    expect(stepComplete.result).toMatchObject({
      echoed: {
        tokenWrap: { token: '[REDACTED]' },
        name: 'alice',
      },
    });
  });

  it('attaches a shallow state diff to step.complete by default', async () => {
    const observer = consoleObserver<Record<string, never>, EmptyDeps>();

    const flow = createFlow<Record<string, never>, EmptyDeps>('diff-flow')
      .step('first', () => ({ a: 1 }))
      .step('second', () => ({ b: 2 }))
      .build();

    await flow.execute({}, {}, { observer });

    const events = observer.events.getExecution(
      observer.events.listExecutions()[0]!.correlationId
    )!.events;
    const stepCompletes = events.filter(
      (e): e is Extract<ObserverEvent, { type: 'step.complete' }> =>
        e.type === 'step.complete'
    );
    expect(stepCompletes[0]!.state).toEqual({
      mode: 'diff',
      diff: { added: { a: 1 }, removed: [], changed: {} },
    });
    expect(stepCompletes[1]!.state).toEqual({
      mode: 'diff',
      diff: { added: { b: 2 }, removed: [], changed: {} },
    });
  });

  it('warns at most once across multiple flows missing options.correlationId', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const observer = consoleObserver<{ x: number }, EmptyDeps>();
      const flow = createFlow<{ x: number }, EmptyDeps>('no-cid-flow')
        .step('a', () => ({ a: 1 }))
        .build();

      await flow.execute({ x: 1 }, {}, { observer });
      await flow.execute({ x: 2 }, {}, { observer });
      await flow.execute({ x: 3 }, {}, { observer });

      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('records flow.break with the break step name and return value', async () => {
    const observer = consoleObserver<{ skip: boolean }, EmptyDeps>();

    const flow = createFlow<{ skip: boolean }, EmptyDeps>('break-flow')
      .step('first', () => ({ a: 1 }))
      .breakIf(
        (ctx) => ctx.input.skip,
        () => ({ early: true })
      )
      .step('never', () => ({ b: 2 }))
      .build();

    await flow.execute({ skip: true }, {}, { observer });

    const exec = observer.events.listExecutions()[0]!;
    expect(exec.status).toBe('broken');
    const events = observer.events.getExecution(exec.correlationId)!.events;
    const breakEvent = events.find((e) => e.type === 'flow.break');
    expect(breakEvent).toMatchObject({
      type: 'flow.break',
      returnValue: { early: true },
    });
  });

  it('respects stateCapture: "full" by attaching before/after snapshots', async () => {
    const observer = consoleObserver<Record<string, never>, EmptyDeps>({
      stateCapture: 'full',
    });

    const flow = createFlow<Record<string, never>, EmptyDeps>('full-capture')
      .step('one', () => ({ a: 1 }))
      .build();

    await flow.execute({}, {}, { observer });

    const events = observer.events.getExecution(
      observer.events.listExecutions()[0]!.correlationId
    )!.events;
    const complete = events.find((e) => e.type === 'step.complete') as Extract<
      ObserverEvent,
      { type: 'step.complete' }
    >;
    expect(complete.state).toEqual({
      mode: 'full',
      before: {},
      after: { a: 1 },
    });
  });

  it('omits state when stateCapture: "off"', async () => {
    const observer = consoleObserver<Record<string, never>, EmptyDeps>({
      stateCapture: 'off',
    });

    const flow = createFlow<Record<string, never>, EmptyDeps>('no-capture')
      .step('one', () => ({ a: 1 }))
      .build();

    await flow.execute({}, {}, { observer });
    const events = observer.events.getExecution(
      observer.events.listExecutions()[0]!.correlationId
    )!.events;
    const complete = events.find((e) => e.type === 'step.complete') as Extract<
      ObserverEvent,
      { type: 'step.complete' }
    >;
    expect(complete.state).toBeUndefined();
  });

  it('warns once when stateCapture: "full" snapshots over 1MB of state', async () => {
    const observer = consoleObserver<Record<string, never>, EmptyDeps>({
      stateCapture: 'full',
    });

    // ~1.2MB of state baked from a long string.
    const big = 'x'.repeat(1_200_000);
    const flow = createFlow<Record<string, never>, EmptyDeps>('big-state-flow')
      .step('first', () => ({ blob: big }))
      .step('second', () => ({ blob2: big }))
      .build();

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await flow.execute({}, {}, { observer });
      await flow.execute({}, {}, { observer });

      const sizeWarnCalls = spy.mock.calls.filter((args) =>
        String(args[0] ?? '').includes("stateCapture: 'full'")
      );
      expect(sizeWarnCalls).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('drops events when the user redactor returns null', async () => {
    const observer = consoleObserver<{ x: number }, EmptyDeps>({
      redact: (event) => (event.type === 'step.start' ? null : event),
    });

    const flow = createFlow<{ x: number }, EmptyDeps>('dropper')
      .step('a', () => ({ a: 1 }))
      .build();

    await flow.execute({ x: 1 }, {}, { observer });
    const events = observer.events.getExecution(
      observer.events.listExecutions()[0]!.correlationId
    )!.events;
    expect(events.find((e) => e.type === 'step.start')).toBeUndefined();
    expect(events.find((e) => e.type === 'step.complete')).toBeDefined();
  });
});

describe('mergeObservers', () => {
  it('fans every hook out to all child observers', async () => {
    const a = {
      onFlowStart: vi.fn(),
      onStepComplete: vi.fn(),
    };
    const b = {
      onFlowStart: vi.fn(),
      onFlowComplete: vi.fn(),
    };

    const merged = mergeObservers(a, b);

    const flow = createFlow<Record<string, never>, EmptyDeps>('fan')
      .step('one', () => ({ x: 1 }))
      .build();

    await flow.execute({}, {}, { observer: merged });

    expect(a.onFlowStart).toHaveBeenCalledTimes(1);
    expect(b.onFlowStart).toHaveBeenCalledTimes(1);
    expect(a.onStepComplete).toHaveBeenCalledTimes(1);
    expect(b.onFlowComplete).toHaveBeenCalledTimes(1);
  });
});
