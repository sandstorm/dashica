// Tests for fuzzy.ts.
import { describe, expect, it } from 'vitest';
import { fuzzyMatch } from './fuzzy';

describe('fuzzyMatch', () => {
  it('matches everything with an empty query', () => {
    expect(fuzzyMatch('  ', 'Ingress')).toEqual({ score: 0, ranges: [] });
  });

  it('matches a piece of the target, case-insensitive, and marks it', () => {
    expect(fuzzyMatch('GRESS', 'Ingress')?.ranges).toEqual([[2, 7]]);
  });

  it('matches the characters in order, preferring word starts, and joins neighbours', () => {
    expect(fuzzyMatch('ct', 'Caddy traffic')?.ranges).toEqual([[0, 1], [6, 7]]);
    expect(fuzzyMatch('cadtr', 'Caddy traffic')?.ranges).toEqual([[0, 3], [6, 8]]);
    expect(fuzzyMatch('loo', 'logOverview')?.ranges).toEqual([[0, 2], [3, 4]]);
  });

  it('does not match when a character is missing or out of order', () => {
    expect(fuzzyMatch('xyz', 'Ingress')).toBeNull();
    expect(fuzzyMatch('sgi', 'Ingress')).toBeNull();
  });

  it('scores a match at the start over one inside, a piece over scattered characters', () => {
    const score = (query: string, target: string) => fuzzyMatch(query, target)!.score;
    expect(score('ale', 'Alerts')).toBeGreaterThan(score('ale', 'Scale'));
    expect(score('prof', 'Profiling')).toBeGreaterThan(score('prof', 'php error of the day'));
    expect(score('lo', 'Log overview')).toBeGreaterThan(score('lo', 'Hello'));
  });
});
