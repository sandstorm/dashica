// @vitest-environment jsdom
// Tests for auto-refresh.ts: the toggle sets the interval and shows the URL's.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ExtensionContext } from '../../hosts/extension-host/extension-host';
import { QueryHost } from '../../hosts/query/query';
import { autoRefresh } from './auto-refresh';

let query: QueryHost;
let bar: HTMLElement;

beforeEach(() => {
  history.replaceState(null, '', '/p/shop?refresh=60');
  query = new QueryHost(window);
  query.load();
  bar = document.body.appendChild(document.createElement('div'));
  const context = { query, subscriptions: [], ui: { registerBarItem: (_bar: string, el: HTMLElement) => bar.appendChild(el) } };
  autoRefresh.activate(context as unknown as ExtensionContext);
});

afterEach(() => {
  query.dispose();
  document.body.replaceChildren();
  history.replaceState(null, '', '/');
});

describe('autoRefresh', () => {
  it('shows the URL’s auto refresh; off and on again, every 30 seconds', () => {
    const toggle = bar.querySelector('input')!;
    expect(toggle.checked).toBe(true);
    toggle.click();
    expect(query.time.autoRefresh).toBeUndefined();
    expect(bar.querySelector<HTMLElement>('.loading')!.hidden).toBe(true);
    toggle.click();
    expect(query.time.autoRefresh).toBe(30);
  });
});
