// @vitest-environment jsdom
// Tests for context-menu.ts, over menus of its own, a real quick input and commands faked.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandsHost, MenuContext, MenuItem } from '../../commands/commands';
import { QuickInput } from '../quick-input/quick-input';
import { ContextMenu } from './context-menu';
import { Menus } from './menus';

afterEach(() => document.body.replaceChildren());

/** The menu `dashboards/entry` as an extension might fill it: one entry only for a favorite, the others for any. */
const ENTRIES: MenuItem[] = [
  { command: 'dashboards.openInNewTab', title: 'Open in new tab', group: 'navigation' },
  { command: 'dashboards.copyLink', title: 'Copy link', group: 'navigation' },
  { command: 'favorites.remove', group: 'favorites', when: (context) => context.favorite === true },
];

/** Menus holding `items` under `menuId`. */
function menusWith(menuId: string, items: readonly MenuItem[]): Menus {
  const menus = new Menus(() => []);
  for (const item of items) menus.register(menuId, item);
  return menus;
}

type FakeCommands = Pick<CommandsHost, 'executeCommand' | 'keybindingLabel' | 'enablement'>;

/** Commands that run nothing, have no keys and can all run, else as `more` says. */
function commandsWith(
  more: {
    executeCommand?(command: string, ...args: unknown[]): Promise<unknown>;
    keybindingLabel?(command: string): string | undefined;
    enablement?: FakeCommands['enablement'];
  } = {},
): FakeCommands {
  return { executeCommand: async () => undefined, keybindingLabel: () => undefined, enablement: () => ({ enabled: true }), ...more } as FakeCommands;
}

function setup(menus = menusWith('dashboards/entry', ENTRIES), more: Parameters<typeof commandsWith>[0] = {}) {
  const hostContainer = document.body.appendChild(document.createElement('div'));
  const triggerElement = hostContainer.appendChild(document.createElement('button'));
  triggerElement.focus();
  const ran: unknown[][] = [];
  const quickInput = new QuickInput(hostContainer);
  const menu = new ContextMenu(
    quickInput,
    menus,
    commandsWith({
      executeCommand: async (command, ...args) => void ran.push([command, document.activeElement === triggerElement, ...args]),
      keybindingLabel: (command) => (command === 'dashboards.copyLink' ? '⌘C' : undefined),
      ...more,
    }),
  );
  const show = (favorite = true) => menu.show('dashboards/entry', { anchor: { x: 10, y: 20 }, title: 'Shop', context: { favorite }, args: ['/p/shop'] });
  const items = () => [...hostContainer.querySelectorAll<HTMLElement>('[role=option]')];
  const field = () => hostContainer.querySelector<HTMLInputElement>('.d-workbench__quick-pick input')!;
  const isOpen = () => hostContainer.querySelector('.d-workbench__quick-pick') !== null;
  return { hostContainer, triggerElement, menu, quickInput, show, ran, items, field, isOpen };
}

