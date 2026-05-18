/**
 * Tests for the workflow library
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createFlow,
  ValidationError,
  TimeoutError,
} from '../index.js';

type EmptyDeps = Record<string, never>;

describe('Workflow Library', () => {
  describe('Flow Builder', () => {
    it('should create a basic flow', () => {
      const flow = createFlow<{ value: number }>('test-flow')
        .step('double', (ctx) => ({
          result: ctx.input.value * 2,
        }))
        .build();

      expect(flow.name).toBe('test-flow');
      expect(flow.steps).toHaveLength(1);
      expect(flow.steps[0].name).toBe('double');
    });

    it('should chain multiple steps', () => {
      const flow = createFlow<{ a: number; b: number }>('chain-flow')
        .step('add', (ctx) => ({
          sum: ctx.input.a + ctx.input.b,
        }))
        .step('multiply', (ctx) => ({
          product: ctx.state.sum * 2,
        }))
        .build();

      expect(flow.steps).toHaveLength(2);
      expect(flow.steps[0].name).toBe('add');
      expect(flow.steps[1].name).toBe('multiply');
    });

    it('should support validation steps', () => {
      const flow = createFlow<{ email: string }>('validation-flow')
        .validate('checkEmail', (ctx) => {
          if (!ctx.input.email.includes('@')) {
            throw new ValidationError('Invalid email');
          }
        })
        .step('process', (ctx) => ({
          processed: true,
        }))
        .build();

      expect(flow.steps).toHaveLength(2);
      expect(flow.steps[0].type).toBe('validate');
    });

    it('should support conditional steps', () => {
      const flow = createFlow<{ enabled: boolean }>('conditional-flow')
        .stepIf(
          'optionalStep',
          (ctx) => ctx.input.enabled,
          (ctx) => ({ executed: true }),
        )
        .build();

      expect(flow.steps).toHaveLength(1);
      expect(flow.steps[0].condition).toBeDefined();
    });

    it('should support transaction steps', () => {
      const flow = createFlow<any, any>('transaction-flow')
        .transaction('persist', async (ctx, tx) => {
          return { transactionId: 'tx-123' };
        })
        .build();

      expect(flow.steps).toHaveLength(1);
      expect(flow.steps[0].type).toBe('transaction');
    });

    it('should support event publishing', () => {
      const flow = createFlow('event-flow')
        .event('auth', (ctx) => ({
          eventType: 'user.create',
          data: 'test',
        }))
        .build();

      expect(flow.steps).toHaveLength(1);
      expect(flow.steps[0].type).toBe('event');
    });
  });

  describe('Flow Execution', () => {
    let mockDb: any;
    let mockEventPublisher: any;
    let mockDeps: {
      db: any;
      eventPublisher: any;
    };

    beforeEach(() => {
      mockDb = {
        transaction: vi.fn().mockImplementation((fn) => fn(mockDb)),
      };

      mockEventPublisher = {
        publish: vi.fn().mockResolvedValue(undefined),
      };

      mockDeps = {
        db: mockDb,
        eventPublisher: mockEventPublisher,
      };
    });

    it('should execute a simple flow', async () => {
      const flow = createFlow<{ value: number }, typeof mockDeps>('simple')
        .step('double', (ctx) => ({
          doubled: ctx.input.value * 2,
        }))
        .build();

      const result = await flow.execute({ value: 5 }, mockDeps);
      expect(result).toEqual({ doubled: 10 });
    });

    it('should accumulate state through steps', async () => {
      const flow = createFlow<{ a: number; b: number }, typeof mockDeps>(
        'accumulate',
      )
        .step('add', (ctx) => ({
          sum: ctx.input.a + ctx.input.b,
        }))
        .step('multiply', (ctx) => ({
          product: ctx.state.sum * 2,
        }))
        .build();

      const result = await flow.execute({ a: 3, b: 4 }, mockDeps);
      expect(result).toEqual({
        sum: 7,
        product: 14,
      });
    });

    it('should handle validation errors', async () => {
      const flow = createFlow<{ email: string }, typeof mockDeps>(
        'validate-fail',
      )
        .validate('checkEmail', (ctx) => {
          if (!ctx.input.email.includes('@')) {
            throw new ValidationError('Invalid email', 'email');
          }
        })
        .build();

      await expect(
        flow.execute({ email: 'invalid' }, mockDeps),
      ).rejects.toThrow(ValidationError);
    });

    it('should skip conditional steps when condition is false', async () => {
      const stepHandler = vi.fn().mockReturnValue({ executed: true });

      const flow = createFlow<{ enabled: boolean }, any>('conditional')
        .stepIf('optionalStep', (ctx) => ctx.input.enabled, stepHandler)
        .step('always', () => ({ alwaysRun: true }))
        .build();

      const result = await flow.execute({ enabled: false }, mockDeps);

      expect(stepHandler).not.toHaveBeenCalled();
      expect(result).toEqual({ alwaysRun: true });
    });

    it('should execute conditional steps when condition is true', async () => {
      const stepHandler = vi.fn().mockReturnValue({ executed: true });

      const flow = createFlow<{ enabled: boolean }, any>('conditional')
        .stepIf('optionalStep', (ctx) => ctx.input.enabled, stepHandler)
        .step('always', () => ({ alwaysRun: true }))
        .build();

      const result = await flow.execute({ enabled: true }, mockDeps);

      expect(stepHandler).toHaveBeenCalled();
      expect(result).toEqual({
        executed: true,
        alwaysRun: true,
      });
    });

    it('should handle async steps', async () => {
      const flow = createFlow<{ userId: string }, any>('async')
        .step('fetchUser', async (ctx) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { user: { id: ctx.input.userId, name: 'John' } };
        })
        .build();

      const result = await flow.execute({ userId: '123' }, mockDeps);
      expect(result).toEqual({
        user: { id: '123', name: 'John' },
      });
    });

    it('should publish events', async () => {
      const flow = createFlow<any, any>('event-test')
        .step('process', () => ({ processed: true }))
        .event('content', (ctx) => ({
          eventType: 'assignment.submit',
          data: ctx.state.processed,
        }))
        .build();

      await flow.execute({}, mockDeps);

      expect(mockEventPublisher.publish).toHaveBeenCalledWith(
        'content',
        expect.objectContaining({
          eventType: 'assignment.submit',
          data: true,
        }),
      );
    });

    it('should handle multiple events', async () => {
      const flow = createFlow<any, any>('multi-event')
        .events('auth', [
          (ctx) => ({ eventType: 'user.create', data: 1 }),
          (ctx) => ({ eventType: 'email.verify', data: 2 }),
        ])
        .build();

      await flow.execute({}, mockDeps);

      expect(mockEventPublisher.publish).toHaveBeenCalledTimes(2);
    });

    it('should handle flow execution errors', async () => {
      const flow = createFlow<any, any>('error-flow')
        .step('fail', () => {
          throw new Error('Step failed');
        })
        .build();

      await expect(flow.execute({}, mockDeps)).rejects.toThrow('Step failed');
    });

    it('should support retry logic', async () => {
      let attempts = 0;
      const flow = createFlow<any, any>('retry-flow')
        .step('retryable', () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('Try again');
          }
          return { success: true };
        })
        .withRetry({
          maxAttempts: 3,
          delayMs: 10,
        })
        .build();

      const result = await flow.execute({}, mockDeps);
      expect(attempts).toBe(3);
      expect(result).toEqual({ success: true });
    });

    it('should not retry validation errors', async () => {
      let attempts = 0;
      const flow = createFlow<any, any>('no-retry-validation')
        .validate('check', () => {
          attempts++;
          throw new ValidationError('Invalid');
        })
        .withRetry({
          maxAttempts: 3,
          delayMs: 10,
        })
        .build();

      await expect(flow.execute({}, mockDeps)).rejects.toThrow(ValidationError);
      expect(attempts).toBe(1);
    });

    it('should respect timeout option', async () => {
      const flow = createFlow<any, any>('timeout-flow')
        .step('step1', async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          return { step1: true };
        })
        .step('step2', async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          return { step2: true };
        })
        .step('step3', async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          return { step3: true };
        })
        .build();

      await expect(flow.execute({}, mockDeps, { timeout: 50 })).rejects.toThrow(
        TimeoutError,
      );
    });

    it('should respect stepTimeout option and actually interrupt', async () => {
      const flow = createFlow<any, any>('step-timeout-flow')
        .step('slowStep', async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return { slow: true };
        })
        .build();

      const start = Date.now();
      await expect(
        flow.execute({}, mockDeps, { stepTimeout: 20 }),
      ).rejects.toThrow(TimeoutError);
      const duration = Date.now() - start;

      // Should timeout quickly, not wait for the full 100ms
      expect(duration).toBeLessThan(50);
    });

    it('should verify transaction is properly called', async () => {
      const transactionHandler = vi
        .fn()
        .mockResolvedValue({ txResult: 'success' });

      const flow = createFlow<any, any>('tx-verify')
        .transaction('myTransaction', transactionHandler)
        .build();

      await flow.execute({}, mockDeps);

      expect(mockDb.transaction).toHaveBeenCalledTimes(1);
      expect(transactionHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          input: {},
          deps: mockDeps,
        }),
        mockDb,
      );
    });

    it('should handle missing database in transaction', async () => {
      const flow = createFlow<any, any>('no-db')
        .transaction('persist', async (ctx, tx) => ({ result: 'ok' }))
        .build();

      await expect(flow.execute({}, { notADb: 'wrong' })).rejects.toThrow(
        'No database found in dependencies for transaction',
      );
    });

    it('should use explicit channels for events', async () => {
      const flow = createFlow<any, any>('channel-mapping')
        .event('auth', () => ({ eventType: 'user.create', data: 'user' }), 'authEvent')
        .event('content', () => ({
          eventType: 'subject.create',
          data: 'subject',
        }), 'contentEvent')
        .event('notification', () => ({
          eventType: 'notification.send',
          data: 'notif',
        }), 'notificationEvent')
        .event('notification', () => ({
          eventType: 'email.send',
          data: 'default',
        }), 'emailEvent')
        .build();

      await flow.execute({}, mockDeps);

      expect(mockEventPublisher.publish).toHaveBeenNthCalledWith(
        1,
        'auth',
        expect.objectContaining({ eventType: 'user.create' }),
      );
      expect(mockEventPublisher.publish).toHaveBeenNthCalledWith(
        2,
        'content',
        expect.objectContaining({ eventType: 'subject.create' }),
      );
      expect(mockEventPublisher.publish).toHaveBeenNthCalledWith(
        3,
        'notification',
        expect.objectContaining({ eventType: 'notification.send' }),
      );
      expect(mockEventPublisher.publish).toHaveBeenNthCalledWith(
        4,
        'notification',
        expect.objectContaining({ eventType: 'email.send' }),
      );
    });

    it('should propagate correlationId to events', async () => {
      const flow = createFlow<any, any>('correlation')
        .event('auth', () => ({ eventType: 'user.create', data: 'test' }))
        .build();

      await flow.execute({}, mockDeps, { correlationId: 'test-123' });

      expect(mockEventPublisher.publish).toHaveBeenCalledWith(
        'auth',
        expect.objectContaining({
          eventType: 'user.create',
          correlationId: 'test-123',
        }),
      );
    });

    it('should throw on missing event publisher by default', async () => {
      const flow = createFlow<any, any>('no-publisher')
        .event('auth', () => ({ eventType: 'user.create', data: 'test' }))
        .build();

      await expect(flow.execute({}, { db: mockDb })).rejects.toThrow(
        'No event publisher found in dependencies',
      );
    });

    it('should handle missing event publisher gracefully when configured', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* empty */ });

      const flow = createFlow<any, any>('no-publisher-warn')
        .event('auth', () => ({ eventType: 'user.create', data: 'test' }))
        .build();

      await flow.execute({}, { db: mockDb }, {
        errorHandling: { throwOnMissingEventPublisher: false },
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('No event publisher found'),
      );

      consoleSpy.mockRestore();
    });

    it('should skip undefined events', async () => {
      const flow = createFlow<any, any>('undefined-events')
        .event('notification', () => undefined, 'undefinedEvent')
        .event('notification', () => ({
          eventType: 'email.send',
          data: 'data',
        }), 'emailEvent')
        .build();

      await flow.execute({}, mockDeps);

      expect(mockEventPublisher.publish).toHaveBeenCalledTimes(1);
      expect(mockEventPublisher.publish).toHaveBeenCalledWith(
        'notification',
        expect.objectContaining({ eventType: 'email.send' }),
      );
    });

    it('should apply exponential backoff in retry', async () => {
      let attempts = 0;
      const delays: number[] = [];
      const originalSetTimeout = setTimeout;

      vi.spyOn(global, 'setTimeout').mockImplementation(((
        fn: any,
        delay: number,
      ) => {
        delays.push(delay);
        return originalSetTimeout(fn, 0);
      }) as any);

      const flow = createFlow<any, any>('backoff-test')
        .step('retryable', () => {
          attempts++;
          if (attempts < 4) {
            throw new Error('Retry');
          }
          return { success: true };
        })
        .withRetry({
          maxAttempts: 4,
          delayMs: 100,
          backoffMultiplier: 2,
          maxDelayMs: 500,
        })
        .build();

      await flow.execute({}, mockDeps);

      expect(delays).toEqual([100, 200, 400]);
      expect(attempts).toBe(4);

      vi.restoreAllMocks();
    });

    it('should respect maxDelayMs in backoff', async () => {
      let attempts = 0;
      const delays: number[] = [];
      const originalSetTimeout = setTimeout;

      vi.spyOn(global, 'setTimeout').mockImplementation(((
        fn: any,
        delay: number,
      ) => {
        delays.push(delay);
        return originalSetTimeout(fn, 0);
      }) as any);

      const flow = createFlow<any, any>('max-delay')
        .step('retryable', () => {
          attempts++;
          if (attempts < 4) {
            throw new Error('Retry');
          }
          return { success: true };
        })
        .withRetry({
          maxAttempts: 4,
          delayMs: 100,
          backoffMultiplier: 3,
          maxDelayMs: 200,
        })
        .build();

      await flow.execute({}, mockDeps);

      expect(delays).toEqual([100, 200, 200]);

      vi.restoreAllMocks();
    });

    it('should respect shouldRetry callback', async () => {
      let attempts = 0;

      const flow = createFlow<any, any>('conditional-retry')
        .step('retryable', () => {
          attempts++;
          if (attempts === 1) {
            throw new Error('RETRYABLE_ERROR');
          }
          if (attempts === 2) {
            throw new Error('FATAL_ERROR');
          }
          return { success: true };
        })
        .withRetry({
          maxAttempts: 5,
          delayMs: 10,
          shouldRetry: (error) => error.message === 'RETRYABLE_ERROR',
        })
        .build();

      await expect(flow.execute({}, mockDeps)).rejects.toThrow('FATAL_ERROR');
      expect(attempts).toBe(2);
    });

    it('should track currentStep in metadata', async () => {
      const steps: string[] = [];

      const flow = createFlow<any, any>('meta-tracking')
        .step('step1', (ctx) => {
          steps.push(ctx.meta.currentStep || '');
          return { step1: true };
        })
        .step('step2', (ctx) => {
          steps.push(ctx.meta.currentStep || '');
          return { step2: true };
        })
        .build();

      await flow.execute({}, mockDeps);

      expect(steps).toEqual(['step1', 'step2']);
    });

    it('should include startedAt in metadata', async () => {
      let startedAt: Date | undefined;

      const flow = createFlow<any, any>('started-at')
        .step('check', (ctx) => {
          startedAt = ctx.meta.startedAt;
          return { checked: true };
        })
        .build();

      const before = new Date();
      await flow.execute({}, mockDeps);
      const after = new Date();

      expect(startedAt).toBeDefined();
      expect(startedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(startedAt!.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should freeze input to prevent mutations', async () => {
      const flow = createFlow<{ value: number }, any>('frozen-input')
        .step('mutate', (ctx) => {
          expect(() => {
            (ctx.input as any).value = 999;
          }).toThrow();
          return { result: 'ok' };
        })
        .build();

      await flow.execute({ value: 5 }, mockDeps);
    });

    it('should handle steps returning void', async () => {
      const flow = createFlow<any, any>('void-return')
        .step('voidStep', () => {
          return undefined;
        })
        .step('next', () => ({ result: 'ok' }))
        .build();

      const result = await flow.execute({}, mockDeps);
      expect(result).toEqual({ result: 'ok' });
    });

    it('should re-throw original error by default', async () => {
      const flow = createFlow<any, any>('error-rethrow')
        .step('failing', () => {
          throw new Error('Original error');
        })
        .build();

      try {
        await flow.execute({}, mockDeps);
        expect.fail('Should have thrown');
      } catch (error: any) {
        // By default, original errors are re-thrown
        expect(error.message).toBe('Original error');
        expect(error.name).toBe('Error');
      }
    });
  });

  describe('Builder .parallel() method', () => {
    it('should execute handlers in parallel and merge results', async () => {
      const flow = createFlow<{ org: string }, EmptyDeps>('builder-parallel')
        .parallel('fetchAll', 'shallow',
          () => ({ users: ['alice', 'bob'] }),
          () => ({ posts: ['p1', 'p2'] }),
          () => ({ comments: ['c1'] }),
        )
        .build();

      const result = await flow.execute({ org: 'test' }, {});

      expect(result).toEqual({
        users: ['alice', 'bob'],
        posts: ['p1', 'p2'],
        comments: ['c1'],
      });
    });

    it('should actually run handlers concurrently', async () => {
      const handler1 = async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { a: 1 };
      };

      const handler2 = async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { b: 2 };
      };

      const flow = createFlow<Record<string, never>, EmptyDeps>('concurrent-test')
        .parallel('ops', 'shallow', handler1, handler2)
        .build();

      const start = Date.now();
      const result = await flow.execute({}, {});
      const duration = Date.now() - start;

      expect(result).toEqual({ a: 1, b: 2 });
      expect(duration).toBeLessThan(35);
    });

    it('should merge with prior state from earlier steps', async () => {
      const flow = createFlow<{ x: number }, EmptyDeps>('merge-prior')
        .step('init', (ctx) => ({ base: ctx.input.x }))
        .parallel('fetch', 'shallow',
          () => ({ a: 10 }),
          () => ({ b: 20 }),
        )
        .build();

      const result = await flow.execute({ x: 1 }, {});

      expect(result).toEqual({ base: 1, a: 10, b: 20 });
    });

    it('should support error-on-conflict strategy', async () => {
      const flow = createFlow<Record<string, never>, EmptyDeps>('conflict-test')
        .parallel('ops', 'error-on-conflict',
          () => ({ key: 'first' }),
          () => ({ key: 'second' }),
        )
        .build();

      await expect(flow.execute({}, {})).rejects.toThrow(
        "Key conflict detected in parallel merge: 'key'",
      );
    });

    it('should support deep merge strategy', async () => {
      const flow = createFlow<Record<string, never>, EmptyDeps>('deep-merge')
        .parallel('ops', 'deep',
          () => ({ config: { theme: 'dark' } }),
          () => ({ config: { lang: 'en' } }),
        )
        .build();

      const result = await flow.execute({}, {});

      expect(result).toEqual({
        config: { theme: 'dark', lang: 'en' },
      });
    });

    it('should allow chaining after parallel', async () => {
      const flow = createFlow<Record<string, never>, EmptyDeps>('chain-after')
        .parallel('fetch', 'shallow',
          () => ({ users: ['a'] }),
          () => ({ posts: ['p'] }),
        )
        .step('count', (ctx) => ({
          total: ctx.state.users.length + ctx.state.posts.length,
        }))
        .build();

      const result = await flow.execute({}, {});

      expect(result).toEqual({
        users: ['a'],
        posts: ['p'],
        total: 2,
      });
    });
  });

  describe('Builder .pipe() method', () => {
    function withSetup(
      builder: ReturnType<typeof createFlow<Record<string, never>, EmptyDeps>>,
    ) {
      return builder
        .step('setupA', () => ({ a: 1 }))
        .step('setupB', () => ({ b: 2 }));
    }

    it('should apply a builder-to-builder transformation', async () => {
      const flow = createFlow<Record<string, never>, EmptyDeps>('pipe-test')
        .pipe(withSetup)
        .build();

      const result = await flow.execute({}, {});

      expect(result).toEqual({ a: 1, b: 2 });
    });

    it('should preserve state for steps after pipe', async () => {
      const flow = createFlow<Record<string, never>, EmptyDeps>('pipe-chain')
        .pipe(withSetup)
        .step('sum', (ctx) => ({ total: ctx.state.a + ctx.state.b }))
        .build();

      const result = await flow.execute({}, {});

      expect(result).toEqual({ a: 1, b: 2, total: 3 });
    });

    it('should compose multiple pipes', async () => {
      function withExtra(
        builder: ReturnType<typeof withSetup>,
      ) {
        return builder.step('extra', () => ({ c: 3 }));
      }

      const flow = createFlow<Record<string, never>, EmptyDeps>('multi-pipe')
        .pipe(withSetup)
        .pipe(withExtra)
        .build();

      const result = await flow.execute({}, {});

      expect(result).toEqual({ a: 1, b: 2, c: 3 });
    });

    it('should work with steps before pipe', async () => {
      const flow = createFlow<Record<string, never>, EmptyDeps>('pre-pipe')
        .step('init', () => ({ init: true }))
        .pipe((b) => b.step('piped', () => ({ piped: true })))
        .build();

      const result = await flow.execute({}, {});

      expect(result).toEqual({ init: true, piped: true });
    });
  });

  describe('Observer Hooks', () => {
    it('should call onFlowStart when flow begins', async () => {
      const observer = {
        onFlowStart: vi.fn(),
      };

      const flow = createFlow<{ value: string }, EmptyDeps>('test')
        .step('noop', () => ({ result: 'ok' }))
        .build();

      await flow.execute({ value: 'test' }, {}, { observer });

      expect(observer.onFlowStart).toHaveBeenCalledWith('test', {
        value: 'test',
      });
      expect(observer.onFlowStart).toHaveBeenCalledTimes(1);
    });

    it('should call onFlowComplete with state and duration', async () => {
      const observer = {
        onFlowComplete: vi.fn(),
      };

      const flow = createFlow<Record<string, never>, EmptyDeps>('test')
        .step('step1', () => ({ result: 'ok' }))
        .build();

      await flow.execute({}, {}, { observer });

      expect(observer.onFlowComplete).toHaveBeenCalledWith(
        'test',
        { result: 'ok' },
        expect.any(Number), // duration
      );
      expect(observer.onFlowComplete).toHaveBeenCalledTimes(1);
    });

    it('should call onFlowError when flow fails', async () => {
      const observer = {
        onFlowError: vi.fn(),
      };

      const flow = createFlow<Record<string, never>, EmptyDeps>('test')
        .step('fail', () => {
          throw new Error('boom');
        })
        .build();

      await expect(flow.execute({}, {}, { observer })).rejects.toThrow('boom');

      expect(observer.onFlowError).toHaveBeenCalledWith(
        'test',
        expect.any(Error),
        expect.any(Number), // duration
      );
      expect(observer.onFlowError).toHaveBeenCalledTimes(1);
    });

    it('should call onStepStart and onStepComplete for each step', async () => {
      const observer = {
        onStepStart: vi.fn(),
        onStepComplete: vi.fn(),
      };

      const flow = createFlow<Record<string, never>, EmptyDeps>('test')
        .step('step1', () => ({ a: 1 }))
        .step('step2', () => ({ b: 2 }))
        .build();

      await flow.execute({}, {}, { observer });

      expect(observer.onStepStart).toHaveBeenCalledTimes(2);
      expect(observer.onStepComplete).toHaveBeenCalledTimes(2);

      // Check step1 was called
      expect(observer.onStepStart).toHaveBeenNthCalledWith(
        1,
        'step1',
        expect.any(Object),
      );
      expect(observer.onStepComplete).toHaveBeenNthCalledWith(
        1,
        'step1',
        { a: 1 },
        expect.any(Number),
        expect.any(Object),
      );

      // Check step2 was called
      expect(observer.onStepStart).toHaveBeenNthCalledWith(
        2,
        'step2',
        expect.any(Object),
      );
      expect(observer.onStepComplete).toHaveBeenNthCalledWith(
        2,
        'step2',
        { b: 2 },
        expect.any(Number),
        expect.any(Object),
      );
    });

    it('should call onStepRetry on retry attempts', async () => {
      const observer = {
        onStepRetry: vi.fn(),
        onStepComplete: vi.fn(),
      };

      let attempts = 0;
      const flow = createFlow<Record<string, never>, EmptyDeps>('test')
        .step(
          'retry',
          () => {
            attempts++;
            if (attempts < 2) throw new Error('retry me');
            return { ok: true };
          },
          {
            maxAttempts: 3,
            delayMs: 10,
          },
        )
        .build();

      await flow.execute({}, {}, { observer });

      expect(observer.onStepRetry).toHaveBeenCalledWith(
        'retry',
        1, // attempt number
        3, // max attempts
        expect.any(Error),
      );
      expect(observer.onStepRetry).toHaveBeenCalledTimes(1);
      expect(observer.onStepComplete).toHaveBeenCalledTimes(1);
    });

    it('should call onStepSkipped for conditional steps', async () => {
      const observer = {
        onStepSkipped: vi.fn(),
        onStepComplete: vi.fn(),
      };

      const flow = createFlow<{ skip: boolean }, EmptyDeps>('test')
        .stepIf(
          'conditional',
          (ctx) => !ctx.input.skip,
          () => ({ ran: true }),
        )
        .build();

      await flow.execute({ skip: true }, {}, { observer });

      expect(observer.onStepSkipped).toHaveBeenCalledWith(
        'conditional',
        expect.any(Object),
      );
      expect(observer.onStepSkipped).toHaveBeenCalledTimes(1);
      expect(observer.onStepComplete).not.toHaveBeenCalled();
    });
  });

  describe('P0 Fixes - ValidationError.multiple()', () => {
    it('should create error with multiple issues', () => {
      const issues = [
        { field: 'email', message: 'Required' },
        { field: 'password', message: 'Too short' },
      ];

      const error = ValidationError.multiple(issues);

      expect(error.issues).toEqual(issues);
      expect(error.message).toContain('email');
      expect(error.message).toContain('password');
      expect(error.issues).toHaveLength(2);
    });

    it('should serialize to JSON correctly', () => {
      const error = ValidationError.multiple([
        { field: 'email', message: 'Invalid', value: 'bad@' },
      ]);

      const json = error.toJSON();

      expect(json).toEqual({
        name: 'ValidationError',
        message: expect.stringContaining('email'),
        issues: [{ field: 'email', message: 'Invalid', value: 'bad@' }],
      });
    });

    it('should maintain backward compatibility with single field', () => {
      const error = ValidationError.single('email', 'Required');

      expect(error.field).toBe('email');
      expect(error.issues).toHaveLength(1);
      expect(error.issues[0].field).toBe('email');
      expect(error.issues[0].message).toBe('Required');
    });
  });

  describe('P0 Fixes - Parallel Merge Strategies', () => {
    it('should detect key conflicts with error-on-conflict strategy', async () => {
      const flow = createFlow<Record<string, never>, EmptyDeps>('test')
        .step('parallel', async () => {
          const results = await Promise.all([
            (async () => ({ users: ['alice'] }))(),
            (async () => ({ users: ['bob'] }))(),
          ]);

          // Simulate error-on-conflict behavior
          const allKeys = new Set<string>();
          for (const result of results) {
            if (result && typeof result === 'object') {
              for (const key in result) {
                if (allKeys.has(key)) {
                  throw new Error(
                    `Key conflict detected in parallel merge: '${key}'`,
                  );
                }
                allKeys.add(key);
              }
            }
          }
          return Object.assign({}, ...results);
        })
        .build();

      await expect(flow.execute({}, {})).rejects.toThrow(
        "Key conflict detected in parallel merge: 'users'",
      );
    });

    it('should shallow merge with no conflicts', async () => {
      const flow = createFlow<Record<string, never>, EmptyDeps>('test')
        .step('parallel', async () => {
          const results = await Promise.all([
            (async () => ({ users: ['a'] }))(),
            (async () => ({ posts: ['b'] }))(),
          ]);
          return Object.assign({}, ...results);
        })
        .build();

      const result = await flow.execute({}, {});

      expect(result).toEqual({ users: ['a'], posts: ['b'] });
    });

    it('should override with shallow merge on conflicts (last wins)', async () => {
      const flow = createFlow<Record<string, never>, EmptyDeps>('test')
        .step('parallel', async () => {
          const results = await Promise.all([
            (async () => ({ count: 1 }))(),
            (async () => ({ count: 2 }))(),
          ]);
          return Object.assign({}, ...results);
        })
        .build();

      const result = await flow.execute({}, {});

      expect(result.count).toBe(2); // Last wins in shallow merge
    });

    it('should deep merge nested objects', async () => {
      const flow = createFlow<Record<string, never>, EmptyDeps>('test')
        .parallel('deepMergeTest', 'deep',
          () => ({ config: { host: 'localhost' } }),
          () => ({ config: { port: 5432 } }),
        )
        .build();

      const result = await flow.execute({}, {});

      expect(result.config).toEqual({ host: 'localhost', port: 5432 });
    });

    it('should concatenate arrays in deep merge (not overwrite)', async () => {
      const flow = createFlow<Record<string, never>, EmptyDeps>('array-merge')
        .parallel('arrayMergeTest', 'deep',
          () => ({ items: [{ id: 1 }] }),
          () => ({ items: [{ id: 2 }] }),
        )
        .build();

      const result = await flow.execute({}, {});

      // Arrays should be concatenated, not overwritten
      expect(result.items).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it('should handle mixed nested structures in deep merge', async () => {
      const flow = createFlow<Record<string, never>, EmptyDeps>('mixed-merge')
        .parallel('mixedMergeTest', 'deep',
          () => ({ config: { features: ['auth'] }, users: [{ name: 'alice' }] }),
          () => ({ config: { features: ['logging'], timeout: 30 }, users: [{ name: 'bob' }] }),
        )
        .build();

      const result = await flow.execute({}, {});

      expect(result.config).toEqual({
        features: ['auth', 'logging'],
        timeout: 30,
      });
      expect(result.users).toEqual([{ name: 'alice' }, { name: 'bob' }]);
    });
  });

  describe('P0 Fixes - Step Name Uniqueness', () => {
    it('should throw error when building flow with duplicate step names', () => {
      expect(() => {
        createFlow<Record<string, never>, EmptyDeps>('duplicate-names')
          .step('myStep', () => ({ a: 1 }))
          .step('myStep', () => ({ b: 2 })) // Duplicate!
          .build();
      }).toThrow("Flow 'duplicate-names' has duplicate step names: myStep");
    });

    it('should allow same step name in different flows', () => {
      // This should not throw - different flows can have same step names
      const flow1 = createFlow<Record<string, never>, EmptyDeps>('flow1')
        .step('process', () => ({ a: 1 }))
        .build();

      const flow2 = createFlow<Record<string, never>, EmptyDeps>('flow2')
        .step('process', () => ({ b: 2 }))
        .build();

      expect(flow1.steps[0].name).toBe('process');
      expect(flow2.steps[0].name).toBe('process');
    });
  });

  describe('breakIf - Short-Circuit Flow Execution', () => {
    it('should short-circuit when condition is true', async () => {
      const step2Handler = vi.fn().mockReturnValue({ step2: true });

      const flow = createFlow<{ shouldBreak: boolean }, EmptyDeps>('break-test')
        .step('step1', (ctx) => ({ shouldBreak: ctx.input.shouldBreak }))
        .breakIf(
          (ctx) => ctx.state.shouldBreak,
          () => ({ earlyReturn: true }),
        )
        .step('step2', step2Handler)
        .build();

      const result = await flow.execute({ shouldBreak: true }, {});

      expect(result).toEqual({ earlyReturn: true });
      expect(step2Handler).not.toHaveBeenCalled();
    });

    it('should continue execution when condition is false', async () => {
      const step2Handler = vi.fn().mockReturnValue({ step2: true });

      const flow = createFlow<{ shouldBreak: boolean }, EmptyDeps>('break-test')
        .step('step1', (ctx) => ({ shouldBreak: ctx.input.shouldBreak }))
        .breakIf(
          (ctx) => ctx.state.shouldBreak,
          () => ({ earlyReturn: true }),
        )
        .step('step2', step2Handler)
        .build();

      const result = await flow.execute({ shouldBreak: false }, {});

      expect(result).toEqual({ shouldBreak: false, step2: true });
      expect(step2Handler).toHaveBeenCalled();
    });

    it('should return accumulated state when no return value function provided', async () => {
      const flow = createFlow<Record<string, never>, EmptyDeps>('break-state')
        .step('step1', () => ({ value: 42 }))
        .breakIf((ctx) => ctx.state.value === 42)
        .step('step2', () => ({ unreachable: true }))
        .build();

      const result = await flow.execute({}, {});

      expect(result).toEqual({ value: 42 });
    });

    it('should bypass .map() when breaking', async () => {
      const mapper = vi.fn().mockReturnValue({ mapped: true });

      const flow = createFlow<Record<string, never>, EmptyDeps>('break-mapper')
        .step('step1', () => ({ value: 1 }))
        .breakIf(
          () => true,
          () => ({ breakValue: true }),
        )
        .map(mapper)
        .build();

      const result = await flow.execute({}, {});

      expect(result).toEqual({ breakValue: true });
      expect(mapper).not.toHaveBeenCalled();
    });

    it('should support multiple breakIf - first true condition wins', async () => {
      const flow = createFlow<{ level: number }, EmptyDeps>('multi-break')
        .step('setLevel', (ctx) => ({ level: ctx.input.level }))
        .breakIf(
          (ctx) => ctx.state.level === 1,
          () => ({ result: 'level1' }),
        )
        .breakIf(
          (ctx) => ctx.state.level === 2,
          () => ({ result: 'level2' }),
        )
        .step('default', () => ({ result: 'default' }))
        .build();

      expect(await flow.execute({ level: 1 }, {})).toEqual({ result: 'level1' });
      expect(await flow.execute({ level: 2 }, {})).toEqual({ result: 'level2' });
      expect(await flow.execute({ level: 3 }, {})).toEqual({
        level: 3,
        result: 'default',
      });
    });

    it('should work after transaction step', async () => {
      const mockDb = {
        transaction: vi.fn().mockImplementation((fn) => fn(mockDb)),
      };

      const flow = createFlow<Record<string, never>, any>('break-after-tx')
        .transaction('persist', async () => ({ txComplete: true }))
        .breakIf(
          (ctx) => ctx.state.txComplete,
          () => ({ result: 'after-tx-break' }),
        )
        .step('unreachable', () => ({ unreachable: true }))
        .build();

      const result = await flow.execute({}, { db: mockDb });

      expect(result).toEqual({ result: 'after-tx-break' });
      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it('should work after event step', async () => {
      const mockEventPublisher = {
        publish: vi.fn().mockResolvedValue(undefined),
      };

      const flow = createFlow<Record<string, never>, any>('break-after-event')
        .step('setup', () => ({ ready: true }))
        .event('auth', () => ({ eventType: 'user.create', data: {} }))
        .breakIf(
          (ctx) => ctx.state.ready,
          () => ({ result: 'after-event-break' }),
        )
        .step('unreachable', () => ({ unreachable: true }))
        .build();

      const result = await flow.execute({}, { eventPublisher: mockEventPublisher });

      expect(result).toEqual({ result: 'after-event-break' });
      expect(mockEventPublisher.publish).toHaveBeenCalled();
    });

    it('should call onFlowBreak observer hook', async () => {
      const observer = {
        onFlowStart: vi.fn(),
        onStepStart: vi.fn(),
        onStepComplete: vi.fn(),
        onFlowBreak: vi.fn(),
        onFlowComplete: vi.fn(),
      };

      const flow = createFlow<Record<string, never>, EmptyDeps>('observe-break')
        .step('step1', () => ({ value: 1 }))
        .breakIf(
          () => true,
          () => ({ breakResult: true }),
        )
        .build();

      await flow.execute({}, {}, { observer });

      expect(observer.onFlowBreak).toHaveBeenCalledWith(
        'observe-break',
        'break_1',
        { breakResult: true },
        expect.any(Number),
      );
      // onFlowComplete should NOT be called when breaking
      expect(observer.onFlowComplete).not.toHaveBeenCalled();
    });

    it('should generate unique step names for multiple breakIf', () => {
      const flow = createFlow<Record<string, never>, EmptyDeps>('multi-break-names')
        .step('step1', () => ({}))
        .breakIf(() => false)
        .step('step2', () => ({}))
        .breakIf(() => false)
        .build();

      expect(flow.steps[1].name).toBe('break_1');
      expect(flow.steps[3].name).toBe('break_3');
    });

    it('should have break step type in flow definition', () => {
      const flow = createFlow<Record<string, never>, EmptyDeps>('break-type')
        .step('step1', () => ({}))
        .breakIf(() => true)
        .build();

      expect(flow.steps[1].type).toBe('break');
    });
  });

  describe('AbortSignal Cancellation', () => {
    it('should provide an AbortSignal on the context', async () => {
      let isAbortSignal = false;
      let wasAbortedDuringExecution = true;

      const flow = createFlow<Record<string, never>, EmptyDeps>('signal-ctx')
        .step('capture', (ctx) => {
          isAbortSignal = ctx.signal instanceof AbortSignal;
          wasAbortedDuringExecution = ctx.signal.aborted;
          return { ok: true };
        })
        .build();

      await flow.execute({}, {});

      expect(isAbortSignal).toBe(true);
      expect(wasAbortedDuringExecution).toBe(false);
    });

    it('should abort when external signal is triggered mid-flow', async () => {
      const controller = new AbortController();
      const step2Handler = vi.fn().mockReturnValue({ step2: true });

      const flow = createFlow<Record<string, never>, EmptyDeps>('external-abort')
        .step('step1', async () => {
          // Abort after this step completes
          controller.abort();
          return { step1: true };
        })
        .step('step2', step2Handler)
        .build();

      await expect(
        flow.execute({}, {}, { signal: controller.signal }),
      ).rejects.toThrow();

      expect(step2Handler).not.toHaveBeenCalled();
    });

    it('should reject immediately when signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const stepHandler = vi.fn().mockReturnValue({ result: true });

      const flow = createFlow<Record<string, never>, EmptyDeps>('pre-aborted')
        .step('step1', stepHandler)
        .build();

      await expect(
        flow.execute({}, {}, { signal: controller.signal }),
      ).rejects.toThrow();

      expect(stepHandler).not.toHaveBeenCalled();
    });

    it('should propagate step-scoped signal on step timeout', async () => {
      let capturedSignal: AbortSignal | undefined;

      const flow = createFlow<Record<string, never>, EmptyDeps>('step-timeout-signal')
        .step('slow', async (ctx) => {
          capturedSignal = ctx.signal;
          await new Promise((resolve) => setTimeout(resolve, 200));
          return { done: true };
        })
        .build();

      await expect(
        flow.execute({}, {}, { stepTimeout: 20 }),
      ).rejects.toThrow(TimeoutError);

      // The signal should have been aborted by the step timeout
      expect(capturedSignal).toBeDefined();
      expect(capturedSignal!.aborted).toBe(true);
    });

    it('should still produce TimeoutError for flow-level timeout', async () => {
      const flow = createFlow<Record<string, never>, EmptyDeps>('flow-timeout-signal')
        .step('step1', async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          return { step1: true };
        })
        .step('step2', async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          return { step2: true };
        })
        .step('step3', async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          return { step3: true };
        })
        .build();

      await expect(
        flow.execute({}, {}, { timeout: 50 }),
      ).rejects.toThrow(TimeoutError);
    });

    it('should abort retry delay immediately when signal fires', async () => {
      const controller = new AbortController();
      let attempts = 0;

      const flow = createFlow<Record<string, never>, EmptyDeps>('abort-retry')
        .step('retryable', () => {
          attempts++;
          if (attempts === 1) {
            // Abort during the retry delay
            setTimeout(() => controller.abort(), 5);
            throw new Error('retry me');
          }
          return { ok: true };
        })
        .withRetry({ maxAttempts: 3, delayMs: 5000 })
        .build();

      const start = Date.now();
      await expect(
        flow.execute({}, {}, { signal: controller.signal }),
      ).rejects.toThrow();
      const duration = Date.now() - start;

      // Should not have waited the full 5000ms retry delay
      expect(duration).toBeLessThan(200);
      expect(attempts).toBe(1);
    });

    it('should provide signal to parallel handlers', async () => {
      const signals: AbortSignal[] = [];

      const flow = createFlow<Record<string, never>, EmptyDeps>('parallel-signal')
        .parallel('fetch', 'shallow',
          (ctx) => {
            signals.push(ctx.signal);
            return { a: 1 };
          },
          (ctx) => {
            signals.push(ctx.signal);
            return { b: 2 };
          },
        )
        .build();

      await flow.execute({}, {});

      expect(signals).toHaveLength(2);
      expect(signals[0]).toBeInstanceOf(AbortSignal);
      expect(signals[1]).toBeInstanceOf(AbortSignal);
    });

    it('should abort the signal on flow-level timeout', async () => {
      let capturedSignal: AbortSignal | undefined;

      const flow = createFlow<Record<string, never>, EmptyDeps>('flow-abort-signal')
        .step('slow', async (ctx) => {
          capturedSignal = ctx.signal;
          await new Promise((resolve) => setTimeout(resolve, 200));
          return { done: true };
        })
        .build();

      await expect(
        flow.execute({}, {}, { timeout: 20 }),
      ).rejects.toThrow(TimeoutError);

      expect(capturedSignal).toBeDefined();
      expect(capturedSignal!.aborted).toBe(true);
    });

    it('should respect stepTimeout and interrupt quickly', async () => {
      const flow = createFlow<Record<string, never>, EmptyDeps>('step-timeout-interrupt')
        .step('slowStep', async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return { slow: true };
        })
        .build();

      const start = Date.now();
      await expect(
        flow.execute({}, {}, { stepTimeout: 20 }),
      ).rejects.toThrow(TimeoutError);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(80);
    });
  });
});
