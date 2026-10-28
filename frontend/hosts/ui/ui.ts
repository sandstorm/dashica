import type { Disposable } from '../../core/disposable/disposable';
import type { Event } from '../../core/event-emitter/event-emitter';
import type { MenuContext, MenuItem } from '../commands/commands';

/**
 * The workbench's regions as extensions fill them (side panels left and right, panels below the content, items in
 * the title bar, the filter bar and the status bar) and its menus. Each panel has a command `workbench.view.<id>`: it shows and
 * focuses the panel, or hides it while it is shown and has the focus. Sizes and the panels picked are remembered for
 * the browser session.
 */
export interface UiApi {
  /** Adds a side panel with its rail button on `options.side`; one panel per side shows at a time. Ids are unique across all panels. */
  registerSidePanel(id: string, options: SidePanelOptions): Panel;
  /** Adds a panel below the content with its tab; one shows at a time. */
  registerBottomPanel(id: string, options: BottomPanelOptions): Panel;
  /** Puts `element` into `bar` where `placement` says, until disposed; a bar shows while it has an item. */
  registerBarItem(bar: 'title' | 'filter' | 'status', element: HTMLElement, placement: BarPlacement): Disposable;
  /**
   * Adds `item` to the menu `menuId` until disposed. A menu is only an id; whoever shows it documents its context `C`
   * and its arguments, e.g. `dashboards/entry`: `{ url, title }` of a dashboard entry, its URL as the argument.
   */
  registerMenuItem<C extends object = MenuContext>(menuId: string, item: MenuItem<C>): Disposable;
  /** The entries of `menuId` whose `when` holds in `context`: `navigation` first, the other groups by name, by `order`. */
  getMenuItems<C extends object = MenuContext>(menuId: string, context?: C): readonly MenuItem<C>[];
  /** Fires with a menu's id when its entries change. */
  readonly onDidChangeMenu: Event<string>;
  /**
   * Pops up the menu `menuId` at `options.anchor`; nothing while no entry applies. Choosing an entry runs its command
   * with `options.args`, after the menu closed and gave the focus back. One at a time: a new menu closes the open one;
   * so do Escape and a press elsewhere.
   */
  showContextMenu(menuId: string, options: ContextMenuOptions): void;
  /**
   * A quick pick its owner drives: a box at the top in the middle of the workbench with the items the owner sets as
   * the text changes. Hidden until `show`; one box at a time (a new one hides the open one).
   */
  createQuickPick<T extends QuickPickItem>(): QuickPick<T>;
}

export interface ContextMenuOptions {
  /** Where the menu opens: below an element, or at a point (a right click's `clientX` / `clientY`). */
  readonly anchor: MenuAnchor;
  /** The menu's accessible name ("Wetell"). */
  readonly title: string;
  /** What `when` and `toggled` are asked with. */
  readonly context?: object;
  /** What a chosen entry's command is run with. */
  readonly args?: readonly unknown[];
}

export type MenuAnchor = Element | { readonly x: number; readonly y: number };

/** A row of a quick pick. */
export interface QuickPickItem {
  /** What the item is called ("Wetell"). */
  readonly label: string;
  /** Less prominent, after the label ("Customers"). */
  readonly description?: string;
  /** Less prominent, on a line of its own. */
  readonly detail?: string;
  /** The characters marked where the typed text matched. */
  readonly highlights?: QuickPickHighlights;
  /** The key that does the same, as people read it (`⌘K`), at the row's end. */
  readonly keybinding?: string;
}

/** The [start, end) offsets of the characters to mark in an item's texts. */
export interface QuickPickHighlights {
  readonly label?: readonly (readonly [number, number])[];
  readonly description?: readonly (readonly [number, number])[];
  readonly detail?: readonly (readonly [number, number])[];
}

/** What `QuickPickSeparator.kind` says. */
export const QuickPickItemKind = { Separator: -1, Default: 0 } as const;

/** A heading starting a group of a quick pick's items ("Dashboards"), with a note after it ("12 more"). */
export interface QuickPickSeparator {
  readonly kind: typeof QuickPickItemKind.Separator;
  readonly label: string;
  readonly description?: string;
}

/**
 * A quick pick its owner drives: it shows `items` as they are (the owner filters and marks them as `value` changes)
 * and tells what the viewer does. Picking an item (Enter, a click) fires `onDidAccept` with it in `selectedItems`; the
 * box stays until `hide`. Escape, a press outside or another box hide it.
 */
export interface QuickPick<T extends QuickPickItem> {
  /** The box's accessible name. */
  title: string | undefined;
  /** Shown in the empty field. */
  placeholder: string | undefined;
  /** The text in the field; setting it fires `onDidChangeValue`. */
  value: string;
  /** A line below the list, e.g. how to narrow the search. */
  prompt: string | undefined;
  /** The rows, the first item active; without any item (and text typed) "No results", unless `busy`. */
  items: readonly (T | QuickPickSeparator)[];
  /** Items are still coming: a progress line. */
  busy: boolean;
  /** The item picked last. */
  readonly selectedItems: readonly T[];
  readonly onDidChangeValue: Event<string>;
  readonly onDidAccept: Event<void>;
  /** The box is gone, the focus back where it was. */
  readonly onDidHide: Event<void>;
  /** Shows the box (hiding an open one) and focuses its field. */
  show(): void;
  /** Hides the box; it can be shown again. */
  hide(): void;
  /** Hides it for good. */
  dispose(): void;
}

export interface SidePanelOptions {
  /** The rail button's tooltip and accessible name. */
  label: string;
  /** The rail button's icon: SVG markup, drawn in `currentColor`. */
  icon: string;
  /** Default `'left'`. */
  side?: 'left' | 'right';
  /** The rail's group: `'top'` (the default) or `'bottom'`, at the rail's far end. */
  alignment?: 'top' | 'bottom';
  /** The place among the buttons of its side and group (lower first; equal: registration order); default 0. */
  order?: number;
}

export interface BottomPanelOptions {
  /** The tab's text. */
  label: string;
  /** The place among the tabs (lower first; equal: registration order); default 0. */
  order?: number;
}

/** A registered panel: the element its content goes into, how it opens, and whether it is shown. */
export interface Panel {
  readonly body: HTMLElement;
  /** Shown now (also as the narrow workbench's overlay); an unavailable panel is hidden. */
  readonly visible: boolean;
  /** Fires when `visible` changes, e.g. to work for the panel only while it is seen. */
  readonly onDidChangeVisibility: Event<void>;
  /** Shows it unless the viewer picked another panel of its region (or closed the region) this session. */
  setDefault(open: boolean): void;
  /** Shows or removes it and its button altogether. */
  setAvailable(available: boolean): void;
  /** Shows it as the viewer's pick, and focuses it unless `preserveFocus`; while it is unavailable, nothing. */
  show(preserveFocus?: boolean): void;
  /** Closes its region while it shows this panel. */
  hide(): void;
  /** Closes it while it lies over the content (the narrow workbench's left side), e.g. after a dashboard was chosen. */
  dismiss(): void;
  dispose(): void;
}

/** Where a bar item goes: `left` from the bar's start, `center` in its middle, `right` at its end; the higher `priority` further left. */
export interface BarPlacement {
  readonly alignment: 'left' | 'center' | 'right';
  readonly priority?: number;
}

export { UiHost } from './ui-impl';
