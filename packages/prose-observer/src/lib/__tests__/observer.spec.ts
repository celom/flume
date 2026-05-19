import type { FlowObserver } from '@celom/prose';
import { consoleObserver } from '../observer.js';

describe('consoleObserver (Slice 1 placeholder)', () => {
  it('returns an object that satisfies the FlowObserver shape', () => {
    const observer: FlowObserver<unknown, never, never> = consoleObserver();
    expect(observer).toBeDefined();
    expect(typeof observer).toBe('object');
  });

  it('accepts the options bag without throwing', () => {
    expect(() => consoleObserver({ port: 4000 })).not.toThrow();
  });
});
