// @vitest-environment jsdom
// Tests for time-range.ts: the button, the quick ranges, From / To, closing the panel, refresh.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

const rangeButton = () => bar.querySelector<HTMLButtonElement>('button[aria-haspopup]')!;
const panel = () => bar.querySelector<HTMLElement>('[role=dialog]')!;
const input = (label: string) => bar.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const quickRanges = () => [...panel().querySelectorAll('li button')].map((item) => item.textContent);
const apply = () => bar.querySelector<HTMLButtonElement>('button[type=submit]')!;

function type(label: string, value: string): void {
  input(label).value = value;
  input(label).dispatchEvent(new Event('input'));
}

function submit(): void {
  bar.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
}

describe('timeRange', () => {
  it('shows the range on its button, and sets a quick range picked', () => {
    expect(rangeButton().textContent).toBe('Last 24 hours');
    rangeButton().click();
    expect(panel().hidden).toBe(false);
    [...panel().querySelectorAll<HTMLButtonElement>('li button')].find((item) => item.textContent === 'Last 1 hour')!.click();
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

  it('opens with From / To of the range shown', () => {
    query.time.setRange('6h');
    rangeButton().click();
    expect(input('From').value).toBe('now-6h');
    expect(input('To').value).toBe('now');
  });

  it('applies a range relative to now, auto refresh kept', () => {
    query.time.setAutoRefresh(30);
    rangeButton().click();
    type('From', 'now-6h');
    type('To', 'now-1h');
    submit();
    expect(query.time.custom).toBe('now-6h to now-1h');
    expect(query.time.autoRefresh).toBe(30);
    expect(rangeButton().textContent).toBe('now-6h to now-1h');
    expect(panel().hidden).toBe(true);
  });

  it('applies a fixed range, auto refresh off, its day once on the button', () => {
    query.time.setAutoRefresh(30);
    rangeButton().click();
    type('From', '2026-10-28 08:00');
    type('To', '2026-10-28 09:30');
    submit();
    expect(query.time.custom).toBe('2026-10-28 08:00 to 2026-10-28 09:30');
    expect(query.time.autoRefresh).toBeUndefined();
    expect(rangeButton().textContent).toBe('2026-10-28 08:00 to 09:30');
  });

  it('marks what it cannot read, and a From after To; applies neither', () => {
    rangeButton().click();
    type('From', 'yesterday');
    expect(input('From').getAttribute('aria-invalid')).toBe('true');
    expect(apply().disabled).toBe(true);
    type('From', 'now-1h');
    type('To', 'now-2h');
    expect(input('From').getAttribute('aria-invalid')).toBe('false');
    expect(apply().disabled).toBe(true);
    submit();
    expect(query.time.range).toBe('24h');
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

  it('refreshes from its button and its command', () => {
    let refreshed = 0;
    query.onDidRequestRefresh(() => refreshed++);
    bar.querySelector<HTMLButtonElement>('button[title=Refresh]')!.click();
    commands.get('timeRange.refresh')!();
    expect(refreshed).toBe(2);
  });
});
