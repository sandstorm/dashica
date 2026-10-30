// Tests for time-expr.ts: absolute and relative ends of a custom range, as the server reads them.
import { describe, expect, it } from 'vitest';
import { formatTimeExpr, isRelative, parseTimeExpr } from './time-expr';

const now = new Date(2026, 9, 29, 12, 0);

describe('parseTimeExpr', () => {
  it.each([
    ['now', new Date(2026, 9, 29, 12, 0)],
    ['now-30s', new Date(2026, 9, 29, 11, 59, 30)],
    ['now-15m', new Date(2026, 9, 29, 11, 45)],
    ['now-6h', new Date(2026, 9, 29, 6, 0)],
    ['now-2d', new Date(2026, 9, 27, 12, 0)],
    ['now-1w', new Date(2026, 9, 22, 12, 0)],
    ['now+1h', new Date(2026, 9, 29, 13, 0)],
    ['2026-10-28 08:30', new Date(2026, 9, 28, 8, 30)],
    [' now-1h ', new Date(2026, 9, 29, 11, 0)],
  ])('reads %s', (text, want) => {
    expect(parseTimeExpr(text, now)).toEqual(want);
  });

  it.each(['', 'yesterday', 'now-6', 'now-6y', '2026-10-29', '2026-10-29T10:00', '2026-13-01 10:00', '2026-10-29 25:00'])(
    'rejects %j',
    (text) => {
      expect(parseTimeExpr(text, now)).toBeUndefined();
    },
  );
});

describe('isRelative', () => {
  it('tells an end relative to now from an absolute one', () => {
    expect(isRelative('now-6h')).toBe(true);
    expect(isRelative('now')).toBe(true);
    expect(isRelative('2026-10-29 10:00')).toBe(false);
  });
});

describe('formatTimeExpr', () => {
  it('writes what parseTimeExpr reads', () => {
    expect(formatTimeExpr(new Date(2026, 0, 5, 7, 3))).toBe('2026-01-05 07:03');
    expect(parseTimeExpr(formatTimeExpr(new Date(2026, 0, 5, 7, 3)), now)).toEqual(new Date(2026, 0, 5, 7, 3));
  });
});
