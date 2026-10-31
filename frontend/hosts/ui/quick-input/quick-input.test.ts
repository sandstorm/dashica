// @vitest-environment jsdom
// Tests for quick-input.ts (createQuickPick, showQuickPick, showInputBox).
import { afterEach, describe, expect, it } from 'vitest';
import { QuickPickItemKind } from '../ui';
import { QuickInput } from './quick-input';

afterEach(() => document.body.replaceChildren());

function setup() {
  const host = document.body.appendChild(document.createElement('div'));
  const button = host.appendChild(document.createElement('button'));
  const quickInput = new QuickInput(host);
  const key = (target: Element, key: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  const type = (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const field = () => host.querySelector<HTMLInputElement>('.d-workbench__quick-pick input')!;
  const options = () => [...host.querySelectorAll<HTMLElement>('[role=option]')];
  const box = () => host.querySelector<HTMLElement>('.d-workbench__quick-pick');
  return { host, button, quickInput, key, type, field, options, box };
}

describe('createQuickPick', () => {
  it('shows the items its owner sets (headings, marks, keys), tells the text and the item picked, and stays until hidden', () => {
    const { host, button, quickInput, key, type, field } = setup();
    button.focus();
    const pick = quickInput.createQuickPick<{ label: string; keybinding?: string; highlights?: { label: [number, number][] } }>();
    pick.title = 'Search everywhere';
    pick.prompt = 'Narrow with > Commands';
    const values: string[] = [];
    const accepted: string[] = [];
    let hidden = 0;
    pick.onDidChangeValue((value) => {
      values.push(value);
      pick.items = [{ kind: QuickPickItemKind.Separator, label: 'Dashboards', description: '2 more' }, { label: `${value} overview`, keybinding: '⌘K', highlights: { label: [[0, value.length]] } }];
    });
    pick.onDidAccept(() => accepted.push(pick.selectedItems[0].label));
    pick.onDidHide(() => hidden++);
    pick.show();
    pick.value = 'a';
    expect([document.activeElement, field().getAttribute('aria-label'), host.querySelector('.d-workbench__quick-pick-hint')!.textContent]).toEqual([field(), 'Search everywhere', 'Narrow with > Commands']);
    type(field(), 'shop');
    expect(values).toEqual(['a', 'shop']);
    expect(host.querySelector('.d-workbench__quick-pick-heading')!.textContent).toBe('Dashboards 2 more');
    expect([host.querySelector('[role=option]')!.textContent, host.querySelector('mark')!.textContent]).toEqual(['shop overview ⌘K', 'shop']);
    pick.busy = true;
    expect(host.querySelector<HTMLElement>('.d-workbench__quick-pick-progress')!.hidden).toBe(false);
    key(field(), 'Enter');
    expect([accepted, hidden, host.querySelector('.d-workbench__quick-pick') !== null]).toEqual([['shop overview'], 0, true]);
    pick.hide();
    expect([hidden, host.querySelector('.d-workbench__quick-pick'), document.activeElement]).toEqual([1, null, button]);
    pick.show();
    key(field(), 'Escape');
    expect(hidden).toBe(2);
  });

  it('says whether an item was picked with Cmd / Ctrl (Enter, a click): for a new tab', () => {
    const { host, quickInput, field } = setup();
    const pick = quickInput.createQuickPick<{ label: string }>();
    const accepted: boolean[] = [];
    pick.onDidAccept(({ newTab }) => accepted.push(newTab));
    pick.items = [{ label: 'Shop' }];
    pick.show();
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }));
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    host.querySelector<HTMLElement>('[role=option]')!.dispatchEvent(new MouseEvent('click', { ctrlKey: true, bubbles: true }));
    expect(accepted).toEqual([true, false, true]);
  });

  it('moves the active item with the arrow keys, picks with a click, and says "No results" for text without items', () => {
    const { host, quickInput, key, type, field } = setup();
    const pick = quickInput.createQuickPick<{ label: string }>();
    const accepted: string[] = [];
    pick.onDidAccept(() => accepted.push(pick.selectedItems[0].label));
    pick.items = [{ label: 'Shop' }, { label: 'Billing' }];
    pick.show();
    key(field(), 'ArrowDown');
    expect(host.querySelector('[aria-selected=true]')!.textContent).toBe('Billing');
    host.querySelector<HTMLElement>('[role=option]')!.click();
    expect(accepted).toEqual(['Shop']);
    pick.items = [];
    type(field(), 'zzz');
    pick.items = [];
    expect(host.querySelector<HTMLElement>('.d-workbench__quick-pick-empty')!.hidden).toBe(false);
  });

  it('hides on a press elsewhere, and an open box when another one shows', () => {
    const { host, quickInput } = setup();
    const first = quickInput.createQuickPick<{ label: string }>();
    const second = quickInput.createQuickPick<{ label: string }>();
    first.title = 'First';
    second.title = 'Second';
    let hidden = 0;
    first.onDidHide(() => hidden++);
    first.show();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(hidden).toBe(1);
    first.show();
    second.show();
    expect(hidden).toBe(2);
    expect([...host.querySelectorAll('.d-workbench__quick-pick')].map((box) => box.getAttribute('aria-label'))).toEqual(['Second']);
  });

  it("gives each box's ids their own name: two quick picks on one page do not collide", () => {
    const picks = [setup(), setup()].map(({ host, quickInput, field }) => {
      const pick = quickInput.createQuickPick<{ label: string }>();
      pick.prompt = 'Narrow';
      pick.items = [{ label: 'Shop' }];
      pick.show();
      const listbox = host.querySelector('[role=listbox]')!;
      expect([field().getAttribute('aria-controls'), field().getAttribute('aria-describedby')]).toEqual([listbox.id, host.querySelector('.d-workbench__quick-pick-hint')!.id]);
      return [listbox.id, field().getAttribute('aria-describedby'), host.querySelector('[role=option]')!.id];
    });
    const ids = picks.flat();
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('showQuickPick', () => {
  const ITEMS = [
    { kind: QuickPickItemKind.Separator, label: 'Filter' },
    { label: 'status = 500', icon: { svg: '<svg></svg>', label: 'Filter' } },
    { label: 'host = web-1', description: 'instance' },
    { kind: QuickPickItemKind.Separator },
    { label: 'Copy link', keybinding: '⌘C', checked: true },
  ] as const;

  it('shows the items at a point, narrows them as the viewer types (marked, headings with their items) and resolves with the one picked, the focus back', async () => {
    const { host, button, quickInput, key, type, field, options, box } = setup();
    button.focus();
    const picked = quickInput.showQuickPick([...ITEMS], { title: 'Filter', placeholder: 'Pick a filter', anchor: { x: 10, y: 20 } });
    expect([box()!.getAttribute('aria-label'), field().placeholder, document.activeElement]).toEqual(['Filter', 'Pick a filter', field()]);
    expect(box()!.classList.contains('d-workbench__quick-pick--anchored')).toBe(true);
    expect([box()!.style.left, box()!.style.top]).toEqual(['10px', '20px']);
    expect(options().map((option) => option.textContent)).toEqual([' status = 500', 'host = web-1 instance', '✓Copy link ⌘C']);
    expect(host.querySelector('[role=img]')!.getAttribute('aria-label')).toBe('Filter');
    expect(options()[2].getAttribute('aria-checked')).toBe('true');
    expect(host.querySelectorAll('.d-workbench__quick-pick-heading')).toHaveLength(1);
    type(field(), 'web');
    expect([options().map((option) => option.textContent), host.querySelector('mark')!.textContent]).toEqual([['host = web-1 instance'], 'web']);
    expect(host.querySelector('.d-workbench__quick-pick-heading')!.textContent).toBe('Filter');
    type(field(), 'instance');
    expect(host.querySelector('.d-workbench__quick-pick-description mark')!.textContent).toBe('instance');
    key(field(), 'Enter');
    expect(await picked).toBe(ITEMS[2]);
    expect([box(), document.activeElement]).toEqual([null, button]);
  });

  it('opens below an element, and resolves with undefined on Escape, a press elsewhere or another box', async () => {
    const { button, quickInput, key, field, box } = setup();
    button.getBoundingClientRect = () => ({ left: 5, bottom: 7 }) as DOMRect;
    const escaped = quickInput.showQuickPick([{ label: 'Shop' }], { anchor: button });
    expect([box()!.style.left, box()!.style.top]).toEqual(['5px', '7px']);
    key(field(), 'Escape');
    expect(await escaped).toBeUndefined();
    const pressed = quickInput.showQuickPick([{ label: 'Shop' }]);
    expect([box()!.classList.contains('d-workbench__quick-pick--anchored'), box()!.style.left]).toEqual([false, '']);
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(await pressed).toBeUndefined();
    const replaced = quickInput.showQuickPick([{ label: 'Shop' }]);
    void quickInput.showQuickPick([{ label: 'Billing' }]);
    expect(await replaced).toBeUndefined();
    quickInput.hide();
    expect(box()).toBeNull();
  });

  it('calls pickOne\'s `done` while the click is still going on, the box gone and the focus back', () => {
    const { button, quickInput, options, box } = setup();
    button.focus();
    const done: [string | undefined, boolean, boolean][] = [];
    quickInput.pickOne([{ label: 'Shop' }], {}, (item) => done.push([item?.label, box() === null, document.activeElement === button]));
    options()[0].click();
    expect(done).toEqual([['Shop', true, true]]);
  });
});

describe('a menu (menu)', () => {
  const ENTRIES = [{ label: 'Open in new tab' }, { label: 'Copy link' }, { label: 'Close' }, { label: 'Close others' }];
  const concealed = (field: HTMLInputElement) => field.classList.contains('d-workbench__quick-pick-field--concealed');
  const active = (host: HTMLElement) => host.querySelector('[aria-selected=true]')!.textContent;

  it('shows a plain list, its field out of sight but focused, so that the arrow keys and Enter work at once', async () => {
    const { host, button, quickInput, key, field, box } = setup();
    const picked = quickInput.showQuickPick(ENTRIES, { anchor: button, menu: true });
    expect([concealed(field()), document.activeElement, box()!.classList.contains('d-workbench__quick-pick--menu')]).toEqual([true, field(), true]);
    key(field(), 'ArrowDown');
    expect(active(host)).toBe('Copy link');
    key(field(), 'Enter');
    expect((await picked)?.label).toBe('Copy link');
  });

  it('jumps to the first entry starting with a first letter typed; a further letter shows the field and narrows', () => {
    const { host, quickInput, type, field, options } = setup();
    void quickInput.showQuickPick(ENTRIES, { menu: true });
    type(field(), 'c');
    expect([concealed(field()), options().length, active(host)]).toEqual([true, 4, 'Copy link']);
    type(field(), 'x');
    expect([concealed(field()), options().length, active(host)]).toEqual([true, 4, 'Copy link']);
    type(field(), 'clo');
    expect([concealed(field()), options().map((option) => option.textContent)]).toEqual([false, ['Close', 'Close others']]);
  });

  it('marks the element it opened from expanded until it is dismissed or an entry chosen', async () => {
    const { button, quickInput, key, field, options } = setup();
    void quickInput.showQuickPick(ENTRIES, { anchor: button, menu: true });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    key(field(), 'Escape');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    const picked = quickInput.showQuickPick(ENTRIES, { anchor: button, menu: true });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    options()[0].click();
    await picked;
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('is a picker otherwise: the field in sight from the start, the opener left as it is', () => {
    const { button, quickInput, type, field, options } = setup();
    void quickInput.showQuickPick(ENTRIES, { anchor: button });
    expect([concealed(field()), button.hasAttribute('aria-expanded')]).toEqual([false, false]);
    type(field(), 'c');
    expect(options().length).toBe(4 - 1);
  });
});

describe('showInputBox', () => {
  it('asks for a text (its value, prompt, placeholder) and resolves with it on Enter, the focus back', async () => {
    const { host, button, quickInput, key, type, field, box } = setup();
    button.focus();
    const asked = quickInput.showInputBox({ title: 'Parameter value', prompt: 'Replaces the ... of the filter', placeholder: '/api/', value: '/a', anchor: { x: 1, y: 2 } });
    expect([box()!.getAttribute('aria-label'), field().value, field().placeholder, document.activeElement]).toEqual(['Parameter value', '/a', '/api/', field()]);
    expect(host.querySelector(`#${field().getAttribute('aria-describedby')}`)!.textContent).toBe('Replaces the ... of the filter');
    type(field(), '/api/');
    key(field(), 'Enter');
    expect(await asked).toBe('/api/');
    expect([box(), document.activeElement]).toEqual([null, button]);
  });

  it('resolves with undefined on Escape', async () => {
    const { quickInput, key, field } = setup();
    const asked = quickInput.showInputBox();
    key(field(), 'Escape');
    expect(await asked).toBeUndefined();
  });
});
