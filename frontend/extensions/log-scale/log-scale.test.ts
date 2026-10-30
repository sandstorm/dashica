// @vitest-environment jsdom
// Tests for log-scale.ts: the toggle sets the view option and shows the URL's.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ExtensionContext } from '../../hosts/extension-host/extension-host';
import { QueryHost } from '../../hosts/query/query';
import { logScale } from './log-scale';

let query: QueryHost;
let bar: HTMLElement;

beforeEach(() => {
  history.replaceState(null, '', '/p/shop?log=1');
  query = new QueryHost(window);
  query.load();
  bar = document.body.appendChild(document.createElement('div'));
  const context = { query, subscriptions: [], ui: { registerBarItem: (_bar: string, el: HTMLElement) => bar.appendChild(el) } };
  logScale.activate(context as unknown as ExtensionContext);
});

afterEach(() => {
  query.dispose();
  document.body.replaceChildren();
  history.replaceState(null, '', '/');
});

describe('logScale', () => {
  it('shows the URL’s log scale and turns it off', () => {
    const toggle = bar.querySelector('input')!;
    expect(toggle.checked).toBe(true);
    toggle.click();
    expect(query.viewOptions.logScale).toBe(false);
  });
});
