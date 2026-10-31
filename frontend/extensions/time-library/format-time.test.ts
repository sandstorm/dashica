// Tests for format-time.ts: a date as an end of a custom range, in the viewer's time zone.
import { describe, expect, it } from 'vitest';
import { formatTime } from './format-time';

describe('formatTime', () => {
  it('writes the local date and time to the minute, padded', () => {
    expect(formatTime(new Date(2026, 9, 29, 10, 0))).toBe('2026-10-29 10:00');
    expect(formatTime(new Date(2026, 0, 2, 3, 4, 59))).toBe('2026-01-02 03:04');
  });
});
