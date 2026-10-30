// @vitest-environment jsdom
// Tests for time-range.ts: presets, a range without preset, custom, refresh.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionContext } from '../../hosts/extension-host/extension-host';
import { QueryHost } from '../../hosts/query/query';
import { timeRange } from './time-range';

let query: QueryHost;
let bar: HTMLElement;
let commands: Map<string, () => void>;

beforeEach(() => {
  history.replaceState(null, '', '/p/shop');
  query = new QueryHost(window);
  query.load();
  bar = document.body.appendChild(document.createElement('div'));
  commands = new Map();
  const context = {
    query,
    subscriptions: [],
    ui: { registerBarItem: (_bar: string, el: HTMLElement) => bar.appendChild(el) },
    commands: { registerCommand: (id: string, run: () => void) => commands.set(id, run) },
  };
  timeRange.activate(context as unknown as ExtensionContext);
});

afterEach(() => {
  query.dispose();
  document.body.replaceChildren();
  history.replaceState(null, '', '/');
});

const select = () => bar.querySelector('select')!;
const input = (label: string) => bar.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;

function pick(value: string): void {
  select().value = value;
  select().dispatchEvent(new Event('change'));
}

describe('timeRange', () => {
  it('shows the range and sets a preset picked', () => {
    expect(select().value).toBe('24h');
    pick('1h');
    expect(query.time.range).toBe('1h');
  });

  it('offers a range without preset, as the page declares it', () => {
    query.load({ defaultTime: '90m' });
    expect(select().value).toBe('90m');
    expect(select().selectedOptions[0].textContent).toBe('Last 90m');
  });

  it('turns "Custom" into the window of the preset before, auto refresh off', () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 29, 12, 0) });
    query.time.setAutoRefresh(30);
    pick('1h');
    pick('custom');
    vi.useRealTimers();
    expect(query.time.custom).toBe('2026-10-29 11:00 to 2026-10-29 12:00');
    expect(query.time.autoRefresh).toBeUndefined();
    expect(input('From').value).toBe('2026-10-29T11:00');
    expect(input('To').value).toBe('2026-10-29T12:00');
  });

  it('sets the custom range typed', () => {
    pick('custom');
    input('From').value = '2026-10-28T08:00';
    input('From').dispatchEvent(new Event('change'));
    input('To').value = '2026-10-28T09:30';
    input('To').dispatchEvent(new Event('change'));
    expect(query.time.custom).toBe('2026-10-28 08:00 to 2026-10-28 09:30');
  });

  it('refreshes from its button and its command', () => {
    let refreshed = 0;
    query.onDidRequestRefresh(() => refreshed++);
    bar.querySelector<HTMLButtonElement>('button[title=Refresh]')!.click();
    commands.get('timeRange.refresh')!();
    expect(refreshed).toBe(2);
  });
});
