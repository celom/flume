import {
  __resetCorrelationWarningForTests,
  generateCorrelationId,
  warnMissingCorrelationIdOnce,
} from '../correlation.js';

describe('generateCorrelationId', () => {
  it('returns a fresh value on each call', () => {
    const a = generateCorrelationId();
    const b = generateCorrelationId();
    expect(a).not.toEqual(b);
    expect(a).toMatch(/[0-9a-f-]{36}/i);
  });
});

describe('warnMissingCorrelationIdOnce', () => {
  beforeEach(() => {
    __resetCorrelationWarningForTests();
  });

  it('logs at most one console.warn per process across many invocations', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      warnMissingCorrelationIdOnce();
      warnMissingCorrelationIdOnce();
      warnMissingCorrelationIdOnce();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]?.[0]).toMatch(/options\.correlationId/i);
    } finally {
      spy.mockRestore();
    }
  });
});