describe('ContextMenu', () => {
  it("lists the menu's entries for the context in the quick pick at the anchor, a line between groups, the field focused", () => {
    const { hostContainer, show, items, field } = setup();
    show();
    const boxContainer = hostContainer.querySelector<HTMLElement>('.d-workbench__quick-pick')!;
    expect([boxContainer.getAttribute('aria-label'), boxContainer.style.left, boxContainer.style.top, document.activeElement]).toEqual(['Shop', '10px', '20px', field()]);
    expect([...hostContainer.querySelectorAll('[role=group]')].map((groupContainer) => groupContainer.querySelectorAll('[role=option]').length)).toEqual([1]);
    expect(items().map((itemElement) => itemElement.textContent)).toEqual(['Open in new tab', 'Copy link ⌘C', 'favorites.remove']);
    expect(items()[2].parentElement!.getAttribute('role')).toBe('group');
  });

  it('shows as a menu: no field in sight, its opener expanded until it is dismissed', () => {
    const { triggerElement, menu, field } = setup();
    menu.show('dashboards/entry', { anchor: triggerElement, title: 'Shop' });
    expect([field().classList.contains('d-workbench__quick-pick-field--concealed'), triggerElement.getAttribute('aria-expanded')]).toEqual([true, 'true']);
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(triggerElement.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows an entry with `toggled` with a check mark as it says in the context', () => {
    const shown: MenuContext[] = [];
    const items: MenuItem[] = [
      { command: 'dashboards.toggleFavorite', title: 'Favorite', toggled: (context) => (shown.push(context), context.favorite === true) },
      { command: 'dashboards.togglePinned', title: 'Pinned', toggled: () => false },
      { command: 'dashboards.copyLink', title: 'Copy link', group: 'z' },
    ];
    const { hostContainer, menu, items: options } = setup(menusWith('page/title', items));
    menu.show('page/title', { anchor: hostContainer, title: 'Shop', context: { favorite: true } });
    expect(options().map((entryElement) => [entryElement.getAttribute('aria-checked'), entryElement.textContent])).toEqual([
      ['true', '✓Favorite'],
      ['false', 'Pinned'],
      [null, 'Copy link ⌘C'],
    ]);
    expect(shown).toEqual([{ favorite: true }]);
    expect(hostContainer.querySelector('[role=listbox]')!.classList.contains('d-workbench__quick-pick-list--checks')).toBe(true);
  });

  it("shows an entry whose command is not enabled greyed with the command's reason, asked each time, and runs nothing when it is chosen", () => {
    const items: MenuItem[] = [
      { command: 'exploreView.open', title: 'Explore' },
      { command: 'dashboards.copyLink', title: 'Copy link' },
    ];
    let explore = false;
    const { hostContainer, menu, items: options, field, ran, isOpen } = setup(menusWith('workbench/global', items), {
      enablement: (command) => (command !== 'exploreView.open' || explore ? { enabled: true } : { enabled: false, disabledReason: 'Explore is not enabled (explore.enabled)' }),
    });
    menu.show('workbench/global', { anchor: hostContainer, title: 'Dashica' });
    expect(options().map((entryElement) => [entryElement.getAttribute('aria-disabled'), entryElement.title])).toEqual([
      ['true', 'Explore is not enabled (explore.enabled)'],
      [null, ''],
    ]);
    options()[0].click();
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect([ran, isOpen()]).toEqual([[], true]);
    explore = true;
    menu.show('workbench/global', { anchor: hostContainer, title: 'Dashica' });
    expect([options()[0].hasAttribute('aria-disabled'), options()[0].title]).toEqual([false, '']);
    options()[0].click();
    expect(ran).toEqual([['exploreView.open', true]]);
  });

  it("runs a chosen entry's command with the menu's arguments right after closing, the focus back on the trigger", () => {
    const { show, items, ran, isOpen } = setup();
    show(false);
    items()[1].click();
    expect(ran).toEqual([['dashboards.copyLink', true, '/p/shop']]);
    expect(isOpen()).toBe(false);
  });

  it('narrows the entries as the viewer types; Enter runs the first left', () => {
    const { show, items, field, ran } = setup();
    show();
    field().value = 'copy';
    field().dispatchEvent(new Event('input', { bubbles: true }));
    expect(items().map((itemElement) => itemElement.textContent)).toEqual(['Copy link ⌘C']);
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(ran).toEqual([['dashboards.copyLink', true, '/p/shop']]);
  });

  it('logs a failing command', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { hostContainer, menu } = setup(menusWith('m', [{ command: 'dashboards.copyLink' }]), { executeCommand: async () => Promise.reject(new Error('no')) });
    menu.show('m', { anchor: hostContainer, title: 'm' });
    hostContainer.querySelector<HTMLElement>('[role=option]')!.click();
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('Command dashboards.copyLink failed:', expect.any(Error)));
    error.mockRestore();
  });

  it('shows nothing for a menu without entries that apply, and hides the open box', () => {
    const { menu, show, isOpen } = setup();
    show();
    menu.show('widget/context', { anchor: { x: 0, y: 0 }, title: 'Chart' });
    expect(isOpen()).toBe(false);
  });

  it('closes on Escape (the focus back), on a press elsewhere and on a new menu, running nothing', () => {
    const { hostContainer, show, field, triggerElement, ran, isOpen } = setup();
    show();
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect([isOpen(), document.activeElement]).toEqual([false, triggerElement]);
    show();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(isOpen()).toBe(false);
    show();
    show(false);
    expect(hostContainer.querySelectorAll('.d-workbench__quick-pick')).toHaveLength(1);
    expect(ran).toEqual([]);
  });
});
