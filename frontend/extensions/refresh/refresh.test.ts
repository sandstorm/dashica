// @vitest-environment jsdom
// Tests for refresh.ts: refresh now from the button and the command, the auto refresh interval.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ExtensionContext } from '../../hosts/extension-host/extension-host';
import { QueryHost } from '../../hosts/query/query';
import { refresh } from './refresh';

let query: QueryHost;
let bar: HTMLElement;
let commands: Map<string, () => void>;

beforeEach(() => {
  history.replaceState(null, '', '/p/shop?refresh=45');
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
  refresh.activate(context as unknown as ExtensionContext);
});

afterEach(() => {
  query.dispose();
  document.body.replaceChildren();
  history.replaceState(null, '', '/');
});

const interval = () => bar.querySelector('select')!;

function pick(value: string): void {
  interval().value = value;
  interval().dispatchEvent(new Event('change'));
}

describe('refresh', () => {
  it('refreshes from its button and its command', () => {
    let refreshed = 0;
    query.onDidRequestRefresh(() => refreshed++);
    bar.querySelector<HTMLButtonElement>('button[aria-label=Refresh]')!.click();
    commands.get('refresh.now')!();
    expect(refreshed).toBe(2);
  });

  it('shows the URL’s interval, also one not offered, and sets the one picked', () => {
    expect(interval().value).toBe('45');
    expect(interval().selectedOptions[0].textContent).toBe('45s');
    pick('');
    expect(query.time.autoRefresh).toBeUndefined();
    pick('60');
    expect(query.time.autoRefresh).toBe(60);
    expect(interval().selectedOptions[0].textContent).toBe('1m');
  });
});
