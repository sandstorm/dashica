// @vitest-environment jsdom
// Tests for time-range.ts: the button, the quick ranges, From / To (read by a fake /time-range), closing the panel, shift and zoom.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionContext, Memento } from '../../hosts/extension-host/extension-host';
import { QueryHost } from '../../hosts/query/query';
import { REFRESH_STATE, refreshState, type AutoRefresh } from '../time-library/refresh-state';
import { timeRange } from './time-range';

let query: QueryHost;
let bar: HTMLElement;
let stored: Map<string, unknown>;

beforeEach(() => {
  history.replaceState(null, '', '/p/shop');
  query = new QueryHost();
  // the refresh extension's state, which a fixed range turns off
  query.registerState(REFRESH_STATE, refreshState);
  query.load();
  bar = document.body.appendChild(document.createElement('div'));
  stored = new Map();
  const globalState: Memento = {
    get: (key: string, defaultValue?: unknown) => (stored.has(key) ? stored.get(key) : defaultValue),
    update: async (key: string, value: unknown) => void stored.set(key, value),
  } as Memento;
  const context = {
    query,
    globalState,
    subscriptions: [],
    ui: {
      registerBarItem: (_bar: string, el: HTMLElement) => {
        bar.appendChild(el);
        return { dispose: () => el.remove() };
      },
    },
  };
  timeRange.activate(context as unknown as ExtensionContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
  query.dispose();
  document.body.replaceChildren();
  history.replaceState(null, '', '/');
});

const autoRefresh = () => query.state<AutoRefresh>(REFRESH_STATE)!;
const rangeButton = () => bar.querySelector<HTMLButtonElement>('button[aria-haspopup]')!;
const panel = () => bar.querySelector<HTMLElement>('[role=dialog]')!;
const input = (label: string) => bar.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const quickRanges = () => [...panel().querySelectorAll(':scope > div li button')].map((item) => item.textContent);
const apply = () => bar.querySelector<HTMLButtonElement>('button[type=submit]')!;

function type(label: string, value: string): void {
  input(label).value = value;
  input(label).dispatchEvent(new Event('input'));
}

/** 2026-10-29 `hours`:`minutes` in the viewer's time zone, in ms. */
const at = (hours: number, minutes: number) => new Date(2026, 9, 29, hours, minutes).getTime();

const click = (label: string) => bar.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click();

/** `/time-range` answers `status` and `body`; gives the query strings asked with. */
function serverAnswers(status: number, body: string): string[] {
  const asked: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    asked.push(new URL(url, location.href).searchParams.toString());
    return new Response(body, { status });
  });
  return asked;
}

/** Submits From / To and waits for the server's answer. */
async function submit(): Promise<void> {
  bar.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  await vi.waitFor(() => expect(apply().disabled).toBe(false));
}

