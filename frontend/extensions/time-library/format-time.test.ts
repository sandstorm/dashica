// Tests for format-time.ts: a date as an end of a custom range, in the viewer's time zone with its offset to UTC (here
// Berlin's unless a test says otherwise); a typed end given the offset.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatLocalTime, formatTime, withUtcOffset } from './format-time';

beforeEach(() => {
  process.env.TZ = 'Europe/Berlin';
});

afterEach(() => {
  delete process.env.TZ;
});

describe('formatTime', () => {
  it('writes the local date and time to the minute, padded, with the offset of that day', () => {
    expect(formatTime(new Date(2026, 9, 29, 10, 0))).toBe('2026-10-29 10:00+01:00');
    expect(formatTime(new Date(2026, 6, 2, 3, 4, 59))).toBe('2026-07-02 03:04+02:00');
  });

  it('writes a negative, a half hour and no offset', () => {
    process.env.TZ = 'America/Sao_Paulo';
    expect(formatTime(new Date(2026, 9, 29, 10, 0))).toBe('2026-10-29 10:00-03:00');
    process.env.TZ = 'Asia/Kolkata';
    expect(formatTime(new Date(2026, 9, 29, 10, 0))).toBe('2026-10-29 10:00+05:30');
    process.env.TZ = 'UTC';
    expect(formatTime(new Date(2026, 9, 29, 10, 0))).toBe('2026-10-29 10:00+00:00');
  });
});

describe('formatLocalTime', () => {
  it('writes the local date and time without offset', () => {
    expect(formatLocalTime(new Date(2026, 0, 2, 3, 4, 59))).toBe('2026-01-02 03:04');
  });
});

describe('withUtcOffset', () => {
  it('gives a typed absolute time the viewer’s offset at that time, leaves anything else', () => {
    expect(withUtcOffset(' 2026-10-29 10:00 ')).toBe('2026-10-29 10:00+01:00');
    expect(withUtcOffset('2026-10-24 10:00')).toBe('2026-10-24 10:00+02:00');
    expect(withUtcOffset('2026-10-29 10:00-03:00')).toBe('2026-10-29 10:00-03:00');
    expect(withUtcOffset('now-6h')).toBe('now-6h');
    expect(withUtcOffset('yesterday')).toBe('yesterday');
  });
});
