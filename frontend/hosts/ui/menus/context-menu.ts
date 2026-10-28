// See UiApi in ../ui.ts.
import { html } from 'htl';
import type { CommandsHost } from '../../commands/commands';
import type { ContextMenuOptions, MenuAnchor } from '../ui';
import type { Menus } from './menus';

/**
 * What `showContextMenu` shows. One menu at a time (a new one closes the open one): a `role="menu"` list of the menu's
 * entries, a separator between groups, an entry with `toggled` as a checkbox entry (a check mark while it holds), an
 * entry's key at its end, fixed at its anchor and kept inside the viewport. The first entry gets the focus; arrow keys,
 * Home and End move it. Choosing an entry, Escape, Tab or a press elsewhere closes the menu and gives the focus back to
 * the element that had it; a chosen entry's command runs after that (a failing one is logged). A menu without entries
 * is not shown.
 */
export class ContextMenu {
  #open: MenuList | null = null;

  constructor(
    /** Where the menu's element goes. */
    private readonly host: HTMLElement,
    private readonly menus: Menus,
    /** Runs a chosen entry's command with the menu's arguments; names the entries' keys. */
    private readonly commands: Pick<CommandsHost, 'executeCommand' | 'keybindingLabel'>,
  ) {}

  show(menuId: string, options: ContextMenuOptions): void {
    this.#open?.close();
    this.#open = null;
    const context = options.context ?? {};
    const items = this.menus.items(menuId, context);
    if (items.length === 0) return;
    const args = options.args ?? [];
    const entries = items.map((item) => ({
      label: item.title ?? item.command,
      group: item.group,
      keybinding: this.commands.keybindingLabel(item.command),
      checked: item.toggled?.(context),
      run: () => this.#run(item.command, args),
    }));
    this.#open = new MenuList(this.host, options.title, entries, options.anchor);
  }

  dispose(): void {
    this.#open?.close();
    this.#open = null;
  }

  #run(command: string, args: readonly unknown[]): void {
    this.commands.executeCommand(command, ...args).catch((error: unknown) => console.error(`Command ${command} failed:`, error));
  }
}

/** The menu's element in `container` while it is open. */
class MenuList {
  readonly #element: HTMLElement;
  readonly #items: HTMLButtonElement[] = [];
  readonly #returnFocus: Element | null;
  #closed = false;

  constructor(container: HTMLElement, label: string, entries: readonly Entry[], anchor: MenuAnchor) {
    this.#returnFocus = container.ownerDocument.activeElement;
    // a column for the check marks, so every entry's label starts at the same place
    const checks = entries.some((entry) => entry.checked !== undefined);
    const rows = entries.flatMap((entry, index) => {
      const item = this.#item(entry);
      const startsGroup = index > 0 && (entry.group ?? '') !== (entries[index - 1].group ?? '');
      return startsGroup ? [html`<div class="dashica-wb__context-menu-separator" role="separator"></div>`, item] : [item];
    });
    this.#element = html`<div class="dashica-wb__context-menu ${checks ? 'dashica-wb__context-menu--checks' : ''}" role="menu"
      aria-label=${label} onkeydown=${(event: KeyboardEvent) => this.#key(event)}>${rows}</div>`;
    container.append(this.#element);
    this.#place(anchor);
    container.ownerDocument.addEventListener('mousedown', this.#outside, true);
    this.#items[0]?.focus();
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    const doc = this.#element.ownerDocument;
    doc.removeEventListener('mousedown', this.#outside, true);
    const hadFocus = this.#element.contains(doc.activeElement);
    this.#element.remove();
    if (hadFocus && this.#returnFocus instanceof HTMLElement && this.#returnFocus.isConnected) this.#returnFocus.focus();
  }

  #item(entry: Entry): HTMLButtonElement {
    const checkbox = entry.checked !== undefined;
    const onclick = () => {
      this.close();
      entry.run();
    };
    const check = html`<span class="dashica-wb__context-menu-check" aria-hidden="true">${entry.checked ? '✓' : ''}</span>`;
    // a space before the key: the entry's accessible name reads as words
    const key = entry.keybinding ? html.fragment` <kbd class="dashica-wb__context-menu-keybinding">${entry.keybinding}</kbd>` : null;
    const item = html<HTMLButtonElement>`<button type="button" class="dashica-wb__context-menu-item" tabindex="-1"
      role=${checkbox ? 'menuitemcheckbox' : 'menuitem'} aria-checked=${checkbox ? String(entry.checked) : null}
      onclick=${onclick}>${check}${entry.label}${key}</button>`;
    this.#items.push(item);
    return item;
  }

  readonly #outside = (event: MouseEvent): void => {
    if (!event.composedPath().includes(this.#element)) this.close();
  };

  #key(event: KeyboardEvent): void {
    const at = this.#items.indexOf(event.target as HTMLButtonElement);
    const count = this.#items.length;
    const next: Record<string, number> = { ArrowDown: at + 1, ArrowUp: at - 1 + count, Home: 0, End: count - 1 };
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      this.close();
    } else if (event.key in next && count > 0) {
      event.preventDefault();
      this.#items[next[event.key] % count].focus();
    }
  }

  #place(anchor: MenuAnchor): void {
    const view = this.#element.ownerDocument.defaultView;
    const point = anchor instanceof Element ? { x: anchor.getBoundingClientRect().left, y: anchor.getBoundingClientRect().bottom } : anchor;
    const maxX = Math.max(0, (view?.innerWidth ?? 0) - this.#element.offsetWidth);
    const maxY = Math.max(0, (view?.innerHeight ?? 0) - this.#element.offsetHeight);
    this.#element.style.left = `${Math.min(Math.max(point.x, 0), maxX)}px`;
    this.#element.style.top = `${Math.min(Math.max(point.y, 0), maxY)}px`;
  }
}

interface Entry {
  readonly label: string;
  readonly group?: string;
  readonly keybinding?: string;
  /** Checked or not for a checkbox entry; undefined for any other. */
  readonly checked?: boolean;
  run(): void;
}
