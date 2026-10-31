// See UiApi in ../ui.ts.
import { html } from 'htl';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import { fuzzyMatch } from '../../../core/fuzzy/fuzzy';
import {
  type InputBoxOptions,
  type InputBoxValidationMessage,
  InputBoxValidationSeverity,
  type MenuAnchor,
  type QuickPick,
  type QuickPickAccept,
  type QuickPickHighlights,
  type QuickPickItem,
  QuickPickItemKind,
  type QuickPickOptions,
  type QuickPickSeparator,
} from '../ui';

/**
 * What `showQuickPick`, `showInputBox` and `createQuickPick` show: one box at a time over the workbench `host` (a new
 * one hides the open one), at its anchor (below an element, or at a point, kept inside the viewport) or at the top in
 * the middle; an input box's validation message below its field. Escape or a mouse press elsewhere hides it; hiding
 * gives the focus back to where it was. A menu's box (`menu`) marks the element it is anchored at, its opener,
 * `aria-expanded` while it is open.
 */
export class QuickInput {
  #open: Open | null = null;

  constructor(private readonly host: HTMLElement) {}

  createQuickPick<T extends QuickPickItem>(): QuickPick<T> {
    return new OwnedQuickPick<T>({
      show: (box, field, onHide, anchor, opener) => this.#present(box, field, onHide, anchor, opener),
      hide: (box) => {
        if (this.#open?.box === box) this.#open.close();
      },
    });
  }

  showQuickPick<T extends QuickPickItem>(items: readonly (T | QuickPickSeparator)[], options: QuickPickOptions = {}): Promise<T | undefined> {
    return new Promise((resolve) => this.pickOne(items, options, resolve));
  }

  /**
   * As `showQuickPick`, but calls `done` right as the box is gone and the focus back, so what it does still counts as
   * the viewer's gesture (a command opening a tab, copying to the clipboard).
   */
  pickOne<T extends QuickPickItem>(items: readonly (T | QuickPickSeparator)[], options: QuickPickOptions, done: (item: T | undefined) => void): void {
    const pick = this.createQuickPick<Shown<T>>();
    pick.title = options.title;
    pick.placeholder = options.placeholder;
    pick.anchor = options.anchor;
    pick.menu = options.menu ?? false;
    let picked: T | undefined;
    pick.onDidChangeValue((value) => (pick.items = narrow(items, value)));
    pick.onDidAccept(() => {
      picked = pick.selectedItems[0]?.item;
      pick.hide();
    });
    pick.onDidHide(() => {
      pick.dispose();
      done(picked);
    });
    pick.items = narrow(items, '');
    pick.show();
  }

  showInputBox(options: InputBoxOptions = {}): Promise<string | undefined> {
    const name = options.title ?? 'Input';
    const field = html<HTMLInputElement>`<input type="text" class="d-workbench__quick-pick-field" aria-label=${name} placeholder=${options.placeholder ?? ''}>`;
    field.value = options.value ?? '';
    const message = html`<div class="d-workbench__quick-pick-message" id=${uniqueId('dashica-input-box-message')} aria-live="polite" hidden></div>`;
    const prompt = options.prompt ? html`<div class="d-workbench__quick-pick-hint" id=${uniqueId('dashica-input-box')}>${options.prompt}</div>` : null;
    field.setAttribute('aria-describedby', prompt ? `${message.id} ${prompt.id}` : message.id);
    const box = html`<div class="d-workbench__quick-pick" role="dialog" aria-label=${name}>${field}${message}${prompt}</div>`;
    // shows what `validateInput` says of the text in the field; whether Enter takes it
    const validate = (): boolean => {
      const said = validation(options.validateInput?.(field.value));
      message.textContent = said?.message ?? '';
      message.hidden = !said;
      const error = said?.severity === InputBoxValidationSeverity.Error;
      message.classList.toggle('d-workbench__quick-pick-message--error', error);
      if (error) field.setAttribute('aria-invalid', 'true');
      else field.removeAttribute('aria-invalid');
      return !error;
    };
    return new Promise((resolve) => {
      let value: string | undefined;
      field.addEventListener('input', validate);
      field.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        if (!validate()) return;
        value = field.value;
        if (this.#open?.box === box) this.#open.close();
      });
      validate();
      this.#present(box, field, () => resolve(value), options.anchor);
      const [start, end] = options.valueSelection ?? [0, field.value.length];
      field.setSelectionRange(start, end);
    });
  }

