// Tests for time-axis.ts: a time chart's queried range and bucket size read from its answer's headers; its axis label
// with the time zone, its tip's times, in the viewer's time zone (here Berlin's unless a test says otherwise).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bucketSizeOf, formatTipSpan, formatTipTime, resolvedTimeRangeOf, timeAxisLabel } from './time-axis';

beforeEach(() => {
  process.env.TZ = 'Europe/Berlin';
});

afterEach(() => {
  delete process.env.TZ;
});

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

describe('timeAxisLabel', () => {
  const range = (from: number, to: number) => ({ from, to });

  it('names the viewer’s offset to UTC, both across a change of daylight saving time, UTC for a utc scale', () => {
    expect(timeAxisLabel('time', range(Date.UTC(2026, 9, 31, 12), Date.UTC(2026, 10, 1, 12)))).toBe('time (local, UTC+1)');
    expect(timeAxisLabel('time', range(Date.UTC(2026, 9, 24, 12), Date.UTC(2026, 10, 1, 12)))).toBe('time (local, UTC+2/+1)');
    expect(timeAxisLabel('time', range(0, 1), 'utc')).toBe('time (UTC)');
  });

  it('writes half hours, a negative offset, and none in UTC itself', () => {
    process.env.TZ = 'Asia/Kolkata';
    expect(timeAxisLabel('t', range(Date.UTC(2026, 9, 31), Date.UTC(2026, 9, 31)))).toBe('t (local, UTC+5:30)');
    process.env.TZ = 'America/Sao_Paulo';
    expect(timeAxisLabel('t', range(Date.UTC(2026, 9, 31), Date.UTC(2026, 9, 31)))).toBe('t (local, UTC-3)');
    process.env.TZ = 'UTC';
    expect(timeAxisLabel('t', range(Date.UTC(2026, 9, 31), Date.UTC(2026, 9, 31)))).toBe('t (local, UTC)');
  });
});

describe('formatTipTime', () => {
  it('writes the weekday, the local date and time, the seconds only when there are some', () => {
    expect(formatTipTime(Date.UTC(2026, 9, 31, 19, 55))).toBe('Sat 2026-10-31 20:55');
    expect(formatTipTime(new Date(Date.UTC(2026, 9, 31, 19, 55, 30)))).toBe('Sat 2026-10-31 20:55:30');
  });
});

describe('formatTipSpan', () => {
  it('writes the end’s time only on the same day, its day too on another', () => {
    expect(formatTipSpan(Date.UTC(2026, 9, 31, 19, 55), Date.UTC(2026, 9, 31, 20))).toBe('Sat 2026-10-31 20:55–21:00');
    expect(formatTipSpan(Date.UTC(2026, 9, 31, 19, 55), Date.UTC(2026, 9, 31, 19, 55, 30))).toBe('Sat 2026-10-31 20:55–20:55:30');
    expect(formatTipSpan(Date.UTC(2026, 9, 31, 22), Date.UTC(2026, 9, 31, 23))).toBe('Sat 2026-10-31 23:00–Sun 2026-11-01 00:00');
  });
});
