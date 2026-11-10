// @vitest-environment jsdom
// Tests for window-layout.ts (WindowLayout) and its two sides (side-bar.ts).
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandsHost } from '../../commands/commands';
import { Menus } from '../menus/menus';
import type { ContextMenuOptions } from '../ui';
import { WindowLayout } from './window-layout';

let resize: (() => void) | null = null;

/** The layout's state in the session storage under `prefix`, as JSON (as the workbench keeps it). */
function sessionMemento(prefix: string) {
  return {
    get: <T>(key: string): T | undefined => {
      const text = sessionStorage.getItem(prefix + key);
      return text == null ? undefined : (JSON.parse(text) as T);
    },
    update: async (key: string, value: unknown) => sessionStorage.setItem(prefix + key, JSON.stringify(value)),
  };
}

function setup({ observe = false, key = `test-${Math.random()}` } = {}) {
  if (observe) {
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    });
  }
  const hostContainer = document.createElement('div');
  document.body.append(hostContainer);
  const commands = new CommandsHost(hostContainer);
  const menus = new Menus(() => commands.getCommands());
  const shownMenus: [string, ContextMenuOptions][] = [];
  const layout = new WindowLayout(hostContainer, sessionMemento(`${key}:`), commands, {
    registerMenuItem: (menuId, item) => menus.register(menuId, item),
    showContextMenu: (menuId, options) => shownMenus.push([menuId, options]),
  });
  const sidePanel = layout.addSidePanel('dashboards', { label: 'Dashboards', icon: '<svg></svg>' });
  const bodyContainer = sidePanel.bodyContainer;
  bodyContainer.textContent = 'menu';
  const toggleElement = hostContainer.querySelector<HTMLButtonElement>('[data-testid=wb-panel-toggle-dashboards]')!;
  const panelContainer = hostContainer.querySelector<HTMLElement>('.d-workbench__side--left .d-workbench__panel')!;
  const setWidth = (width: number) => {
    Object.defineProperty(hostContainer, 'clientWidth', { value: width, configurable: true });
    resize?.();
  };
  /** Whether the panel is open, as people see it: its rail button pressed and its body shown. */
  const isOpen = () => toggleElement.getAttribute('aria-pressed') === 'true' && !panelContainer.hidden && !bodyContainer.hidden;
  /** Adds the right side's panel `id`. */
  const right = (id = 'inspector', label = 'Inspector') => layout.addSidePanel(id, { label, icon: '<svg></svg>', side: 'right' });
  return { hostContainer, layout, commands, menus, shownMenus, sidePanel, bodyContainer, toggleElement, panelContainer, setWidth, key, isOpen, right };
}

afterEach(() => {
  vi.unstubAllGlobals();
  resize = null;
  sessionStorage.clear();
});

