// Tests for clickhouse-type.ts: what a ClickHouse type holds (typeKind) and a value as a pill compares it (pillValue).
import { makeData, makeVector, TimestampMicrosecond, TimestampNanosecond } from 'apache-arrow';
import { describe, expect, it } from 'vitest';
import { pillValue, typeKind } from './clickhouse-type';

describe('typeKind', () => {
  it('names times, days, numbers and text, through Nullable and LowCardinality', () => {
    const kinds = Object.fromEntries(
      ['DateTime', "DateTime('UTC')", 'DateTime64(3)', 'Nullable(DateTime64(6))', 'Date', 'Date32', 'UInt16', 'Int64', 'Float64', 'Decimal(10, 2)', 'Nullable(Float32)',
        'String', 'LowCardinality(String)', 'LowCardinality(Nullable(String))', "Enum8('a' = 1)", 'Bool', 'UUID', '', undefined]
        .map((type) => [String(type), typeKind(type)]),
    );
    expect(kinds).toEqual({
      DateTime: 'time', "DateTime('UTC')": 'time', 'DateTime64(3)': 'time', 'Nullable(DateTime64(6))': 'time', Date: 'day', Date32: 'day',
      UInt16: 'number', Int64: 'number', Float64: 'number', 'Decimal(10, 2)': 'number', 'Nullable(Float32)': 'number',
      String: 'text', 'LowCardinality(String)': 'text', 'LowCardinality(Nullable(String))': 'text', "Enum8('a' = 1)": 'text', Bool: 'text', UUID: 'text', '': 'text', undefined: 'text',
    });
  });
});

describe('pillValue', () => {
  const at = Date.UTC(2026, 9, 31, 10, 0, 0);
  it('writes a time as ISO 8601 in UTC from the unit Arrow carries it in', () => {
    expect(pillValue(at / 1000, 'DateTime')).toBe('2026-10-31T10:00:00.000Z');
    expect(pillValue(at / 1000, "Nullable(DateTime('Europe/Berlin'))")).toBe('2026-10-31T10:00:00.000Z');
    expect(pillValue(at, 'DateTime64(3)')).toBe('2026-10-31T10:00:00.000Z');
    expect(pillValue(new Date(at), 'DateTime64(3)')).toBe('2026-10-31T10:00:00.000Z');
  });

  it('writes the µs of a DateTime64(4…9), as apache-arrow reads them from a Timestamp in µs or ns', () => {
    const read = (type: TimestampMicrosecond | TimestampNanosecond, value: bigint): unknown => makeVector(makeData({ type, data: BigInt64Array.of(value) })).get(0);
    const micros = read(new TimestampMicrosecond(), BigInt(at) * 1000n + 123456n); // 10:00:00.123456
    expect(pillValue(micros, 'DateTime64(6)')).toBe('2026-10-31T10:00:00.123456Z');
    expect(pillValue(micros, "Nullable(DateTime64(6, 'UTC'))")).toBe('2026-10-31T10:00:00.123456Z');
    expect(pillValue(read(new TimestampMicrosecond(), BigInt(at) * 1000n + 123400n), 'DateTime64(4)')).toBe('2026-10-31T10:00:00.1234Z');
    // a ns value to the µs, rounded; .9999996 ms carries over to the next ms
    expect(pillValue(read(new TimestampNanosecond(), BigInt(at) * 1000000n + 123456789n), 'DateTime64(9)')).toBe('2026-10-31T10:00:00.123457Z');
    expect(pillValue(read(new TimestampNanosecond(), BigInt(at) * 1000000n + 999999600n), 'DateTime64(9)')).toBe('2026-10-31T10:00:01.000000Z');
    // up to DateTime64(3) the ms
    expect(pillValue(at + 100, 'DateTime64(1)')).toBe('2026-10-31T10:00:00.100Z');
  });

  it('writes a day as its date', () => {
    expect(pillValue(at / 86400000, 'Date')).toBe('2026-10-31');
    expect(pillValue(at, 'Date32')).toBe('2026-10-31');
  });

  it('keeps anything else, and a time that is no number, as its text', () => {
    expect(pillValue(500, 'UInt16')).toBe('500');
    expect(pillValue('shop', undefined)).toBe('shop');
    expect(pillValue('2026-10-31 10:00', 'DateTime')).toBe('2026-10-31 10:00');
  });
});
