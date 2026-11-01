// Tests for candidate.ts: a click's candidate with its column's type, a time written as the pill compares it; the
// column types read from the answer's header.
import { describe, expect, it } from 'vitest';
import { candidateOf, columnTypesOf } from './candidate';

describe('candidateOf', () => {
  it('writes a DateTime (seconds) as ISO 8601 with its type, and anything else as text', () => {
    const types = { timestamp: 'DateTime', status: 'UInt16' };
    expect(candidateOf('timestamp', Date.UTC(2026, 9, 31, 10) / 1000, types)).toEqual({ fieldId: 'timestamp', value: '2026-10-31T10:00:00.000Z', type: 'DateTime' });
    expect(candidateOf('status', 500, types)).toEqual({ fieldId: 'status', value: '500', type: 'UInt16' });
  });

  it('has no type for a column the answer names none of', () => {
    expect(candidateOf('host', 'shop', {})).toEqual({ fieldId: 'host', value: 'shop' });
  });
});

describe('columnTypesOf', () => {
  it('reads the percent-encoded types, empty without the header', () => {
    expect(columnTypesOf({ headers: new Headers({ 'X-Dashica-Column-Types': '{"timestamp":"DateTime"}' }) })).toEqual({ timestamp: 'DateTime' });
    expect(columnTypesOf({ headers: new Headers({ 'X-Dashica-Column-Types': '%7B%22gr%C3%B6%C3%9Fe%22:%22Float64%22%7D' }) })).toEqual({ größe: 'Float64' });
    expect(columnTypesOf({ headers: new Headers() })).toEqual({});
  });
});
