import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PinoFlowObserver, type PinoLike } from '../pino-observer.js';

function createMockLogger(): PinoLike {
  const logger: PinoLike = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => logger),
  };
  return logger;
}

describe('PinoFlowObserver', () => {
  let logger: PinoLike;
  let childLogger: PinoLike;
  let observer: PinoFlowObserver<unknown, any, any>;

  beforeEach(() => {
    logger = createMockLogger();
    // child() returns the same mock, so childLogger === logger
    childLogger = logger;
    observer = new PinoFlowObserver(logger);
  });

  it('creates a child logger with component binding', () => {
    expect(logger.child).toHaveBeenCalledWith({ component: 'workflow' });
  });

  describe('flow lifecycle', () => {
    it('logs flow start at info level', () => {
      observer.onFlowStart('my-flow', { userId: '1' });
      expect(childLogger.info).toHaveBeenCalledWith(
        { flow: 'my-flow' },
        'Flow started'
      );
    });

    it('logs flow completion with duration', () => {
      observer.onFlowComplete('my-flow', {} as any, 1234);
      expect(childLogger.info).toHaveBeenCalledWith(
        { flow: 'my-flow', durationMs: 1234 },
        'Flow completed'
      );
    });

    it('logs flow error with duration and error', () => {
      const err = new Error('boom');
      observer.onFlowError('my-flow', err, 500);
      expect(childLogger.error).toHaveBeenCalledWith(
        { flow: 'my-flow', durationMs: 500, err },
        'Flow failed'
      );
    });

    it('logs flow break with break step', () => {
      observer.onFlowBreak('my-flow', 'check-guard', undefined, 300);
      expect(childLogger.info).toHaveBeenCalledWith(
        { flow: 'my-flow', breakStep: 'check-guard', durationMs: 300 },
        'Flow short-circuited'
      );
    });
  });

  describe('step lifecycle', () => {
    it('logs step start at debug level', () => {
      observer.onStepStart('fetch-data', {} as any);
      expect(childLogger.debug).toHaveBeenCalledWith(
        { step: 'fetch-data' },
        'Step started'
      );
    });

    it('logs step completion with duration and result keys', () => {
      observer.onStepComplete(
        'fetch-data',
        { users: [], count: 5 },
        42,
        {} as any
      );
      expect(childLogger.info).toHaveBeenCalledWith(
        { step: 'fetch-data', durationMs: 42, resultKeys: ['users', 'count'] },
        'Step completed'
      );
    });

    it('logs step completion without result keys when result is not an object', () => {
      observer.onStepComplete('validate', undefined, 1, {} as any);
      expect(childLogger.info).toHaveBeenCalledWith(
        { step: 'validate', durationMs: 1 },
        'Step completed'
      );
    });

    it('logs step error at error level', () => {
      const err = new Error('db timeout');
      observer.onStepError('persist', err, 5000, {} as any);
      expect(childLogger.error).toHaveBeenCalledWith(
        { step: 'persist', durationMs: 5000, err },
        'Step failed'
      );
    });

    it('logs step retry at warn level', () => {
      const err = new Error('transient');
      observer.onStepRetry('fetch-data', 2, 3, err);
      expect(childLogger.warn).toHaveBeenCalledWith(
        { step: 'fetch-data', attempt: 2, maxAttempts: 3, err },
        'Step retrying'
      );
    });

    it('logs step skipped at debug level', () => {
      observer.onStepSkipped('enrich', {} as any);
      expect(childLogger.debug).toHaveBeenCalledWith(
        { step: 'enrich' },
        'Step skipped'
      );
    });
  });
});