  /** Hides the open box, if any. */
  hide(): void {
    this.#open?.close();
  }

  dispose(): void {
    this.#open?.close();
  }

  /**
   * Shows `box` (hiding an open one) at `anchor` and focuses `focus`, `opener` expanded meanwhile; Escape, a press
   * outside or `close` remove it and call `onHide`.
   */
  #present(box: HTMLElement, focus: HTMLElement, onHide: () => void, anchor: MenuAnchor | undefined, opener?: Element): void {
    this.#open?.close();
    const doc = this.host.ownerDocument;
    const previous = doc.activeElement;
    const outside = (event: MouseEvent) => {
      if (!event.composedPath().includes(box)) close();
    };
    const onkeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    let done = false;
    const close = () => {
      if (done) return;
      done = true;
      doc.removeEventListener('mousedown', outside, true);
      box.removeEventListener('keydown', onkeydown);
      const hadFocus = box.contains(doc.activeElement);
      box.remove();
      opener?.setAttribute('aria-expanded', 'false');
      if (this.#open?.box === box) this.#open = null;
      if (hadFocus && previous instanceof HTMLElement && previous.isConnected) previous.focus();
      onHide();
    };
    box.addEventListener('keydown', onkeydown);
    this.#open = { box, close };
    this.host.append(box);
    opener?.setAttribute('aria-expanded', 'true');
    place(box, anchor);
    doc.addEventListener('mousedown', outside, true);
    focus.focus();
  }
}

/** An item of `showQuickPick` as shown: marked where the text matched, `item` the one handed in. */
type Shown<T extends QuickPickItem> = QuickPickItem & { readonly item: T };

/**
 * The items of `items` that `value` matches (fuzzily, by label, else description), in their order and marked where it
 * matched, each heading while an item of its group is left; all of them, unmarked, while `value` is empty.
 */
function narrow<T extends QuickPickItem>(items: readonly (T | QuickPickSeparator)[], value: string): (Shown<T> | QuickPickSeparator)[] {
  const shown: (Shown<T> | QuickPickSeparator)[] = [];
  let heading: QuickPickSeparator | null = null;
  for (const item of items) {
    if (isSeparator(item)) {
      heading = item;
      continue;
    }
    const label = fuzzyMatch(value, item.label);
    const description = label ? null : item.description ? fuzzyMatch(value, item.description) : null;
    if (!label && !description) continue;
    if (heading) shown.push(heading);
    heading = null;
    const highlights: QuickPickHighlights = value.trim() === '' ? (item.highlights ?? {}) : label ? { label: label.ranges } : { description: description!.ranges };
    shown.push({ ...item, highlights, item });
  }
  return shown;
}

/** What `validateInput` answered as a message: a text is an error; none for `undefined`, `null` or ''. */
function validation(said: string | InputBoxValidationMessage | undefined | null): InputBoxValidationMessage | undefined {
  if (!said) return undefined;
  if (typeof said === 'string') return { message: said, severity: InputBoxValidationSeverity.Error };
  return said.message ? said : undefined;
}

/** Puts `box` at `anchor` (below an element's left edge, or at a point), inside the viewport; else where its CSS says. */
function place(box: HTMLElement, anchor: MenuAnchor | undefined): void {
  box.classList.toggle('d-workbench__quick-pick--anchored', anchor !== undefined);
  if (!anchor) {
    box.style.left = box.style.top = '';
    return;
  }
  const view = box.ownerDocument.defaultView;
  const point = anchor instanceof Element ? { x: anchor.getBoundingClientRect().left, y: anchor.getBoundingClientRect().bottom } : anchor;
  const maxX = Math.max(0, (view?.innerWidth ?? 0) - box.offsetWidth);
  const maxY = Math.max(0, (view?.innerHeight ?? 0) - box.offsetHeight);
  box.style.left = `${Math.min(Math.max(point.x, 0), maxX)}px`;
  box.style.top = `${Math.min(Math.max(point.y, 0), maxY)}px`;
}

