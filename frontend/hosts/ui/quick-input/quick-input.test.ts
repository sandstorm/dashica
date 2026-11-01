// @vitest-environment jsdom
// Tests for quick-input.ts (createQuickPick, showQuickPick also with items still to come, showInputBox with its validation message and selection, and
// with a field of the caller's; both with `accept`, open and busy while it runs, its error in the message line).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import { InputBoxValidationSeverity, QuickPickItemKind, type InputBoxField } from '../ui';
import { QuickInput } from './quick-input';

afterEach(() => document.body.replaceChildren());

/** The texts of the elements `targetElement` is described by (`aria-describedby`), in its order, the empty ones left out. */
function described(hostContainer: HTMLElement, targetElement: Element): string {
  const texts = (targetElement.getAttribute('aria-describedby') ?? '').split(' ').map((id) => hostContainer.querySelector(`#${id}`)!.textContent);
  return texts.filter((text) => text !== '').join(' ');
}

function setup() {
  const hostContainer = document.body.appendChild(document.createElement('div'));
  const buttonElement = hostContainer.appendChild(document.createElement('button'));
  const quickInput = new QuickInput(hostContainer);
  const key = (targetElement: Element, key: string) => targetElement.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  const type = (inputElement: HTMLInputElement, value: string) => {
    inputElement.value = value;
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const field = () => hostContainer.querySelector<HTMLInputElement>('.d-workbench__quick-pick input')!;
  const options = () => [...hostContainer.querySelectorAll<HTMLElement>('[role=option]')];
  const box = () => hostContainer.querySelector<HTMLElement>('.d-workbench__quick-pick');
  return { hostContainer, buttonElement, quickInput, key, type, field, options, box };
}

describe('createQuickPick', () => {
  it('shows the items its owner sets (headings, marks, keys), tells the text and the item picked, and stays until hidden', () => {
    const { hostContainer, buttonElement, quickInput, key, type, field } = setup();
    buttonElement.focus();
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
    expect([document.activeElement, field().getAttribute('aria-label'), hostContainer.querySelector('.d-workbench__quick-pick-hint')!.textContent]).toEqual([field(), 'Search everywhere', 'Narrow with > Commands']);
    type(field(), 'shop');
    expect(values).toEqual(['a', 'shop']);
    expect(hostContainer.querySelector('.d-workbench__quick-pick-heading')!.textContent).toBe('Dashboards 2 more');
    expect([hostContainer.querySelector('[role=option]')!.textContent, hostContainer.querySelector('mark')!.textContent]).toEqual(['shop overview ⌘K', 'shop']);
    pick.busy = true;
    expect(hostContainer.querySelector<HTMLElement>('.d-workbench__quick-pick-progress')!.hidden).toBe(false);
    key(field(), 'Enter');
    expect([accepted, hidden, hostContainer.querySelector('.d-workbench__quick-pick') !== null]).toEqual([['shop overview'], 0, true]);
    pick.hide();
    expect([hidden, hostContainer.querySelector('.d-workbench__quick-pick'), document.activeElement]).toEqual([1, null, buttonElement]);
    pick.show();
    key(field(), 'Escape');
    expect(hidden).toBe(2);
  });

  it('says whether an item was picked with Cmd / Ctrl (Enter, a click): for a new tab', () => {
    const { hostContainer, quickInput, field } = setup();
    const pick = quickInput.createQuickPick<{ label: string }>();
    const accepted: boolean[] = [];
    pick.onDidAccept(({ newTab }) => accepted.push(newTab));
    pick.items = [{ label: 'Shop' }];
    pick.show();
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }));
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    hostContainer.querySelector<HTMLElement>('[role=option]')!.dispatchEvent(new MouseEvent('click', { ctrlKey: true, bubbles: true }));
    expect(accepted).toEqual([true, false, true]);
  });

  it('moves the active item with the arrow keys, picks with a click, and says "No results" for text without items', () => {
    const { hostContainer, quickInput, key, type, field } = setup();
    const pick = quickInput.createQuickPick<{ label: string }>();
    const accepted: string[] = [];
    pick.onDidAccept(() => accepted.push(pick.selectedItems[0].label));
    pick.items = [{ label: 'Shop' }, { label: 'Billing' }];
    pick.show();
    key(field(), 'ArrowDown');
    expect(hostContainer.querySelector('[aria-selected=true]')!.textContent).toBe('Billing');
    hostContainer.querySelector<HTMLElement>('[role=option]')!.click();
    expect(accepted).toEqual(['Shop']);
    pick.items = [];
    type(field(), 'zzz');
    pick.items = [];
    expect(hostContainer.querySelector<HTMLElement>('.d-workbench__quick-pick-empty')!.hidden).toBe(false);
  });

  it('hides on a press elsewhere, and an open box when another one shows', () => {
    const { hostContainer, quickInput } = setup();
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
    expect([...hostContainer.querySelectorAll('.d-workbench__quick-pick')].map((boxContainer) => boxContainer.getAttribute('aria-label'))).toEqual(['Second']);
  });

  it("gives each box's ids their own name: two quick picks on one page do not collide", () => {
    const picks = [setup(), setup()].map(({ hostContainer, quickInput, field }) => {
      const pick = quickInput.createQuickPick<{ label: string }>();
      pick.prompt = 'Narrow';
      pick.items = [{ label: 'Shop' }];
      pick.show();
      const listboxContainer = hostContainer.querySelector('[role=listbox]')!;
      expect([field().getAttribute('aria-controls'), field().getAttribute('aria-describedby')]).toEqual([listboxContainer.id, hostContainer.querySelector('.d-workbench__quick-pick-hint')!.id]);
      return [listboxContainer.id, field().getAttribute('aria-describedby'), hostContainer.querySelector('[role=option]')!.id];
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
    const { hostContainer, buttonElement, quickInput, key, type, field, options, box } = setup();
    buttonElement.focus();
    const picked = quickInput.showQuickPick([...ITEMS], { title: 'Filter', placeholder: 'Pick a filter', anchor: { x: 10, y: 20 } });
    expect([box()!.getAttribute('aria-label'), field().placeholder, document.activeElement]).toEqual(['Filter', 'Pick a filter', field()]);
    expect(box()!.classList.contains('d-workbench__quick-pick--anchored')).toBe(true);
    expect([box()!.style.left, box()!.style.top]).toEqual(['10px', '20px']);
    expect(options().map((optionElement) => optionElement.textContent)).toEqual([' status = 500', 'host = web-1 instance', '✓Copy link ⌘C']);
    expect(hostContainer.querySelector('[role=img]')!.getAttribute('aria-label')).toBe('Filter');
    expect(options()[2].getAttribute('aria-checked')).toBe('true');
    expect(hostContainer.querySelectorAll('.d-workbench__quick-pick-heading')).toHaveLength(1);
    type(field(), 'web');
    expect([options().map((optionElement) => optionElement.textContent), hostContainer.querySelector('mark')!.textContent]).toEqual([['host = web-1 instance'], 'web']);
    expect(hostContainer.querySelector('.d-workbench__quick-pick-heading')!.textContent).toBe('Filter');
    type(field(), 'instance');
    expect(hostContainer.querySelector('.d-workbench__quick-pick-description mark')!.textContent).toBe('instance');
    key(field(), 'Enter');
    expect(await picked).toBe(ITEMS[2]);
    expect([box(), document.activeElement]).toEqual([null, buttonElement]);
  });

  it('narrows by the label and the description read as one when neither alone matches, marking both', async () => {
    const { hostContainer, quickInput, type, field, options } = setup();
    void quickInput.showQuickPick([
      { label: 'Orders', description: 'Oekokiste overview' },
      { label: 'Orders', description: 'Shop' },
    ]);
    type(field(), 'orders oekokiste');
    expect(options().map((optionElement) => optionElement.textContent)).toEqual(['Orders Oekokiste overview']);
    expect([...hostContainer.querySelectorAll('mark')].map((markElement) => markElement.textContent)).toEqual(['Orders', 'Oekokiste']);
  });

  it('opens below an element, and resolves with undefined on Escape, a press elsewhere or another box', async () => {
    const { buttonElement, quickInput, key, field, box } = setup();
    buttonElement.getBoundingClientRect = () => ({ left: 5, bottom: 7 }) as DOMRect;
    const escaped = quickInput.showQuickPick([{ label: 'Shop' }], { anchor: buttonElement });
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

  it('opens at once for items still to come, busy and without "No results" until they are there, then shows them as typed so far', async () => {
    const { quickInput, type, field, options, box } = setup();
    let answer!: (items: { label: string }[]) => void;
    const picked = quickInput.showQuickPick(new Promise<{ label: string }[]>((resolve) => (answer = resolve)), { title: 'Add filter' });
    const progress = () => box()!.querySelector<HTMLElement>('.d-workbench__quick-pick-progress')!;
    const empty = () => box()!.querySelector<HTMLElement>('.d-workbench__quick-pick-empty')!;
    type(field(), 'sta');
    expect([box()!.getAttribute('aria-label'), progress().hidden, empty().hidden, options()]).toEqual(['Add filter', false, true, []]);
    answer([{ label: 'status' }, { label: 'host' }]);
    await vi.waitFor(() => expect(progress().hidden).toBe(true));
    expect(options().map((optionElement) => optionElement.textContent)).toEqual(['status']);
    options()[0].click();
    expect((await picked)?.label).toBe('status');
  });

  it('hides and rejects with the error of items that fail; ignores items that come after it was hidden', async () => {
    const { quickInput, key, field, box } = setup();
    const failed = quickInput.showQuickPick(Promise.reject(new Error('502: unreachable')));
    await expect(failed).rejects.toThrow('502: unreachable');
    expect(box()).toBeNull();
    let answer!: (items: { label: string }[]) => void;
    const escaped = quickInput.showQuickPick(new Promise<{ label: string }[]>((resolve) => (answer = resolve)));
    key(field(), 'Escape');
    expect(await escaped).toBeUndefined();
    answer([{ label: 'Shop' }]);
    await Promise.resolve();
    expect(box()).toBeNull();
  });

  it('hides a menu whose items still to come turn out none, resolving with nothing', async () => {
    const { quickInput, box } = setup();
    let answer!: (items: { label: string }[]) => void;
    const picked = quickInput.showQuickPick(new Promise<{ label: string }[]>((resolve) => (answer = resolve)), { title: 'Data point', menu: true });
    expect(box()).not.toBeNull();
    answer([]);
    expect(await picked).toBeUndefined();
    expect(box()).toBeNull();
  });

  it('stays open and busy while `accept` runs; shows its error and lets the viewer choose again; resolves once it succeeded', async () => {
    const { hostContainer, quickInput, key, field, options, box } = setup();
    const tries: { label: string; settle: (ok: boolean) => void }[] = [];
    const picked = quickInput.showQuickPick([{ label: 'status = 500' }, { label: 'status ≠ 500' }], {
      title: 'Filter',
      accept: (item) => new Promise((resolve, reject) => tries.push({ label: item.label, settle: (ok) => (ok ? resolve(undefined) : reject(new Error('422: cannot filter'))) })),
    });
    const progress = () => hostContainer.querySelector<HTMLElement>('.d-workbench__quick-pick-progress')!;
    const message = () => hostContainer.querySelector<HTMLElement>('.d-workbench__quick-pick-message')!;
    key(field(), 'Enter');
    key(field(), 'Enter');
    expect([tries.map((t) => t.label), progress().hidden, box() !== null]).toEqual([['status = 500'], false, true]);
    tries[0].settle(false);
    await vi.waitFor(() => expect(message().textContent).toBe('422: cannot filter'));
    expect([message().hidden, progress().hidden, box() !== null]).toEqual([false, true, true]);
    options()[1].click();
    expect(message().hidden).toBe(true);
    tries[1].settle(true);
    expect(await picked).toEqual({ label: 'status ≠ 500' });
    expect(box()).toBeNull();
  });

  it('calls pickOne\'s `done` while the click is still going on, the box gone and the focus back', () => {
    const { buttonElement, quickInput, options, box } = setup();
    buttonElement.focus();
    const done: [string | undefined, boolean, boolean][] = [];
    quickInput.pickOne([{ label: 'Shop' }], {}, (item) => done.push([item?.label, box() === null, document.activeElement === buttonElement]));
    options()[0].click();
    expect(done).toEqual([['Shop', true, true]]);
  });
});

describe('a menu (menu)', () => {
  const ENTRIES = [{ label: 'Open in new tab' }, { label: 'Copy link' }, { label: 'Close' }, { label: 'Close others' }];
  const concealed = (fieldElement: HTMLInputElement) => fieldElement.classList.contains('d-workbench__quick-pick-field--concealed');
  const active = (hostContainer: HTMLElement) => hostContainer.querySelector('[aria-selected=true]')!.textContent;

  it('shows a plain list, its field out of sight but focused, so that the arrow keys and Enter work at once', async () => {
    const { hostContainer, buttonElement, quickInput, key, field, box } = setup();
    const picked = quickInput.showQuickPick(ENTRIES, { anchor: buttonElement, menu: true });
    expect([concealed(field()), document.activeElement, box()!.classList.contains('d-workbench__quick-pick--menu')]).toEqual([true, field(), true]);
    key(field(), 'ArrowDown');
    expect(active(hostContainer)).toBe('Copy link');
    key(field(), 'Enter');
    expect((await picked)?.label).toBe('Copy link');
  });

  it('jumps to the first entry starting with a first letter typed; a further letter shows the field and narrows', () => {
    const { hostContainer, quickInput, type, field, options } = setup();
    void quickInput.showQuickPick(ENTRIES, { menu: true });
    type(field(), 'c');
    expect([concealed(field()), options().length, active(hostContainer)]).toEqual([true, 4, 'Copy link']);
    type(field(), 'x');
    expect([concealed(field()), options().length, active(hostContainer)]).toEqual([true, 4, 'Copy link']);
    type(field(), 'clo');
    expect([concealed(field()), options().map((optionElement) => optionElement.textContent)]).toEqual([false, ['Close', 'Close others']]);
  });

  it('marks the element it opened from expanded until it is dismissed or an entry chosen', async () => {
    const { buttonElement, quickInput, key, field, options } = setup();
    void quickInput.showQuickPick(ENTRIES, { anchor: buttonElement, menu: true });
    expect(buttonElement.getAttribute('aria-expanded')).toBe('true');
    key(field(), 'Escape');
    expect(buttonElement.getAttribute('aria-expanded')).toBe('false');
    const picked = quickInput.showQuickPick(ENTRIES, { anchor: buttonElement, menu: true });
    expect(buttonElement.getAttribute('aria-expanded')).toBe('true');
    options()[0].click();
    await picked;
    expect(buttonElement.getAttribute('aria-expanded')).toBe('false');
  });

  it('is a picker otherwise: the field in sight from the start, the opener left as it is', () => {
    const { buttonElement, quickInput, type, field, options } = setup();
    void quickInput.showQuickPick(ENTRIES, { anchor: buttonElement });
    expect([concealed(field()), buttonElement.hasAttribute('aria-expanded')]).toEqual([false, false]);
    type(field(), 'c');
    expect(options().length).toBe(4 - 1);
  });
});

describe('showInputBox', () => {
  it('asks for a text (its value, prompt, placeholder) and resolves with it on Enter, the focus back', async () => {
    const { hostContainer, buttonElement, quickInput, key, type, field, box } = setup();
    buttonElement.focus();
    const asked = quickInput.showInputBox({ title: 'Parameter value', prompt: 'Replaces the ... of the filter', placeholder: '/api/', value: '/a', anchor: { x: 1, y: 2 } });
    expect([box()!.getAttribute('aria-label'), field().value, field().placeholder, document.activeElement]).toEqual(['Parameter value', '/a', '/api/', field()]);
    expect(described(hostContainer, field())).toBe('Replaces the ... of the filter');
    expect([field().selectionStart, field().selectionEnd]).toEqual([0, 2]);
    type(field(), '/api/');
    key(field(), 'Enter');
    expect(await asked).toBe('/api/');
    expect([box(), document.activeElement]).toEqual([null, buttonElement]);
  });

  it('selects the part of the value `valueSelection` says', () => {
    const { quickInput, field } = setup();
    void quickInput.showInputBox({ value: 'report.csv', valueSelection: [0, 6] });
    expect([field().selectionStart, field().selectionEnd]).toEqual([0, 6]);
  });

  it('shows what validateInput says below the field, at once and as the text is typed; an error keeps Enter from taking the text, an info does not', async () => {
    const { hostContainer, quickInput, key, type, field, box } = setup();
    const asked = quickInput.showInputBox({
      prompt: 'Path',
      validateInput: (value) =>
        value === '' ? { message: 'Enter a value.', severity: InputBoxValidationSeverity.Error } : { message: `path = '${value}'`, severity: InputBoxValidationSeverity.Info },
    });
    const message = () => hostContainer.querySelector<HTMLElement>('.d-workbench__quick-pick-message')!;
    const shown = () => [message().hidden ? null : message().textContent, message().classList.contains('d-workbench__quick-pick-message--error'), field().getAttribute('aria-invalid')];
    expect(shown()).toEqual(['Enter a value.', true, 'true']);
    expect(described(hostContainer, field())).toBe('Enter a value. Path');
    key(field(), 'Enter');
    expect(box()).not.toBeNull();
    type(field(), '/a');
    expect(shown()).toEqual(["path = '/a'", false, null]);
    key(field(), 'Enter');
    expect(await asked).toBe('/a');
  });

  it('shows no message while validateInput says nothing', () => {
    const { hostContainer, quickInput, type, field } = setup();
    void quickInput.showInputBox({ validateInput: (value) => (value === 'x' ? { message: 'Not x.', severity: InputBoxValidationSeverity.Error } : undefined) });
    const messageElement = hostContainer.querySelector<HTMLElement>('.d-workbench__quick-pick-message')!;
    expect(messageElement.hidden).toBe(true);
    type(field(), 'x');
    expect(messageElement.hidden).toBe(false);
    type(field(), 'xy');
    expect([messageElement.hidden, field().hasAttribute('aria-invalid')]).toEqual([true, false]);
  });

  it('resolves with undefined on Escape', async () => {
    const { quickInput, key, field } = setup();
    const asked = quickInput.showInputBox();
    key(field(), 'Escape');
    expect(await asked).toBeUndefined();
  });

  it('stays open and busy while `accept` runs on Enter, shows its error below the field, resolves once it succeeded', async () => {
    const { hostContainer, quickInput, key, type, field, box } = setup();
    let refuse = true;
    const accepted: string[] = [];
    const asked = quickInput.showInputBox({
      accept: async (value) => {
        accepted.push(value);
        if (refuse) throw new Error('400: needs a value');
      },
    });
    const message = () => hostContainer.querySelector<HTMLElement>('.d-workbench__quick-pick-message')!;
    type(field(), 'x');
    key(field(), 'Enter');
    expect(hostContainer.querySelector<HTMLElement>('.d-workbench__quick-pick-progress')!.hidden).toBe(false);
    await vi.waitFor(() => expect(message().textContent).toBe('400: needs a value'));
    expect([message().classList.contains('d-workbench__quick-pick-message--error'), field().getAttribute('aria-invalid'), box() !== null]).toEqual([true, 'true', true]);
    refuse = false;
    type(field(), 'y');
    key(field(), 'Enter');
    expect(await asked).toBe('y');
    expect(accepted).toEqual(['x', 'y']);
  });

  /** A field of the caller's: a text area as its input, its events fired by the test, the selection asked kept. */
  function callerField(text: string) {
    const inputElement = document.createElement('textarea');
    inputElement.value = text;
    const changed = new EventEmitter<void>();
    const accepted = new EventEmitter<void>();
    const selected: [number, number][] = [];
    const field: InputBoxField = {
      fieldElement: Object.assign(document.createElement('div'), { className: 'caller-field' }),
      inputElement,
      get value() {
        return inputElement.value;
      },
      select: (start, end) => void selected.push([start, end]),
      focus: () => inputElement.focus(),
      onDidChangeValue: changed.event,
      onDidAccept: accepted.event,
    };
    field.fieldElement.append(inputElement);
    return { field, inputElement, changed, accepted, selected };
  }

  it('shows a field of the caller’s in place of its own: focused, named and described, its text selected, checked on each change, taken when it accepts', async () => {
    const { hostContainer, buttonElement, quickInput, box } = setup();
    buttonElement.focus();
    const { field, inputElement, changed, accepted, selected } = callerField('a = 1');
    const asked = quickInput.showInputBox({ title: 'SQL condition', prompt: 'Added to the WHERE', field, validateInput: (value) => (value === '' ? { message: 'Enter a condition.', severity: InputBoxValidationSeverity.Error } : undefined) });
    expect(box()!.querySelector('.caller-field')).toBe(field.fieldElement);
    expect(box()!.querySelector('input')).toBeNull();
    expect([document.activeElement, inputElement.getAttribute('aria-label'), described(hostContainer, inputElement)]).toEqual([inputElement, 'SQL condition', 'Added to the WHERE']);
    expect(selected).toEqual([[0, 5]]);
    inputElement.value = '';
    changed.fire();
    expect(inputElement.getAttribute('aria-invalid')).toBe('true');
    accepted.fire();
    expect(box()).not.toBeNull();
    inputElement.value = 'a = 2';
    changed.fire();
    accepted.fire();
    expect(await asked).toBe('a = 2');
    expect([box(), document.activeElement]).toEqual([null, buttonElement]);
  });

  it('leaves an Escape the caller’s field took itself (its completion closing), and hides on any other', async () => {
    const { quickInput, key, box } = setup();
    const { field, inputElement } = callerField('x');
    const asked = quickInput.showInputBox({ field });
    inputElement.addEventListener('keydown', (event) => event.preventDefault(), { once: true });
    key(inputElement, 'Escape');
    expect(box()).not.toBeNull();
    key(inputElement, 'Escape');
    expect(await asked).toBeUndefined();
  });
});
