import { buildRedactKeySet, redactDeep } from '../redact.js';

describe('redactDeep', () => {
  const keys = buildRedactKeySet();

  it('replaces the value of default-listed keys at top level', () => {
    const result = redactDeep(
      { authorization: 'Bearer abc', other: 'fine' },
      keys
    );
    expect(result).toEqual({ authorization: '[REDACTED]', other: 'fine' });
  });

  it('matches keys case-insensitively', () => {
    const result = redactDeep(
      { Authorization: 'x', PASSWORD: 'y', ApiKey: 'z' },
      keys
    );
    expect(result).toEqual({
      Authorization: '[REDACTED]',
      PASSWORD: '[REDACTED]',
      ApiKey: '[REDACTED]',
    });
  });

  it('walks into nested objects', () => {
    const result = redactDeep(
      {
        user: { name: 'alice', token: 't1' },
        depth1: { depth2: { secret: 's' } },
      },
      keys
    );
    expect(result).toEqual({
      user: { name: 'alice', token: '[REDACTED]' },
      depth1: { depth2: { secret: '[REDACTED]' } },
    });
  });

  it('walks into arrays', () => {
    const result = redactDeep(
      { items: [{ apiKey: 'a' }, { apiKey: 'b' }] },
      keys
    );
    expect(result).toEqual({
      items: [{ apiKey: '[REDACTED]' }, { apiKey: '[REDACTED]' }],
    });
  });

  it('handles cycles without recursing forever', () => {
    type Node = { name: string; self?: Node; token?: string };
    const node: Node = { name: 'cyclic', token: 'hidden' };
    node.self = node;

    const result = redactDeep(node, keys) as Record<string, unknown>;
    expect(result.name).toBe('cyclic');
    expect(result.token).toBe('[REDACTED]');
    expect(result.self).toBe('[Circular]');
  });

  it('stops at maxDepth and replaces deeper subtrees with a truncation marker', () => {
    // Build an object nested 12 levels deep so the (default 8) maxDepth bites.
    let leaf: Record<string, unknown> = { token: 'deepest' };
    for (let i = 0; i < 11; i++) {
      leaf = { nested: leaf };
    }
    const result = redactDeep(leaf, keys, 8) as Record<string, unknown>;

    // Levels 0..7 stay as walked objects (each is `{ nested: ... }`).
    let cursor: unknown = result;
    for (let i = 0; i < 8; i++) {
      expect(cursor).toMatchObject({ nested: expect.anything() });
      cursor = (cursor as { nested: unknown }).nested;
    }
    // Level 8 is past maxDepth — the rest of the subtree is collapsed.
    expect(cursor).toBe('[MaxDepth]');
  });

  it('leaves primitives and null/undefined alone', () => {
    expect(redactDeep(null, keys)).toBeNull();
    expect(redactDeep(undefined, keys)).toBeUndefined();
    expect(redactDeep(42, keys)).toBe(42);
    expect(redactDeep('hello', keys)).toBe('hello');
  });
});
