// Tests for time-axis.ts: a time chart's queried range and bucket size read from its answer's headers.
import { describe, expect, it } from 'vitest';
import { bucketSizeOf, resolvedTimeRangeOf } from './time-axis';

const answer = (headers: Record<string, string>) => ({ headers: new Headers(headers) });

describe('resolvedTimeRangeOf', () => {
  it('reads the range, null without the header', () => {
    expect(resolvedTimeRangeOf(answer({ 'X-Dashica-Resolved-Time-Range': '{"from":1,"to":2}' }))).toEqual({ from: 1, to: 2 });
    expect(resolvedTimeRangeOf(answer({}))).toBeNull();
  });
});

describe('bucketSizeOf', () => {
  it('reads the bucket size in ms, undefined without the header', () => {
    expect(bucketSizeOf(answer({ 'X-Dashica-Bucket-Size': '900000' }))).toBe(900000);
    expect(bucketSizeOf(answer({}))).toBeUndefined();
  });
});