/** `prefix` and a random part: an id no other box on the page has. */
function uniqueId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/** A box on screen: closing it removes it and gives the focus back. */
interface Open {
  readonly box: HTMLElement;
  close(): void;
}

function isSeparator<T extends QuickPickItem>(item: T | QuickPickSeparator): item is QuickPickSeparator {
  return (item as Partial<QuickPickSeparator>).kind === QuickPickItemKind.Separator;
}

/**
 * Picks one item: a listbox the field steers (arrows, Enter) with the active item marked; groups under headings; a
 * `disabled` item is shown and can be active, but is not picked. The listbox's id (and its rows', prefixed by it)
 * differs from every other picker's on the page.
 */
class OnePicker<T extends QuickPickItem> {
  #options: { item: T; element: HTMLElement }[] = [];
  #active = 0;
  #rows = 0;

  constructor(
    private readonly parts: { listbox: HTMLElement; input: HTMLInputElement },
    /** `modified`: picked with Cmd / Ctrl (Enter, a click). */
    private readonly pick: (item: T, modified: boolean) => void,
  ) {
    const { listbox, input } = parts;
    listbox.id = uniqueId('dashica-quick-pick');
    input.setAttribute('aria-controls', listbox.id);
  }

  /** How many items are shown. */
  get size(): number {
    return this.#options.length;
  }

  /** Shows `items` (and headings starting groups), the first item active. */
  show(items: readonly (T | QuickPickSeparator)[]): void {
    this.#options = [];
    // a column for the check marks, so every item's label starts at the same place
    this.parts.listbox.classList.toggle('d-workbench__quick-pick-list--checks', items.some((item) => !isSeparator(item) && item.checked !== undefined));
    const rows: HTMLElement[] = [];
    let group: HTMLElement | null = null;
    for (const item of items) {
      if (isSeparator(item)) rows.push((group = this.#group(item)));
      else if (group) group.append(this.#option(item));
      else rows.push(this.#option(item));
    }
    this.parts.listbox.replaceChildren(...rows);
    this.#activate(0);
  }

  /** Makes the first item whose label starts with `prefix` (in any case) active; none such: leaves the active one. */
  jump(prefix: string): void {
    const start = prefix.toLowerCase();
    const index = this.#options.findIndex(({ item }) => item.label.toLowerCase().startsWith(start));
    if (index >= 0) this.#activate(index);
  }

  key(event: KeyboardEvent): void {
    const count = this.#options.length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (count > 0) this.#activate((this.#active + (event.key === 'ArrowDown' ? 1 : -1) + count) % count);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const active = this.#options[this.#active];
      if (active && !active.item.disabled) this.pick(active.item, event.metaKey || event.ctrlKey);
    }
  }

  /** A group under a heading, which names it; without a label, a group of its own only. */
  #group(separator: QuickPickSeparator): HTMLElement {
    if (!separator.label) return html`<div class="d-workbench__quick-pick-group" role="group"></div>`;
    const id = `${this.parts.listbox.id}-${++this.#rows}`;
    const description = separator.description ? html.fragment` <span class="d-workbench__quick-pick-heading-description">${separator.description}</span>` : null;
    return html`<div class="d-workbench__quick-pick-group" role="group" aria-labelledby=${id}>
      <div class="d-workbench__quick-pick-heading" id=${id} role="presentation">${separator.label}${description}</div>
    </div>`;
  }

  #option(item: T): HTMLElement {
    const option = itemElement(item);
    option.setAttribute('role', 'option');
    if (item.checked !== undefined) option.setAttribute('aria-checked', String(item.checked));
    if (item.disabled) option.setAttribute('aria-disabled', 'true');
    if (item.tooltip) option.title = item.tooltip;
    option.id = `${this.parts.listbox.id}-${++this.#rows}`;
    // keeps the focus in the field
    option.addEventListener('mousedown', (event) => event.preventDefault());
    option.addEventListener('click', (event) => item.disabled || this.pick(item, event.metaKey || event.ctrlKey));
    this.#options.push({ item, element: option });
    return option;
  }

  #activate(index: number): void {
    this.#active = index;
    for (const { element } of this.#options) element.setAttribute('aria-selected', 'false');
    const active = this.#options[index];
    if (active) {
      active.element.setAttribute('aria-selected', 'true');
      active.element.scrollIntoView?.({ block: 'nearest' });
      this.parts.input.setAttribute('aria-activedescendant', active.element.id);
    } else this.parts.input.removeAttribute('aria-activedescendant');
  }
}

/**
 * The quick pick of `createQuickPick`: a box with a field, a progress line, the owner's items, "No results" and the
 * prompt. `boxes` shows and hides it as the workbench's one box, at its `anchor`. As a `menu` its field is concealed
 * (it keeps the focus, so the keys work at once): a first letter typed makes the first item starting with it active,
 * the next one shows the field and the text from then on goes to the owner as usual.
 */
class OwnedQuickPick<T extends QuickPickItem> implements QuickPick<T> {
  readonly #box: HTMLElement;
  readonly #field: HTMLInputElement;
  readonly #progress: HTMLElement;
  readonly #empty: HTMLElement;
  readonly #prompt: HTMLElement;
  readonly #picker: OnePicker<T>;
  readonly #changed = new EventEmitter<string>();
  readonly #accepted = new EventEmitter<QuickPickAccept>();
  readonly #hidden = new EventEmitter<void>();
  #title: string | undefined;
  anchor: MenuAnchor | undefined;
  menu = false;
  #items: readonly (T | QuickPickSeparator)[] = [];
  #selected: readonly T[] = [];
  #busy = false;
  #shown = false;
  readonly onDidChangeValue = this.#changed.event;
  readonly onDidAccept = this.#accepted.event;
  readonly onDidHide = this.#hidden.event;

