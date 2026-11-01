// Tests for time-state.ts: the time range read from the URL with the page's default, left out of the URL as the
// default, and sent with `time` always; the auto refresh in the URL, not sent.
import { describe, expect, it, vi } from 'vitest';
import type { PageJson } from '../../generated/zz_generated.dashica';
import { QueryHost } from '../../hosts/query/query';
import { REFRESH } from './refresh-state';
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

  it('writes the range, a custom one with its ends, the default too', () => {
    expect(TIME.format(presetRange('3h'))).toEqual([['time', '3h']]);
    expect(TIME.format(presetRange('24h'))).toEqual([['time', '24h']]);
    expect(TIME.format(customRange('2026-10-29 10:00', '2026-10-29 12:30'))).toEqual([
      ['time', 'custom'],
      ['range', '2026-10-29 10:00 to 2026-10-29 12:30'],
    ]);
  });

  it('is left out of the URL as the page’s default (else 24h) and sent all the same; another range in both', () => {
    vi.useFakeTimers();
    const query = new QueryHost();
    query.declare(TIME);
    query.declare(REFRESH);
    const searches: string[] = [];
    query.onDidChangeSearch((search) => searches.push(search));
    query.load({ search: '?time=1h', page: shop('168h') });
    query.set(TIME, presetRange('168h'));
    vi.advanceTimersByTime(200);
    expect(searches).toEqual(['']);
    expect(query.requestParams().toString()).toBe('time=168h');
    query.set(TIME, presetRange('24h'));
    vi.advanceTimersByTime(200);
    expect(searches.at(-1)).toBe('?time=24h');
    expect(query.requestParams().toString()).toBe('time=24h');
    query.load({ search: '?time=1h', page: shop() });
    query.set(TIME, presetRange('24h'));
    vi.advanceTimersByTime(200);
    expect(searches.at(-1)).toBe('');
    expect(query.requestParams().toString()).toBe('time=24h');
    query.set(TIME, customRange('now-6h', 'now-1h'));
    query.set(REFRESH, 30);
    vi.advanceTimersByTime(200);
    expect(searches.at(-1)).toBe('?time=custom&range=now-6h+to+now-1h&refresh=30');
    expect([...query.requestParams()]).toEqual([
      ['time', 'custom'],
      ['range', 'now-6h to now-1h'],
    ]);
    query.dispose();
    vi.useRealTimers();
  });
});
