// @vitest-environment jsdom
// Tests for search-everywhere.ts in the workbench: its ways in (keys, the rail button) and its group of commands.
import { afterEach, describe, expect, it } from 'vitest';
import type { Disposable } from '../../core/disposable/disposable';
import { createWorkbench } from '../../workbench/workbench';
import { searchEverywhere } from './search-everywhere';

let workbench: Disposable | undefined;

afterEach(() => {
  workbench?.dispose();
  document.body.replaceChildren();
  sessionStorage.clear();
});

function setup() {
  const host = document.body.appendChild(document.createElement('div'));
  const ran: string[] = [];
  workbench = createWorkbench(host, {
    extensions: [
      searchEverywhere,
      {
        id: 'timeRange',
        contributes: {
          commands: [
            { command: 'timeRange.refresh', title: 'Refresh', category: 'Time range' },
            { command: 'timeRange.unregistered', title: 'Never registered' },
          ],
          keybindings: [{ command: 'timeRange.refresh', key: 'Mod+KeyR' }],
        },
        activate: ({ commands, subscriptions }) => subscriptions.push(commands.registerCommand('timeRange.refresh', () => ran.push('refresh'))),
      },
    ],
    workbench: { menu: [], explore: false, connections: [] },
  });
  const field = () => host.querySelector<HTMLInputElement>('.d-workbench__quick-pick input');
  const options = () => [...host.querySelectorAll<HTMLElement>('[role=option]')].map((option) => option.textContent);
  const press = (init: KeyboardEventInit) => document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  return { host, ran, field, options, press };
}

describe('searchEverywhere', () => {
  it('opens with Ctrl+K and from its button first in the left rail, whose tooltip names the key', () => {
    const { host, field, press } = setup();
    const button = host.querySelector<HTMLButtonElement>('.d-workbench__side--left .d-workbench__rail-button')!;
    expect([button.dataset.testid, button.title]).toEqual(['wb-rail-button-search', 'Search everywhere (Ctrl+K)']);
    button.click();
    expect(document.activeElement).toBe(field());
    field()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(field()).toBeNull();
    press({ key: 'k', code: 'KeyK', ctrlKey: true });
    expect(field()).not.toBeNull();
  });

  it('lists the declared commands that are registered, with their keys, and runs the picked one', () => {
    const { ran, field, options, press } = setup();
    press({ key: 'a', code: 'KeyA', ctrlKey: true, shiftKey: true });
    expect(field()!.value).toBe('>');
    expect(options()).toEqual(['Time range: Refresh Ctrl+R', 'Tabs: Close tab', 'Tabs: Next tab', 'Tabs: Previous tab']);
    field()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(ran).toEqual(['refresh']);
  });
});