describe('WindowLayout', () => {
  it('puts the left side, the top bar with the tab bar, filter bar and content between the sides, the right side and the status bar into the host', () => {
    const { hostContainer, layout } = setup();
    expect([...hostContainer.children].map((childElement) => childElement.className)).toEqual([
      'd-workbench__side d-workbench__side--left',
      'd-workbench__center',
      'd-workbench__side d-workbench__side--right',
      'd-workbench__status-bar',
    ]);
    expect(layout.tabBarContainer.parentElement).toBe(layout.topBarContainer);
    expect([...hostContainer.querySelector('.d-workbench__center')!.children].map((childElement) => childElement.className)).toEqual([
      'd-workbench__top-bar',
      'd-workbench__filter-bar',
      'd-workbench__content',
    ]);
    expect(layout.contentContainer.className).toBe('d-workbench__content');
  });

  it('the sides reach from the top to the status bar; the top bar is only over the content', () => {
    const css = readFileSync('frontend/hosts/ui/layout/window-layout.css', 'utf8');
    const rule = (selector: string) => new RegExp(`${selector.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';
    expect(rule('.d-workbench')).toMatch(/grid-template-rows:\s*minmax\(0, 1fr\) auto;/);
    expect(rule('.d-workbench__side')).toMatch(/grid-row: 1;/);
    expect(rule('.d-workbench__center')).toMatch(/grid-column: 2;\s*grid-row: 1;/);
    expect(rule('.d-workbench__status-bar')).toMatch(/grid-column: 1 \/ -1;\s*grid-row: 2;/);
  });

  it('keeps what is put at the left rail’s start before every button, also ones added later', () => {
    const { hostContainer, layout } = setup();
    const menuButtonElement = document.createElement('button');
    layout.railStartContainer.append(menuButtonElement);
    layout.addRailButton('search', { label: 'Search everywhere', icon: '<svg></svg>', command: 'test.search', order: -100 });
    const railContainer = hostContainer.querySelector('.d-workbench__side--left .d-workbench__rail')!;
    expect(railContainer.querySelector('button')).toBe(menuButtonElement);
    expect(railContainer.querySelectorAll('button')[1].getAttribute('aria-label')).toBe('Search everywhere');
  });

  it('places rail buttons by order, equal orders in registration order', () => {
    const { hostContainer, layout } = setup();
    const icon = () => '<svg></svg>';
    layout.addSidePanel('favorites', { label: 'Favorites', icon: icon(), order: -10 });
    layout.addSidePanel('search', { label: 'Search', icon: icon(), order: 20 });
    layout.addSidePanel('alerts', { label: 'Alerts', icon: icon() });
    const rail = [...hostContainer.querySelectorAll<HTMLElement>('.d-workbench__rail-button')].map((buttonElement) => buttonElement.title);
    expect(rail).toEqual(['Favorites', 'Dashboards', 'Alerts', 'Search']);
  });

  it("places bottom-aligned panels in the rail's far-end group", () => {
    const { hostContainer, layout } = setup();
    const icon = () => '<svg></svg>';
    layout.addSidePanel('help', { label: 'Help', icon: icon(), order: 20 });
    layout.addSidePanel('settings', { label: 'Settings', icon: icon(), alignment: 'bottom', order: 5 });
    layout.addSidePanel('account', { label: 'Account', icon: icon(), alignment: 'bottom' });
    layout.addSidePanel('alerts', { label: 'Alerts', icon: icon(), order: 15 });
    const titles = (selector: string) => [...hostContainer.querySelectorAll<HTMLElement>(selector)].map((buttonElement) => buttonElement.title);
    expect(titles('.d-workbench__rail > .d-workbench__rail-button')).toEqual(['Dashboards', 'Alerts', 'Help']);
    expect(titles('.d-workbench__rail-bottom > .d-workbench__rail-button')).toEqual(['Account', 'Settings']);
    // the bottom group comes after every top button
    expect(hostContainer.querySelector('.d-workbench__rail')!.lastElementChild!.className).toBe('d-workbench__rail-bottom');
  });

  it('removes a panel and its rail button', () => {
    const { hostContainer, sidePanel } = setup();
    sidePanel.setDefault(true);
    sidePanel.dispose();
    expect(hostContainer.querySelector('[data-panel=dashboards]')).toBeNull();
    expect(hostContainer.querySelector('[data-testid=wb-panel-toggle-dashboards]')).toBeNull();
    expect(hostContainer.querySelector<HTMLElement>('.d-workbench__side--left')!.hidden).toBe(true);
  });

  it('the right side column is a share of the workbench, so an opening left panel narrows only the content column', () => {
    // with `1fr 1fr` the panel's width would come out of both columns and the right side would move
    const css = readFileSync('frontend/hosts/ui/layout/window-layout.css', 'utf8');
    const columns = /\.d-workbench \{[^}]*grid-template-columns:\s*([^;]+);/.exec(css)?.[1].trim();
    expect(columns).toBe('auto minmax(min(20rem, 25%), 1fr) var(--d-workbench-right-side, auto)');
  });

  it('a panel is closed until its default says open; the rail button toggles it', () => {
    const { sidePanel, bodyContainer, toggleElement, panelContainer, isOpen } = setup();
    expect(panelContainer.hidden).toBe(true);
    expect(toggleElement.getAttribute('aria-pressed')).toBe('false');
    sidePanel.setDefault(true);
    expect(panelContainer.hidden).toBe(false);
    expect(bodyContainer.hidden).toBe(false);
    expect(isOpen()).toBe(true);
    toggleElement.click();
    expect(panelContainer.hidden).toBe(true);
    expect(toggleElement.getAttribute('aria-pressed')).toBe('false');
  });

  it('nudge() marks the rail button of a hidden panel until it shows; a shown panel stays as it is', () => {
    const { sidePanel, toggleElement } = setup();
    const nudged = () => toggleElement.classList.contains('d-workbench__rail-button--nudged');
    sidePanel.nudge();
    expect(nudged()).toBe(true);
    toggleElement.click();
    expect(nudged()).toBe(false);
    sidePanel.nudge();
    expect(nudged()).toBe(false);
  });

  it("someone's choice wins over the default, also for the next workbench in the session", () => {
    const { sidePanel, toggleElement, key, isOpen } = setup();
    toggleElement.click();
    sidePanel.setDefault(false);
    expect(isOpen()).toBe(true);
    const again = setup({ key });
    expect(again.isOpen()).toBe(true);
  });

  it('an unavailable panel has no rail button, and with no panel there is no side at all', () => {
    const { hostContainer, sidePanel, toggleElement, isOpen } = setup();
    sidePanel.setDefault(true);
    sidePanel.setAvailable(false);
    expect(toggleElement.hidden).toBe(true);
    expect(isOpen()).toBe(false);
    expect(hostContainer.querySelector<HTMLElement>('.d-workbench__side--left')!.hidden).toBe(true);
    expect(hostContainer.querySelector<HTMLElement>('.d-workbench__side--right')!.hidden).toBe(true);
  });

  it("a right panel goes on the right rail; one panel per side shows: the viewer's pick, else the side's default", () => {
    const { hostContainer, layout, sidePanel, isOpen, right } = setup();
    sidePanel.setDefault(true);
    const inspector = right();
    const details = right('details', 'Details');
    const rail = (side: string) => [...hostContainer.querySelectorAll<HTMLElement>(`.d-workbench__side--${side} .d-workbench__rail-button`)].map((buttonElement) => buttonElement.title);
    expect(rail('left')).toEqual(['Dashboards']);
    expect(rail('right')).toEqual(['Inspector', 'Details']);
    expect(hostContainer.querySelector<HTMLElement>('.d-workbench__side--right')!.hidden).toBe(false);
    // no default named, none asked for: the right side is only its rail
    expect([inspector.bodyContainer.hidden, details.bodyContainer.hidden]).toEqual([true, true]);
    expect(hostContainer.style.getPropertyValue('--d-workbench-right-side')).toBe('');
    layout.setDefaultPanel('right', 'inspector');
    expect(inspector.bodyContainer.hidden).toBe(false);
    expect(hostContainer.style.getPropertyValue('--d-workbench-right-side')).toBe('minmax(0, 50%)');
    hostContainer.querySelector<HTMLElement>('[data-testid=wb-panel-toggle-details]')!.click();
    expect([inspector.bodyContainer.hidden, details.bodyContainer.hidden]).toEqual([true, false]);
    expect(isOpen()).toBe(true); // the left side is apart
  });

  it("clicking the shown panel's rail button hides its side (the content takes the room), remembered over the default", () => {
    const { hostContainer, layout, key, right } = setup();
    const inspector = right();
    layout.setDefaultPanel('right', 'inspector');
    const toggleElement = hostContainer.querySelector<HTMLElement>('[data-testid=wb-panel-toggle-inspector]')!;
    toggleElement.click();
    expect(inspector.bodyContainer.hidden).toBe(true);
    expect(toggleElement.getAttribute('aria-pressed')).toBe('false');
    expect(hostContainer.style.getPropertyValue('--d-workbench-right-side')).toBe('');
    const next = setup({ key });
    const again = next.right();
    next.layout.setDefaultPanel('right', 'inspector');
    expect(again.bodyContainer.hidden).toBe(true);
  });

  it('a default of null starts the side hidden; a default not registered falls back to the panel asking for it', () => {
    const { layout, right } = setup();
    const inspector = right();
    inspector.setDefault(true);
    layout.setDefaultPanel('right', null);
    expect(inspector.bodyContainer.hidden).toBe(true);
    layout.setDefaultPanel('right', 'details');
    expect(inspector.bodyContainer.hidden).toBe(false);
  });

  it('refuses a panel id used on the other side', () => {
    const { right } = setup();
    expect(() => right('dashboards')).toThrow(/already/);
  });

  it("the right separator sets the right side's share of the workbench (keys: the edge moves with the arrow), 20–80%, remembered", () => {
    const { hostContainer, layout, key, right } = setup();
    right();
    layout.setDefaultPanel('right', 'inspector');
    const splitElement = hostContainer.querySelector<HTMLElement>('.d-workbench__side--right [role=separator]')!;
    expect(splitElement.getAttribute('aria-label')).toBe('Right panel width');
    expect(splitElement.tabIndex).toBe(0);
    splitElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(hostContainer.style.getPropertyValue('--d-workbench-right-side')).toBe('minmax(0, 55%)');
    for (let i = 0; i < 20; i++) splitElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(hostContainer.style.getPropertyValue('--d-workbench-right-side')).toBe('minmax(0, 20%)');
    expect(splitElement.getAttribute('aria-valuenow')).toBe('20');
    expect(JSON.parse(sessionStorage.getItem(`${key}:layout`)!).right.size).toBe(20);
    const next = setup({ key });
    next.right();
    next.layout.setDefaultPanel('right', 'inspector');
    expect(next.hostContainer.style.getPropertyValue('--d-workbench-right-side')).toBe('minmax(0, 20%)');
  });

  it('ignores a remembered layout of another shape', () => {
    const key = `test-${Math.random()}`;
    sessionStorage.setItem(`${key}:layout`, JSON.stringify({ width: 'wide', left: { size: 'x', chosen: 3 } }));
    const { panelContainer, sidePanel, isOpen } = setup({ key });
    sidePanel.setDefault(true);
    expect(isOpen()).toBe(true);
    expect(panelContainer.style.width).toBe('300px');
  });

  it('the left separator changes the width (keys), within bounds, remembered', () => {
    const { hostContainer, sidePanel, panelContainer, key } = setup();
    sidePanel.setDefault(true);
    const separatorElement = hostContainer.querySelector<HTMLElement>('.d-workbench__side--left [role=separator]')!;
    expect(separatorElement.getAttribute('aria-label')).toBe('Left panel width');
    expect(panelContainer.style.width).toBe('300px');
    separatorElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(panelContainer.style.width).toBe('316px');
    for (let i = 0; i < 40; i++) separatorElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(panelContainer.style.width).toBe('200px');
    expect(separatorElement.getAttribute('aria-valuenow')).toBe('200');
    expect(JSON.parse(sessionStorage.getItem(`${key}:layout`)!).left.size).toBe(200);
  });

  it('when narrow, the left panel starts closed and is an overlay that closes on dismiss, Escape or a click outside', () => {
    const { hostContainer, layout, sidePanel, toggleElement, setWidth, isOpen } = setup({ observe: true });
    sidePanel.setDefault(true);
    setWidth(600);
    expect(hostContainer.classList.contains('d-workbench--narrow')).toBe(true);
    expect(isOpen()).toBe(false);
    toggleElement.click();
    expect(isOpen()).toBe(true);
    sidePanel.dismiss();
    expect(isOpen()).toBe(false);
    toggleElement.click();
    hostContainer.querySelector('.d-workbench__panel-body')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(isOpen()).toBe(false);
    toggleElement.click();
    hostContainer.querySelector('.d-workbench__panel-body')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(isOpen()).toBe(true);
    layout.contentContainer.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(isOpen()).toBe(false);
    setWidth(1200);
    expect(isOpen()).toBe(true);
  });

  it('tells whether a panel is visible: shown, open as the narrow overlay, not when removed or another one shows', () => {
    const { layout, sidePanel, toggleElement, setWidth, right } = setup({ observe: true });
    const changes: boolean[] = [];
    sidePanel.onDidChangeVisibility(() => changes.push(sidePanel.visible));
    expect(sidePanel.visible).toBe(false);
    sidePanel.setDefault(true);
    toggleElement.click();
    toggleElement.click();
    expect(changes).toEqual([true, false, true]);

    setWidth(600);
    toggleElement.click();
    expect(sidePanel.visible).toBe(true);
    sidePanel.dismiss();
    sidePanel.setAvailable(false);
    toggleElement.click();
    expect(changes).toEqual([true, false, true, false, true, false]);
    setWidth(1200);
    expect(sidePanel.visible).toBe(false);
    sidePanel.setAvailable(true);
    expect(changes.at(-1)).toBe(true);

    const inspector = right();
    const details = right('details', 'Details');
    const detailsChanges: boolean[] = [];
    details.onDidChangeVisibility(() => detailsChanges.push(details.visible));
    layout.setDefaultPanel('right', 'details');
    expect([inspector.visible, details.visible]).toEqual([false, true]);
    layout.setDefaultPanel('right', 'inspector');
    expect([inspector.visible, details.visible]).toEqual([true, false]);
    expect(detailsChanges).toEqual([true, false]);
  });

  it('show() picks the panel as the rail would and focuses its first control, unless asked to keep the focus', () => {
    const { hostContainer, layout, sidePanel, bodyContainer, isOpen } = setup();
    const fieldElement = bodyContainer.appendChild(document.createElement('input'));
    sidePanel.show(true);
    expect(isOpen()).toBe(true);
    expect(document.activeElement).not.toBe(fieldElement);
    sidePanel.show();
    expect(document.activeElement).toBe(fieldElement);
    // an element marked autofocus before the first control
    const queryElement = bodyContainer.appendChild(document.createElement('input'));
    queryElement.autofocus = true;
    sidePanel.show();
    expect(document.activeElement).toBe(queryElement);
    // a panel with nothing to focus gets the focus itself
    const inspector = layout.addSidePanel('inspector', { label: 'Inspector', icon: '<svg></svg>', side: 'right' });
    inspector.show();
    expect(document.activeElement).toBe(inspector.bodyContainer);
    expect(hostContainer.querySelector('[data-testid=wb-panel-toggle-inspector]')!.getAttribute('aria-pressed')).toBe('true');
    sidePanel.setAvailable(false);
    sidePanel.show();
    expect(sidePanel.visible).toBe(false);
  });

  it("workbench.view.<id> shows and focuses the panel, or hides it when it has the focus (the focus back where it was), until disposed", async () => {
    const { layout, commands, sidePanel, bodyContainer, isOpen } = setup();
    const fieldElement = bodyContainer.appendChild(document.createElement('input'));
    const inputElement = layout.contentContainer.appendChild(document.createElement('textarea'));
    inputElement.focus();
    await commands.executeCommand('workbench.view.dashboards');
    expect([isOpen(), document.activeElement]).toEqual([true, fieldElement]);
    await commands.executeCommand('workbench.view.dashboards');
    expect([isOpen(), document.activeElement]).toEqual([false, inputElement]);
    // shown but the focus elsewhere: focused, not hidden
    sidePanel.show(true);
    await commands.executeCommand('workbench.view.dashboards');
    expect([isOpen(), document.activeElement]).toEqual([true, fieldElement]);
    sidePanel.dispose();
    await expect(commands.executeCommand('workbench.view.dashboards')).rejects.toThrow(/No command/);
  });

  it("names the key of workbench.view.<id> in the rail button's tooltip, also one bound after the panel was added", () => {
    const { commands, toggleElement } = setup();
    expect(toggleElement.title).toBe('Dashboards');
    commands.declareKeybindings([{ key: 'Alt+Digit1', command: 'workbench.view.dashboards' }]);
    toggleElement.dispatchEvent(new Event('pointerenter'));
    expect(toggleElement.title).toBe('Dashboards (Alt+1)');
    expect(toggleElement.getAttribute('aria-label')).toBe('Dashboards');
  });

  it('shows the shown panel under a header with its name and "…", which shows its menu with "Hide"', async () => {
    const { hostContainer, layout, commands, menus, shownMenus, sidePanel, isOpen } = setup();
    const header = (id: string) => hostContainer.querySelector<HTMLElement>(`[data-testid=wb-panel-header-${id}]`)!;
    const debug = layout.addSidePanel('debug', { label: 'Debug', icon: '<svg></svg>' });
    sidePanel.show();
    expect([header('dashboards').hidden, header('debug').hidden]).toEqual([false, true]);
    expect(header('dashboards').querySelector('h2')!.textContent).toBe('Dashboards');
    expect(sidePanel.bodyContainer.getAttribute('aria-labelledby')).toBe(header('dashboards').querySelector('h2')!.id);
    const moreButtonElement = header('dashboards').querySelector<HTMLButtonElement>('button[aria-label="Dashboards actions"]')!;
    moreButtonElement.click();
    expect(shownMenus).toEqual([['panel/dashboards', { anchor: moreButtonElement, title: 'Dashboards' }]]);
    const [hide] = menus.items('panel/dashboards');
    expect([hide.title, hide.command]).toEqual(['Hide', 'workbench.view.dashboards.hide']);
    // "Hide" closes the side while it shows the panel, else nothing
    debug.show();
    await commands.executeCommand(hide.command);
    expect(debug.visible).toBe(true);
    sidePanel.show();
    await commands.executeCommand(hide.command);
    expect(isOpen()).toBe(false);
    sidePanel.dispose();
    expect([header('dashboards'), menus.items('panel/dashboards')]).toEqual([null, []]);
  });

  it('puts a command button into the rail among the panels by order, runs its command, names its key, until disposed', async () => {
    const { hostContainer, layout, commands } = setup();
    const ran: string[] = [];
    commands.registerCommand('test.search', () => ran.push('search'));
    commands.declareKeybindings([{ key: 'Mod+KeyK', command: 'test.search' }]);
    const search = layout.addRailButton('search', { label: 'Search everywhere', icon: '<svg></svg>', command: 'test.search', order: -1 });
    const rail = () => [...hostContainer.querySelectorAll<HTMLButtonElement>('.d-workbench__side--left .d-workbench__rail-button')].map((railButtonElement) => railButtonElement.getAttribute('aria-label'));
    expect(rail()).toEqual(['Search everywhere', 'Dashboards']);
    const buttonElement = hostContainer.querySelector<HTMLButtonElement>('[data-testid=wb-rail-button-search]')!;
    expect([buttonElement.title, buttonElement.hasAttribute('aria-pressed')]).toEqual(['Search everywhere (Ctrl+K)', false]);
    buttonElement.click();
    await Promise.resolve();
    expect(ran).toEqual(['search']);
    search.dispose();
    expect(rail()).toEqual(['Dashboards']);
  });

  it("greys a command button while its command cannot run, its tooltip saying why, asked again on hover; a click then runs nothing", async () => {
    const { hostContainer, layout, commands } = setup();
    const ran: string[] = [];
    let enabled = false;
    commands.registerCommand('test.search', () => ran.push('search'), { enablement: () => enabled, disabledReason: 'Nothing to search' });
    layout.addRailButton('search', { label: 'Search everywhere', icon: '<svg></svg>', command: 'test.search' });
    const buttonElement = hostContainer.querySelector<HTMLButtonElement>('[data-testid=wb-rail-button-search]')!;
    expect([buttonElement.getAttribute('aria-disabled'), buttonElement.title]).toEqual(['true', 'Search everywhere: Nothing to search']);
    buttonElement.click();
    await Promise.resolve();
    expect(ran).toEqual([]);
    enabled = true;
    buttonElement.dispatchEvent(new Event('pointerenter'));
    expect([buttonElement.hasAttribute('aria-disabled'), buttonElement.title]).toEqual([false, 'Search everywhere']);
    buttonElement.click();
    await Promise.resolve();
    expect(ran).toEqual(['search']);
  });

  it('shows a side that has only a command button', () => {
    const { hostContainer, layout } = setup();
    const rightContainer = hostContainer.querySelector<HTMLElement>('.d-workbench__side--right')!;
    expect(rightContainer.hidden).toBe(true);
    const button = layout.addRailButton('help', { label: 'Help', icon: '<svg></svg>', command: 'test.help', side: 'right' });
    expect(rightContainer.hidden).toBe(false);
    button.dispose();
    expect(rightContainer.hidden).toBe(true);
  });

  it('when narrow, the right side stays beside the content', () => {
    const { layout, setWidth, right } = setup({ observe: true });
    const inspector = right();
    layout.setDefaultPanel('right', 'inspector');
    setWidth(600);
    expect(inspector.bodyContainer.hidden).toBe(false);
    layout.contentContainer.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(inspector.bodyContainer.hidden).toBe(false);
  });
});
