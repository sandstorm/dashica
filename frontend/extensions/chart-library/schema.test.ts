// Tests for schema.ts: a configured column that the data lacks is named in the error, with the columns it has.
import { tableFromArrays } from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import { SchemaAnalyzer } from './schema';

const schema = new SchemaAnalyzer(tableFromArrays({ time: [1, 2], cnt: [3, 5] }));

describe('SchemaAnalyzer', () => {
  it('passes a column of the data, and what is no column name', () => {
    expect(schema.requiredColumn('cnt', 'y')).toBe('cnt');
    const length = (row: { path: string }) => row.path.length;
    expect(schema.requiredColumn(length, 'y')).toBe(length);
  });

  it('names a missing or unset column with the columns the data has', () => {
    expect(() => schema.requiredColumn('bucket', 'x')).toThrow('x: the configured column bucket does not exist in the data. Detected columns in data: time, cnt');
    expect(() => schema.requiredColumn(undefined, 'x')).toThrow('x: not configured. Detected columns in data: time, cnt');
  });
});