  constructor(
    private readonly boxes: {
      show(box: HTMLElement, field: HTMLElement, onHide: () => void, anchor: MenuAnchor | undefined, opener: Element | undefined): void;
      hide(box: HTMLElement): void;
    },
  ) {
    this.#field = html<HTMLInputElement>`<input type="text" class="d-workbench__quick-pick-field" role="combobox" aria-autocomplete="list" aria-expanded="true"
      oninput=${() => this.#typed()} onkeydown=${(event: KeyboardEvent) => this.#picker.key(event)}>`;
    this.#progress = html`<div class="d-workbench__quick-pick-progress"></div>`;
    const listbox = html`<div class="d-workbench__quick-pick-list" role="listbox"></div>`;
    this.#empty = html`<div class="d-workbench__quick-pick-empty">No results</div>`;
    this.#prompt = html`<div class="d-workbench__quick-pick-hint"></div>`;
    this.#box = html`<div class="d-workbench__quick-pick" role="dialog">${this.#field}${this.#progress}${listbox}${this.#empty}${this.#prompt}</div>`;
    this.#picker = new OnePicker<T>({ listbox, input: this.#field }, (item, modified) => {
      this.#selected = [item];
      this.#accepted.fire({ newTab: modified });
    });
    this.#prompt.id = `${listbox.id}-hint`;
    this.#update();
  }

  get title(): string | undefined {
    return this.#title;
  }

  set title(title: string | undefined) {
    this.#title = title;
    this.#update();
  }

  get placeholder(): string | undefined {
    return this.#field.placeholder || undefined;
  }

  set placeholder(placeholder: string | undefined) {
    this.#field.placeholder = placeholder ?? '';
  }

  get value(): string {
    return this.#field.value;
  }

  set value(value: string) {
    this.#field.value = value;
    this.#field.setSelectionRange(value.length, value.length);
    if (value !== '') this.#conceal(false);
    this.#changed.fire(value);
  }

  get prompt(): string | undefined {
    return this.#prompt.textContent || undefined;
  }

  set prompt(prompt: string | undefined) {
    this.#prompt.textContent = prompt ?? '';
    this.#update();
  }

  get items(): readonly (T | QuickPickSeparator)[] {
    return this.#items;
  }

  set items(items: readonly (T | QuickPickSeparator)[]) {
    this.#items = items;
    this.#picker.show(items);
    this.#update();
  }

