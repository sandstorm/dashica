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
  type QuickPickItems,
  QuickPickItemKind,
  type QuickPickOptions,
  type QuickPickSeparator,
} from '../ui';

/**
 * What `showQuickPick`, `showInputBox` and `createQuickPick` show: one box at a time over the workbench `hostContainer`
 * (a new one hides the open one), at its anchor (below an element, or at a point, kept inside the viewport) or at the
 * top in the middle; an input box's validation message below its field (its own one-line field, or the caller's,
 * `InputBoxOptions.field`). With `accept` a choice runs it while the box stays, busy, and a failed one shows its error
 * in the box's message line. Escape or a mouse press elsewhere hides it; hiding gives the focus back to where it was. A
 * menu's box (`menu`) marks the element it is anchored at, its opener, `aria-expanded` while it is open.
 */
export class QuickInput {
  #open: Open | null = null;

  constructor(private readonly hostContainer: HTMLElement) {}

  createQuickPick<T extends QuickPickItem>(): QuickPick<T> {
    return new OwnedQuickPick<T>({
      show: (boxContainer, fieldElement, onHide, anchor, openerElement) => this.#present(boxContainer, fieldElement, onHide, anchor, openerElement),
      hide: (boxContainer) => {
        if (this.#open?.boxContainer === boxContainer) this.#open.close();
      },
    });
  }

  showQuickPick<T extends QuickPickItem>(items: QuickPickItems<T>, options: QuickPickOptions<T> = {}): Promise<T | undefined> {
    return new Promise((resolve, reject) => this.pickOne(items, options, resolve, reject));
  }

  /**
   * As `showQuickPick`, but calls `done` right as the box is gone and the focus back, so what it does still counts as
   * the viewer's gesture (a command opening a tab, copying to the clipboard). Items still to come show the box busy (its
   * progress line) until they are there; when they fail instead, the box hides and `failed` gets the error; a menu's
   * that turn out none hide it too, with `done(undefined)`.
   */
  pickOne<T extends QuickPickItem>(
    items: QuickPickItems<T>,
    options: QuickPickOptions<T>,
    done: (item: T | undefined) => void,
    failed: (error: unknown) => void = (error) => console.error(`Quick pick ${options.title ?? ''} failed:`, error),
  ): void {
    const pick = this.createQuickPick<Shown<T>>();
    pick.title = options.title;
    pick.placeholder = options.placeholder;
    pick.anchor = options.anchor;
    pick.menu = options.menu ?? false;
    let shown: readonly (T | QuickPickSeparator)[] = [];
    let picked: T | undefined;
    let error: { readonly error: unknown } | undefined;
    let hidden = false;
    pick.onDidChangeValue((value) => (pick.items = narrow(shown, value)));
    pick.onDidAccept(() => {
      const item = pick.selectedItems[0]?.item;
      if (!options.accept || !item) {
        picked = item;
        pick.hide();
        return;
      }
      if (pick.busy) return;
      pick.busy = true;
      pick.message = undefined;
      options.accept(item).then(
        () => {
          picked = item;
          pick.hide();
        },
        (reason: unknown) => {
          if (hidden) console.error(`Quick pick ${options.title ?? ''} failed:`, reason);
          pick.busy = false;
          pick.message = messageOf(reason);
        },
      );
    });
    pick.onDidHide(() => {
      hidden = true;
      pick.dispose();
      if (error) failed(error.error);
      else done(picked);
    });
    const show = (list: readonly (T | QuickPickSeparator)[]) => {
      shown = list;
      pick.items = narrow(list, pick.value);
    };
    if (!(items instanceof Promise)) {
      show(items);
      pick.show();
      return;
    }
    pick.busy = true;
    pick.show();
    items.then(
      (list) => {
        if (hidden) return;
        // a menu whose items turn out none has nothing to show, as a context menu without an entry that applies
        if (pick.menu && list.length === 0) {
          pick.hide();
          return;
        }
        show(list);
        pick.busy = false;
      },
      (reason: unknown) => {
        if (hidden) return;
        error = { error: reason };
        pick.hide();
      },
    );
  }

  showInputBox(options: InputBoxOptions = {}): Promise<string | undefined> {
    const name = options.title ?? 'Input';
    const { field } = options;
    // a field of the caller's (a SQL editor), else the one-line text field
    const ownInputElement = field ? undefined : html<HTMLInputElement>`<input type="text" class="d-workbench__quick-pick-field" placeholder=${options.placeholder ?? ''}>`;
    if (ownInputElement) ownInputElement.value = options.value ?? '';
    const inputElement = field?.inputElement ?? ownInputElement!;
    const text = () => field?.value ?? ownInputElement!.value;
    const messageElement = html`<div class="d-workbench__quick-pick-message" id=${uniqueId('dashica-input-box-message')} aria-live="polite" hidden></div>`;
    const progressElement = html`<div class="d-workbench__quick-pick-progress" hidden></div>`;
    const promptElement = options.prompt ? html`<div class="d-workbench__quick-pick-hint" id=${uniqueId('dashica-input-box')}>${options.prompt}</div>` : null;
    inputElement.setAttribute('aria-label', name);
    inputElement.setAttribute('aria-describedby', promptElement ? `${messageElement.id} ${promptElement.id}` : messageElement.id);
    const boxContainer = html`<div class="d-workbench__quick-pick" role="dialog" aria-label=${name}>${field?.fieldElement ?? ownInputElement}${progressElement}${messageElement}${promptElement}</div>`;
    const say = (said: InputBoxValidationMessage | undefined): boolean => {
      messageElement.textContent = said?.message ?? '';
      messageElement.hidden = !said;
      const error = said?.severity === InputBoxValidationSeverity.Error;
      messageElement.classList.toggle('d-workbench__quick-pick-message--error', error);
      if (error) inputElement.setAttribute('aria-invalid', 'true');
      else inputElement.removeAttribute('aria-invalid');
      return !error;
    };
    // shows what `validateInput` says of the text in the field; whether Enter takes it
    const validate = (): boolean => say(options.validateInput?.(text()));
    return new Promise((resolve) => {
      let value: string | undefined;
      let hidden = false;
      const close = (taken: string) => {
        value = taken;
        if (this.#open?.boxContainer === boxContainer) this.#open.close();
      };
      const accept = () => {
        if (!progressElement.hidden || !validate()) return;
        const taken = text();
        if (!options.accept) return close(taken);
        progressElement.hidden = false;
        options.accept(taken).then(
          () => close(taken),
          (reason: unknown) => {
            if (hidden) console.error(`Input box ${name} failed:`, reason);
            progressElement.hidden = true;
            say({ message: messageOf(reason), severity: InputBoxValidationSeverity.Error });
          },
        );
      };
      const listening = field ? [field.onDidChangeValue(validate), field.onDidAccept(accept)] : [];
      ownInputElement?.addEventListener('input', validate);
      ownInputElement?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        accept();
      });
      validate();
      const onHide = () => {
        hidden = true;
        for (const listener of listening) listener.dispose();
        resolve(value);
      };
      this.#present(boxContainer, field ?? ownInputElement!, onHide, options.anchor);
      const [start, end] = options.valueSelection ?? [0, text().length];
      if (field) field.select(start, end);
      else ownInputElement!.setSelectionRange(start, end);
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
   * Shows `boxContainer` (hiding an open one) at `anchor` and focuses `focus`, `openerElement` expanded meanwhile;
   * Escape, a press outside or `close` remove it and call `onHide`.
   */
  #present(boxContainer: HTMLElement, focus: { focus(): void }, onHide: () => void, anchor: MenuAnchor | undefined, openerElement?: Element): void {
    this.#open?.close();
    const doc = this.hostContainer.ownerDocument;
    const previousElement = doc.activeElement;
    const outside = (event: MouseEvent) => {
      if (!event.composedPath().includes(boxContainer)) close();
    };
    const onkeydown = (event: KeyboardEvent) => {
      // a key the field took itself (its completion's Escape) stays the field's
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    let done = false;
    const close = () => {
      if (done) return;
      done = true;
      doc.removeEventListener('mousedown', outside, true);
      boxContainer.removeEventListener('keydown', onkeydown);
      const hadFocus = boxContainer.contains(doc.activeElement);
      boxContainer.remove();
      openerElement?.setAttribute('aria-expanded', 'false');
      if (this.#open?.boxContainer === boxContainer) this.#open = null;
      if (hadFocus && previousElement instanceof HTMLElement && previousElement.isConnected) previousElement.focus();
      onHide();
    };
    boxContainer.addEventListener('keydown', onkeydown);
    this.#open = { boxContainer, close };
    this.hostContainer.append(boxContainer);
    openerElement?.setAttribute('aria-expanded', 'true');
    place(boxContainer, anchor);
    doc.addEventListener('mousedown', outside, true);
    focus.focus();
  }
}

/** A box on screen: closing it removes it and gives the focus back. */
interface Open {
  readonly boxContainer: HTMLElement;
  close(): void;
}

/** An item of `showQuickPick` as shown: marked where the text matched, `item` the one handed in. */
type Shown<T extends QuickPickItem> = QuickPickItem & { readonly item: T };

/**
 * The items of `items` that `value` matches (fuzzily, by label, else description, else both read as one: "orders
 * oekokiste" for "Orders" of "Oekokiste overview"), in their order and marked where it matched, each heading while an
 * item of its group is left; all of them, unmarked, while `value` is empty.
 */
function narrow<T extends QuickPickItem>(items: readonly (T | QuickPickSeparator)[], value: string): (Shown<T> | QuickPickSeparator)[] {
  const shown: (Shown<T> | QuickPickSeparator)[] = [];
  let heading: QuickPickSeparator | null = null;
  for (const item of items) {
    if (isSeparator(item)) {
      heading = item;
      continue;
    }
    const highlights = value.trim() === '' ? (item.highlights ?? {}) : matchOf(value, item);
    if (!highlights) continue;
    if (heading) shown.push(heading);
    heading = null;
    shown.push({ ...item, highlights, item });
  }
  return shown;
}

/** Where `value` matches `item` (`narrow`): its label, else its description, else both read as one; null: nowhere. */
function matchOf(value: string, item: QuickPickItem): QuickPickHighlights | null {
  const label = fuzzyMatch(value, item.label);
  if (label) return { label: label.ranges };
  if (!item.description) return null;
  const description = fuzzyMatch(value, item.description);
  if (description) return { description: description.ranges };
  const both = fuzzyMatch(value, `${item.label} ${item.description}`);
  if (!both) return null;
  // the description's characters start after the label and the space
  const start = item.label.length + 1;
  return {
    label: both.ranges.filter(([from]) => from < item.label.length).map(([from, to]) => [from, Math.min(to, item.label.length)] as const),
    description: both.ranges.filter(([, to]) => to > start).map(([from, to]) => [Math.max(from, start) - start, to - start] as const),
  };
}

/** Puts `boxContainer` at `anchor` (below an element's left edge, or at a point), inside the viewport; else where its CSS says. */
function place(boxContainer: HTMLElement, anchor: MenuAnchor | undefined): void {
  boxContainer.classList.toggle('d-workbench__quick-pick--anchored', anchor !== undefined);
  if (!anchor) {
    boxContainer.style.left = boxContainer.style.top = '';
    return;
  }
  const view = boxContainer.ownerDocument.defaultView;
  const point = anchor instanceof Element ? { x: anchor.getBoundingClientRect().left, y: anchor.getBoundingClientRect().bottom } : anchor;
  const maxX = Math.max(0, (view?.innerWidth ?? 0) - boxContainer.offsetWidth);
  const maxY = Math.max(0, (view?.innerHeight ?? 0) - boxContainer.offsetHeight);
  boxContainer.style.left = `${Math.min(Math.max(point.x, 0), maxX)}px`;
  boxContainer.style.top = `${Math.min(Math.max(point.y, 0), maxY)}px`;
}

function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function uniqueId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function isSeparator<T extends QuickPickItem>(item: T | QuickPickSeparator): item is QuickPickSeparator {
  return (item as Partial<QuickPickSeparator>).kind === QuickPickItemKind.Separator;
}

/**
 * Picks one item: a listbox the field steers (arrows, Enter) with the active item marked; groups under headings; a
 * `disabled` item is shown and can be active, and picking it does nothing. The listbox's id (and its rows', prefixed
 * by it) differs from every other picker's on the page.
 */
class OnePicker<T extends QuickPickItem> {
  #options: { item: T; optionElement: HTMLElement }[] = [];
  #active = 0;
  #rows = 0;

  constructor(
    private readonly parts: { listboxContainer: HTMLElement; inputElement: HTMLInputElement },
    /** `modified`: picked with Cmd / Ctrl (Enter, a click). */
    private readonly pick: (item: T, modified: boolean) => void,
  ) {
    const { listboxContainer, inputElement } = parts;
    listboxContainer.id = uniqueId('dashica-quick-pick');
    inputElement.setAttribute('aria-controls', listboxContainer.id);
  }

  /** How many items are shown. */
  get size(): number {
    return this.#options.length;
  }

  /** Shows `items` (and headings starting groups), the first item active. */
  show(items: readonly (T | QuickPickSeparator)[]): void {
    this.#options = [];
    // a column for the check marks, so every item's label starts at the same place
    this.parts.listboxContainer.classList.toggle('d-workbench__quick-pick-list--checks', items.some((item) => !isSeparator(item) && item.checked !== undefined));
    const rowElements: HTMLElement[] = [];
    let groupContainer: HTMLElement | null = null;
    for (const item of items) {
      if (isSeparator(item)) rowElements.push((groupContainer = this.#group(item)));
      else if (groupContainer) groupContainer.append(this.#option(item));
      else rowElements.push(this.#option(item));
    }
    this.parts.listboxContainer.replaceChildren(...rowElements);
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
    const id = `${this.parts.listboxContainer.id}-${++this.#rows}`;
    const descriptionElement = separator.description ? html.fragment` <span class="d-workbench__quick-pick-heading-description">${separator.description}</span>` : null;
    return html`<div class="d-workbench__quick-pick-group" role="group" aria-labelledby=${id}>
      <div class="d-workbench__quick-pick-heading" id=${id} role="presentation">${separator.label}${descriptionElement}</div>
    </div>`;
  }

  #option(item: T): HTMLElement {
    const optionElement = itemElement(item);
    optionElement.setAttribute('role', 'option');
    if (item.checked !== undefined) optionElement.setAttribute('aria-checked', String(item.checked));
    if (item.disabled) optionElement.setAttribute('aria-disabled', 'true');
    if (item.tooltip) optionElement.title = item.tooltip;
    optionElement.id = `${this.parts.listboxContainer.id}-${++this.#rows}`;
    // keeps the focus in the field
    optionElement.addEventListener('mousedown', (event) => event.preventDefault());
    optionElement.addEventListener('click', (event) => item.disabled || this.pick(item, event.metaKey || event.ctrlKey));
    this.#options.push({ item, optionElement });
    return optionElement;
  }

  #activate(index: number): void {
    this.#active = index;
    for (const { optionElement } of this.#options) optionElement.setAttribute('aria-selected', 'false');
    const active = this.#options[index];
    if (active) {
      active.optionElement.setAttribute('aria-selected', 'true');
      active.optionElement.scrollIntoView?.({ block: 'nearest' });
      this.parts.inputElement.setAttribute('aria-activedescendant', active.optionElement.id);
    } else this.parts.inputElement.removeAttribute('aria-activedescendant');
  }
}

/**
 * The quick pick of `createQuickPick`: a box with a field, a progress line, an error line (`message`), the owner's
 * items, "No results" and the prompt. `boxes` shows and hides it as the workbench's one box, at its `anchor`. As a
 * `menu` its field is concealed (it keeps the focus, so the keys work at once): a first letter typed makes the first
 * item starting with it active, the next one shows the field and the text from then on goes to the owner as usual.
 */
class OwnedQuickPick<T extends QuickPickItem> implements QuickPick<T> {
  readonly #boxContainer: HTMLElement;
  readonly #fieldElement: HTMLInputElement;
  readonly #messageElement: HTMLElement;
  readonly #progressElement: HTMLElement;
  readonly #emptyElement: HTMLElement;
  readonly #promptElement: HTMLElement;
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
      show(boxContainer: HTMLElement, fieldElement: HTMLElement, onHide: () => void, anchor: MenuAnchor | undefined, openerElement: Element | undefined): void;
      hide(boxContainer: HTMLElement): void;
    },
  ) {
    this.#fieldElement = html<HTMLInputElement>`<input type="text" class="d-workbench__quick-pick-field" role="combobox" aria-autocomplete="list" aria-expanded="true"
      oninput=${() => this.#typed()} onkeydown=${(event: KeyboardEvent) => this.#picker.key(event)}>`;
    this.#messageElement = html`<div class="d-workbench__quick-pick-message d-workbench__quick-pick-message--error" aria-live="polite"></div>`;
    this.#progressElement = html`<div class="d-workbench__quick-pick-progress"></div>`;
    const listboxContainer = html`<div class="d-workbench__quick-pick-list" role="listbox"></div>`;
    this.#emptyElement = html`<div class="d-workbench__quick-pick-empty">No results</div>`;
    this.#promptElement = html`<div class="d-workbench__quick-pick-hint"></div>`;
    this.#boxContainer = html`<div class="d-workbench__quick-pick" role="dialog">${this.#fieldElement}${this.#progressElement}${this.#messageElement}${listboxContainer}${this.#emptyElement}${this.#promptElement}</div>`;
    this.#picker = new OnePicker<T>({ listboxContainer, inputElement: this.#fieldElement }, (item, modified) => {
      this.#selected = [item];
      this.#accepted.fire({ newTab: modified });
    });
    this.#promptElement.id = `${listboxContainer.id}-hint`;
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
    return this.#fieldElement.placeholder || undefined;
  }

  set placeholder(placeholder: string | undefined) {
    this.#fieldElement.placeholder = placeholder ?? '';
  }

  get value(): string {
    return this.#fieldElement.value;
  }

  set value(value: string) {
    this.#fieldElement.value = value;
    this.#fieldElement.setSelectionRange(value.length, value.length);
    if (value !== '') this.#conceal(false);
    this.#changed.fire(value);
  }

  get prompt(): string | undefined {
    return this.#promptElement.textContent || undefined;
  }

  set prompt(prompt: string | undefined) {
    this.#promptElement.textContent = prompt ?? '';
    this.#update();
  }

  get message(): string | undefined {
    return this.#messageElement.textContent || undefined;
  }

  set message(message: string | undefined) {
    this.#messageElement.textContent = message ?? '';
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
    this.#boxContainer.classList.toggle('d-workbench__quick-pick--menu', this.menu);
    this.#conceal(this.menu && this.#fieldElement.value === '');
    const openerElement = this.menu && this.anchor instanceof Element ? this.anchor : undefined;
    this.boxes.show(this.#boxContainer, this.#fieldElement, () => {
      this.#shown = false;
      this.#hidden.fire();
    }, this.anchor, openerElement);
    this.#fieldElement.setSelectionRange(this.#fieldElement.value.length, this.#fieldElement.value.length);
  }

  hide(): void {
    this.boxes.hide(this.#boxContainer);
  }

  dispose(): void {
    this.hide();
    this.#changed.dispose();
    this.#accepted.dispose();
    this.#hidden.dispose();
  }

  /** The text typed: while the field is concealed, a letter only jumps (`OnePicker.jump`); else it goes to the owner. */
  #typed(): void {
    const value = this.#fieldElement.value;
    if (this.#fieldElement.classList.contains(CONCEALED)) {
      if (value.length <= 1) {
        this.#picker.jump(value);
        return;
      }
      this.#conceal(false);
    }
    this.#changed.fire(value);
  }

  #conceal(concealed: boolean): void {
    this.#fieldElement.classList.toggle(CONCEALED, concealed);
  }

  /** The names, the progress line, the error line, "No results" and the prompt as the state says. */
  #update(): void {
    const name = this.#title ?? 'Pick';
    this.#boxContainer.setAttribute('aria-label', name);
    this.#fieldElement.setAttribute('aria-label', name);
    this.#progressElement.hidden = !this.#busy;
    this.#messageElement.hidden = !this.#messageElement.textContent;
    this.#emptyElement.hidden = this.#busy || this.#picker.size > 0 || this.#fieldElement.value.trim() === '';
    this.#promptElement.hidden = !this.#promptElement.textContent;
    if (this.#promptElement.hidden) this.#fieldElement.removeAttribute('aria-describedby');
    else this.#fieldElement.setAttribute('aria-describedby', this.#promptElement.id);
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
  const space = (partElement: Node | null) => (partElement ? html.fragment` ${partElement}` : null);
  const checkElement = html`<span class="d-workbench__quick-pick-check" aria-hidden="true">${item.checked ? '✓' : ''}</span>`;
  let iconElement: HTMLElement | null = null;
  if (item.icon) {
    const iconSpanElement: HTMLElement = html`<span class="d-workbench__quick-pick-icon" role="img" aria-label=${item.icon.label}></span>`;
    iconSpanElement.insertAdjacentHTML('beforeend', item.icon.svg);
    iconElement = iconSpanElement;
  }
  return html`<div class="d-workbench__quick-pick-item">${checkElement}${iconElement ? html.fragment`${iconElement} ` : null}${highlighted('d-workbench__quick-pick-label', item.label, highlights.label)}${space(
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
