// @vitest-environment jsdom
// Tests for ops.ts: the ops a field's ClickHouse type offers (opsOf).
import { describe, expect, it } from 'vitest';
import { opsOf } from './ops';

describe('opsOf', () => {
  it('offers = and ≠ for text, all six for a number, ≥ and ≤ first for a time', () => {
    expect(opsOf('LowCardinality(String)')).toEqual(['eq', 'ne']);
    expect(opsOf("Enum8('a' = 1)")).toEqual(['eq', 'ne']);
    expect(opsOf(undefined)).toEqual(['eq', 'ne']);
    expect(opsOf('UInt16')).toEqual(['eq', 'ne', 'lt', 'le', 'gt', 'ge']);
    expect(opsOf('Nullable(DateTime64(3))')).toEqual(['ge', 'le', 'gt', 'lt', 'eq', 'ne']);
    expect(opsOf('Date')).toEqual(['ge', 'le', 'gt', 'lt', 'eq', 'ne']);
  });
});
