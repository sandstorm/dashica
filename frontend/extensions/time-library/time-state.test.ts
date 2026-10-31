// Tests for time-state.ts: the time range read from the URL with the page's default, written back without it, and
// sent with `time` always.
import { describe, expect, it } from 'vitest';
import type { PageJson } from '../../generated/zz_generated.dashica';
import { customRange, presetRange, timeState } from './time-state';

const shop = (defaultTime?: string): PageJson => ({ kind: 'dashboard', title: 'Shop', defaultTime, filterBar: false, filterButtons: [], widgets: [] });

const url = (search: string) => new URLSearchParams(search);

describe('timeState', () => {
  it('reads the range, the page’s default for a missing one, else 24h', () => {
    expect(timeState.parse(url('?time=1h'), shop('168h'))).toEqual(presetRange('1h'));
    expect(timeState.parse(url(''), shop('168h'))).toEqual(presetRange('168h'));
    expect(timeState.parse(url(''), shop())).toEqual(presetRange('24h'));
    expect(timeState.parse(url(''), undefined)).toEqual(presetRange('24h'));
  });

  it('reads a custom range with its ends, and no ends for a preset', () => {
    expect(timeState.parse(url('?time=custom&range=now-6h+to+now-1h'), undefined)).toEqual(customRange('now-6h', 'now-1h'));
    expect(timeState.parse(url('?time=1h&range=now-6h+to+now'), undefined)).toEqual(presetRange('1h'));
  });

  it('writes the range, leaving out the page’s default', () => {
    expect(timeState.format(presetRange('3h'), shop('1h'))).toEqual([['time', '3h']]);
    expect(timeState.format(presetRange('1h'), shop('1h'))).toEqual([]);
    expect(timeState.format(presetRange('24h'), undefined)).toEqual([]);
    expect(timeState.format(customRange('2026-10-29 10:00', '2026-10-29 12:30'), undefined)).toEqual([
      ['time', 'custom'],
      ['range', '2026-10-29 10:00 to 2026-10-29 12:30'],
    ]);
  });

  it('sends `time` also when it is the default, a custom range with its ends', () => {
    expect(timeState.request!(presetRange('24h'))).toEqual([['time', '24h']]);
    expect(timeState.request!(customRange('now-6h', 'now-1h'))).toEqual([
      ['time', 'custom'],
      ['range', 'now-6h to now-1h'],
    ]);
  });
});
