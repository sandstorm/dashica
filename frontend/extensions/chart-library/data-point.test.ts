// Tests for data-point.ts: a click's data point with its column's type, a time written as the pill compares it; the
// column types read from the answer's header.
import { describe, expect, it } from 'vitest';
import { columnTypesOf, dataPointOf } from './data-point';

describe('dataPointOf', () => {
  it('writes a DateTime (seconds) as ISO 8601 with its type, and anything else as text', () => {
    const types = { timestamp: 'DateTime', status: 'UInt16' };
    expect(dataPointOf('timestamp', Date.UTC(2026, 9, 31, 10) / 1000, types)).toEqual({ field: 'timestamp', value: '2026-10-31T10:00:00.000Z', type: 'DateTime' });
    expect(dataPointOf('status', 500, types)).toEqual({ field: 'status', value: '500', type: 'UInt16' });
  });

  it('has no type for a column the answer names none of', () => {
    expect(dataPointOf('host', 'shop', {})).toEqual({ field: 'host', value: 'shop' });
  });
});

describe('columnTypesOf', () => {
  it('reads the percent-encoded types, empty without the header', () => {
    expect(columnTypesOf({ headers: new Headers({ 'X-Dashica-Column-Types': '{"timestamp":"DateTime"}' }) })).toEqual({ timestamp: 'DateTime' });
    expect(columnTypesOf({ headers: new Headers({ 'X-Dashica-Column-Types': '%7B%22gr%C3%B6%C3%9Fe%22:%22Float64%22%7D' }) })).toEqual({ größe: 'Float64' });
    expect(columnTypesOf({ headers: new Headers() })).toEqual({});
  });
});