describe('timeRange', () => {
  it('shows the range on its button, and sets a quick range picked', () => {
    expect(rangeButton().textContent).toBe('Last 24 hours');
    rangeButton().click();
    expect(panel().hidden).toBe(false);
    [...panel().querySelectorAll<HTMLButtonElement>(':scope > div li button')].find((item) => item.textContent === 'Last 1 hour')!.click();
    expect(query.time.range).toBe('1h');
    expect(rangeButton().textContent).toBe('Last 1 hour');
    expect(panel().hidden).toBe(true);
  });

  it('shows a range without preset, as the page declares it', () => {
    query.load({ defaultTime: '90m' });
    expect(rangeButton().textContent).toBe('Last 90m');
  });

  it('narrows the quick ranges to what is typed', () => {
    rangeButton().click();
    type('Search quick ranges', 'days');
    expect(quickRanges()).toEqual(['Last 2 days', 'Last 7 days', 'Last 30 days']);
  });

  it('opens with From / To of the range shown, in the unit people read it in', () => {
    query.time.setRange('720h');
    rangeButton().click();
    expect(input('From').value).toBe('now-30d');
    rangeButton().click();
    query.time.setRange('6h');
    rangeButton().click();
    expect(input('From').value).toBe('now-6h');
    expect(input('To').value).toBe('now');
  });

  it('applies a range relative to now once the server read it, auto refresh kept', async () => {
    const asked = serverAnswers(200, '{"from":1761703200000,"to":1761721200000}');
    autoRefresh().set(30);
    rangeButton().click();
    type('From', 'now-6h');
    type('To', 'now-1h');
    await submit();
    expect(asked).toEqual([new URLSearchParams({ time: 'custom', range: 'now-6h to now-1h' }).toString()]);
    expect(query.time.custom).toBe('now-6h to now-1h');
    expect(autoRefresh().get()).toBe(30);
    expect(rangeButton().textContent).toBe('now-6h to now-1h');
    expect(panel().hidden).toBe(true);
  });

  it('applies a fixed range, auto refresh off, its day once on the button', async () => {
    serverAnswers(200, '{"from":1761631200000,"to":1761636600000}');
    autoRefresh().set(30);
    rangeButton().click();
    type('From', '2026-10-28 08:00');
    type('To', '2026-10-28 09:30');
    await submit();
    expect(query.time.custom).toBe('2026-10-28 08:00 to 2026-10-28 09:30');
    expect(autoRefresh().get()).toBeUndefined();
    expect(rangeButton().textContent).toBe('2026-10-28 08:00 to 09:30');
  });

  it('shows the server’s reason for a range it cannot read, and applies nothing', async () => {
    serverAnswers(400, 'time "yesterday": neither `now-…` nor `2006-01-02 15:04`\n');
    rangeButton().click();
    type('From', 'yesterday');
    await submit();
    expect(panel().querySelector('[role=alert]')!.textContent).toBe('time "yesterday": neither `now-…` nor `2006-01-02 15:04`');
    expect(panel().hidden).toBe(false);
    expect(query.time.range).toBe('24h');
  });

  it('offers the last three custom ranges applied, newest first, and applies one picked', async () => {
    serverAnswers(200, '{"from":1761703200000,"to":1761721200000}');
    for (const from of ['now-1h', 'now-2h', 'now-3h', 'now-2h', 'now-4h']) {
      rangeButton().click();
      type('From', from);
      type('To', 'now');
      await submit();
    }
    expect(stored.get('recent')).toEqual(['now-4h to now', 'now-2h to now', 'now-3h to now']);
    rangeButton().click();
    const recent = [...panel().querySelectorAll<HTMLButtonElement>('form li button')];
    expect(recent.map((item) => item.textContent)).toEqual(['now-4h to now', 'now-2h to now', 'now-3h to now']);
    recent[2].click();
    await vi.waitFor(() => expect(query.time.custom).toBe('now-3h to now'));
  });

  it('closes on Escape and on a click outside', () => {
    rangeButton().click();
    input('From').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel().hidden).toBe(true);
    rangeButton().click();
    input('From').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(panel().hidden).toBe(false);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(panel().hidden).toBe(true);
  });

  it('shifts the window by its length, auto refresh off', async () => {
    const asked = serverAnswers(200, JSON.stringify({ from: at(11, 0), to: at(12, 0) }));
    query.time.setRange('1h');
    autoRefresh().set(30);
    click('Shift back');
    await vi.waitFor(() => expect(query.time.custom).toBe('2026-10-29 10:00 to 2026-10-29 11:00'));
    expect(asked).toEqual(['time=1h']);
    expect(autoRefresh().get()).toBeUndefined();
    serverAnswers(200, JSON.stringify({ from: at(10, 0), to: at(11, 0) }));
    click('Shift forward');
    await vi.waitFor(() => expect(query.time.custom).toBe('2026-10-29 11:00 to 2026-10-29 12:00'));
  });

  it('zooms a window ending now out to the preset twice as long', async () => {
    serverAnswers(200, JSON.stringify({ from: at(11, 0), to: at(12, 0) }));
    query.time.setRange('1h');
    click('Zoom out');
    await vi.waitFor(() => expect(query.time.range).toBe('2h'));
    expect(rangeButton().textContent).toBe('Last 2h');
  });

  it('zooms a fixed window out by half its length on each side', async () => {
    serverAnswers(200, JSON.stringify({ from: at(10, 0), to: at(12, 0) }));
    query.time.setCustom('2026-10-29 10:00', '2026-10-29 12:00');
    click('Zoom out');
    await vi.waitFor(() => expect(query.time.custom).toBe('2026-10-29 09:00 to 2026-10-29 13:00'));
  });
});
