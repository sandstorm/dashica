// @vitest-environment jsdom
// Tests for quick-input.ts (createQuickPick).
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
  return { host, button, quickInput, key, type, field };
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