  get busy(): boolean {
    return this.#busy;
  }

  set busy(busy: boolean) {
    this.#busy = busy;
    this.#update();
  }

  get selectedItems(): readonly T[] {
    return this.#selected;
  }

  show(): void {
    if (this.#shown) return;
    this.#shown = true;
    this.#box.classList.toggle('d-workbench__quick-pick--menu', this.menu);
    this.#conceal(this.menu && this.#field.value === '');
    const opener = this.menu && this.anchor instanceof Element ? this.anchor : undefined;
    this.boxes.show(this.#box, this.#field, () => {
      this.#shown = false;
      this.#hidden.fire();
    }, this.anchor, opener);
    this.#field.setSelectionRange(this.#field.value.length, this.#field.value.length);
  }

  hide(): void {
    this.boxes.hide(this.#box);
  }

  dispose(): void {
    this.hide();
    this.#changed.dispose();
    this.#accepted.dispose();
    this.#hidden.dispose();
  }

  /** The text typed: while the field is concealed, a letter only jumps (`OnePicker.jump`); else it goes to the owner. */
  #typed(): void {
    const value = this.#field.value;
    if (this.#field.classList.contains(CONCEALED)) {
      if (value.length <= 1) {
        this.#picker.jump(value);
        return;
      }
      this.#conceal(false);
    }
    this.#changed.fire(value);
  }

  #conceal(concealed: boolean): void {
    this.#field.classList.toggle(CONCEALED, concealed);
  }

  /** The names, the progress line, "No results" and the prompt as the state says. */
  #update(): void {
    const name = this.#title ?? 'Pick';
    this.#box.setAttribute('aria-label', name);
    this.#field.setAttribute('aria-label', name);
    this.#progress.hidden = !this.#busy;
    this.#empty.hidden = this.#busy || this.#picker.size > 0 || this.#field.value.trim() === '';
    this.#prompt.hidden = !this.#prompt.textContent;
    if (this.#prompt.hidden) this.#field.removeAttribute('aria-describedby');
    else this.#field.setAttribute('aria-describedby', this.#prompt.id);
  }
}

/** A menu's field before more than a letter is typed: out of sight, still focused. */
const CONCEALED = 'd-workbench__quick-pick-field--concealed';

/**
 * An item's check mark, icon, label, description, key and detail, the `highlights` marked; a space before each further
 * part, so its accessible name reads as words.
 */
function itemElement(item: QuickPickItem): HTMLElement {
  const highlights = item.highlights ?? {};
  const space = (part: Node | null) => (part ? html.fragment` ${part}` : null);
  const check = html`<span class="d-workbench__quick-pick-check" aria-hidden="true">${item.checked ? '✓' : ''}</span>`;
  let icon: HTMLElement | null = null;
  if (item.icon) {
    const span: HTMLElement = html`<span class="d-workbench__quick-pick-icon" role="img" aria-label=${item.icon.label}></span>`;
    span.insertAdjacentHTML('beforeend', item.icon.svg);
    icon = span;
  }
  return html`<div class="d-workbench__quick-pick-item">${check}${icon ? html.fragment`${icon} ` : null}${highlighted('d-workbench__quick-pick-label', item.label, highlights.label)}${space(
    item.description ? highlighted('d-workbench__quick-pick-description', item.description, highlights.description) : null,
  )}${space(item.keybinding ? html`<kbd class="d-workbench__quick-pick-keybinding">${item.keybinding}</kbd>` : null)}${space(
    item.detail ? highlighted('d-workbench__quick-pick-detail', item.detail, highlights.detail) : null,
  )}</div>`;
}

/** A span of `text` with the characters in `ranges` in `<mark>`s. */
function highlighted(className: string, text: string, ranges: QuickPickHighlights['label'] = []): HTMLElement {
  const parts: (string | Node)[] = [];
  let last = 0;
  for (const [start, end] of ranges) {
    if (start < last || end > text.length) continue;
    parts.push(text.slice(last, start), html`<mark class="d-workbench__quick-pick-match">${text.slice(start, end)}</mark>`);
    last = end;
  }
  parts.push(text.slice(last));
  return html`<span class=${className}>${parts}</span>`;
}
