// Tests for time-state.ts: the time range read from the URL with the page's default, written back without it, and
// sent with `time` always.
import { describe, expect, it } from 'vitest';
import type { PageJson } from '../../generated/zz_generated.dashica';
import { TIME, customRange, presetRange } from './time-state';

const shop = (defaultTime?: string): PageJson => ({ kind: 'dashboard', title: 'Shop', defaultTime, filterBar: false, filterButtons: [], widgets: [] });

const url = (search: string) => new URLSearchParams(search);

describe('TIME', () => {
  it('reads the range, the page’s default for a missing one, else 24h', () => {
    expect(TIME.parse(url('?time=1h'), shop('168h'))).toEqual(presetRange('1h'));
    expect(TIME.parse(url(''), shop('168h'))).toEqual(presetRange('168h'));
    expect(TIME.parse(url(''), shop())).toEqual(presetRange('24h'));
    expect(TIME.parse(url(''), undefined)).toEqual(presetRange('24h'));
  });

  it('reads a custom range with its ends, and no ends for a preset', () => {
    expect(TIME.parse(url('?time=custom&range=now-6h+to+now-1h'), undefined)).toEqual(customRange('now-6h', 'now-1h'));
    expect(TIME.parse(url('?time=1h&range=now-6h+to+now'), undefined)).toEqual(presetRange('1h'));
  });

  it('writes the range, leaving out the page’s default', () => {
    expect(TIME.format(presetRange('3h'), shop('1h'))).toEqual([['time', '3h']]);
    expect(TIME.format(presetRange('1h'), shop('1h'))).toEqual([]);
    expect(TIME.format(presetRange('24h'), undefined)).toEqual([]);
    expect(TIME.format(customRange('2026-10-29 10:00', '2026-10-29 12:30'), undefined)).toEqual([
      ['time', 'custom'],
      ['range', '2026-10-29 10:00 to 2026-10-29 12:30'],
    ]);
  });

  it('sends `time` also when it is the default, a custom range with its ends', () => {
    expect(TIME.request!(presetRange('24h'))).toEqual([['time', '24h']]);
    expect(TIME.request!(customRange('now-6h', 'now-1h'))).toEqual([
      ['time', 'custom'],
      ['range', 'now-6h to now-1h'],
    ]);
  });
});
