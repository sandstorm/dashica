// See UiApi in ../ui.ts.
import { html } from 'htl';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import { type QuickPick, type QuickPickHighlights, type QuickPickItem, QuickPickItemKind, type QuickPickSeparator } from '../ui';

/**
 * What `createQuickPick` shows: one box at a time over the workbench `host` (a new one hides the open one), at the top
 * in the middle. Escape or a mouse press elsewhere hides it; hiding gives the focus back to where it was.
 */
export class QuickInput {
  #open: Open | null = null;

  constructor(private readonly host: HTMLElement) {}

  createQuickPick<T extends QuickPickItem>(): QuickPick<T> {
    return new OwnedQuickPick<T>({
      show: (box, field, onHide) => this.#present(box, field, onHide),
      hide: (box) => {
        if (this.#open?.box === box) this.#open.close();
      },
    });
  }

  dispose(): void {
    this.#open?.close();
  }

  /** Shows `box` (hiding an open one) and focuses `focus`; Escape, a press outside or `close` remove it and call `onHide`. */
  #present(box: HTMLElement, focus: HTMLElement, onHide: () => void): void {
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
      if (this.#open?.box === box) this.#open = null;
      if (hadFocus && previous instanceof HTMLElement && previous.isConnected) previous.focus();
      onHide();
    };
    box.addEventListener('keydown', onkeydown);
    this.#open = { box, close };
    this.host.append(box);
    doc.addEventListener('mousedown', outside, true);
    focus.focus();
  }
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
 * Picks one item: a listbox the field steers (arrows, Enter) with the active item marked; groups under headings. The
 * listbox's id (and its rows', prefixed by it) differs from every other picker's on the page.
 */
class OnePicker<T extends QuickPickItem> {
  #options: { item: T; element: HTMLElement }[] = [];
  #active = 0;
  #rows = 0;

  constructor(
    private readonly parts: { listbox: HTMLElement; input: HTMLInputElement },
    private readonly pick: (item: T) => void,
  ) {
    const { listbox, input } = parts;
    listbox.id = `dashica-quick-pick-${Math.random().toString(36).slice(2, 10)}`;
    input.setAttribute('aria-controls', listbox.id);
  }

  /** How many items are shown. */
  get size(): number {
    return this.#options.length;
  }

  /** Shows `items` (and headings starting groups), the first item active. */
  show(items: readonly (T | QuickPickSeparator)[]): void {
    this.#options = [];
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

  key(event: KeyboardEvent): void {
    const count = this.#options.length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (count > 0) this.#activate((this.#active + (event.key === 'ArrowDown' ? 1 : -1) + count) % count);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const active = this.#options[this.#active];
      if (active) this.pick(active.item);
    }
  }

  /** A group under a heading, which names it. */
  #group(separator: QuickPickSeparator): HTMLElement {
    const id = `${this.parts.listbox.id}-${++this.#rows}`;
    const description = separator.description ? html.fragment` <span class="dashica-wb__quick-pick-heading-description">${separator.description}</span>` : null;
    return html`<div class="dashica-wb__quick-pick-group" role="group" aria-labelledby=${id}>
      <div class="dashica-wb__quick-pick-heading" id=${id} role="presentation">${separator.label}${description}</div>
    </div>`;
  }

  #option(item: T): HTMLElement {
    const option = itemElement(item);
    option.setAttribute('role', 'option');
    option.id = `${this.parts.listbox.id}-${++this.#rows}`;
    // keeps the focus in the field
    option.addEventListener('mousedown', (event) => event.preventDefault());
    option.addEventListener('click', () => this.pick(item));
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
 * prompt. `boxes` shows and hides it as the workbench's one box.
 */
class OwnedQuickPick<T extends QuickPickItem> implements QuickPick<T> {
  readonly #box: HTMLElement;
  readonly #field: HTMLInputElement;
  readonly #progress: HTMLElement;
  readonly #empty: HTMLElement;
  readonly #prompt: HTMLElement;
  readonly #picker: OnePicker<T>;
  readonly #changed = new EventEmitter<string>();
  readonly #accepted = new EventEmitter<void>();
  readonly #hidden = new EventEmitter<void>();
  #title: string | undefined;
  #items: readonly (T | QuickPickSeparator)[] = [];
  #selected: readonly T[] = [];
  #busy = false;
  #shown = false;
  readonly onDidChangeValue = this.#changed.event;
  readonly onDidAccept = this.#accepted.event;
  readonly onDidHide = this.#hidden.event;

  constructor(
    private readonly boxes: {
      show(box: HTMLElement, field: HTMLElement, onHide: () => void): void;
      hide(box: HTMLElement): void;
    },
  ) {
    this.#field = html<HTMLInputElement>`<input type="text" class="dashica-wb__quick-pick-field" role="combobox" aria-autocomplete="list" aria-expanded="true"
      oninput=${() => this.#changed.fire(this.#field.value)} onkeydown=${(event: KeyboardEvent) => this.#picker.key(event)}>`;
    this.#progress = html`<div class="dashica-wb__quick-pick-progress"></div>`;
    const listbox = html`<div class="dashica-wb__quick-pick-list" role="listbox"></div>`;
    this.#empty = html`<div class="dashica-wb__quick-pick-empty">No results</div>`;
    this.#prompt = html`<div class="dashica-wb__quick-pick-hint"></div>`;
    this.#box = html`<div class="dashica-wb__quick-pick" role="dialog">${this.#field}${this.#progress}${listbox}${this.#empty}${this.#prompt}</div>`;
    this.#picker = new OnePicker<T>({ listbox, input: this.#field }, (item) => {
      this.#selected = [item];
      this.#accepted.fire();
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
    this.boxes.show(this.#box, this.#field, () => {
      this.#shown = false;
      this.#hidden.fire();
    });
    this.#field.setSelectionRange(this.#field.value.length, this.#field.value.length);
  }

  hide(): void {
    this.boxes.hide(this.#box);
  }

  dispose(): void {
    this.hide();
    for (const emitter of [this.#changed, this.#accepted, this.#hidden]) emitter.dispose();
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

/** An item's label, description, key and detail, the `highlights` marked; a space before each further part, so its accessible name reads as words. */
function itemElement(item: QuickPickItem): HTMLElement {
  const highlights = item.highlights ?? {};
  const space = (part: Node | null) => (part ? html.fragment` ${part}` : null);
  return html`<div class="dashica-wb__quick-pick-item">${highlighted('dashica-wb__quick-pick-label', item.label, highlights.label)}${space(
    item.description ? highlighted('dashica-wb__quick-pick-description', item.description, highlights.description) : null,
  )}${space(item.keybinding ? html`<kbd class="dashica-wb__quick-pick-keybinding">${item.keybinding}</kbd>` : null)}${space(
    item.detail ? highlighted('dashica-wb__quick-pick-detail', item.detail, highlights.detail) : null,
  )}</div>`;
}

/** A span of `text` with the characters in `ranges` in `<mark>`s. */
function highlighted(className: string, text: string, ranges: QuickPickHighlights['label'] = []): HTMLElement {
  const parts: (string | Node)[] = [];
  let last = 0;
  for (const [start, end] of ranges) {
    if (start < last || end > text.length) continue;
    parts.push(text.slice(last, start), html`<mark class="dashica-wb__quick-pick-match">${text.slice(start, end)}</mark>`);
    last = end;
  }
  parts.push(text.slice(last));
  return html`<span class=${className}>${parts}</span>`;
}
