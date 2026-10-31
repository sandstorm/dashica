import type { CancellationToken } from '../../core/cancellation/cancellation';
import type { Disposable } from '../../core/disposable/disposable';
import type { Event } from '../../core/event-emitter/event-emitter';
import type { MenuContext, MenuItem } from '../commands/commands';

/**
 * The workbench's regions as extensions fill them (side panels left and right, items in the title bar, the filter
 * bar and the status bar), its menus, and what search everywhere finds. Each panel has a command `workbench.view.<id>`: it shows and
 * focuses the panel, or hides it while it is shown and has the focus. Sizes and the panels picked are remembered for
 * the browser session.
 */
export interface UiApi {
  /** Adds a side panel with its rail button on `options.side`; one panel per side shows at a time. Ids are unique across all panels. */
  registerSidePanel(id: string, options: SidePanelOptions): Panel;
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
   * Pops up `entries` at `options.anchor` as `showContextMenu` pops up a menu's, for entries of the moment (a chart's
   * categories to select); without entries it changes nothing, the open menu stays. Choosing one calls its `run`, after the menu closed and gave the
   * focus back.
   */
  showChoices(entries: readonly Choice[], options: Pick<ContextMenuOptions, 'anchor' | 'title'>): void;
  /**
   * Adds the floating bar `options.id` until disposed: a row of the entries of the menu `options.id`, which its owner
   * shows for a context (`show`) at what `options.anchor` gives for it, above it, or below it where there is no room.
   * It takes no focus and stays until its owner hides it, while the page around it keeps working; it follows its
   * anchor when the page scrolls or resizes. Choosing an entry runs its command with the context. Hidden while the
   * anchor is `null` or no entry applies.
   */
  registerFloatingBar<C extends object>(options: FloatingBarOptions<C>): FloatingBar<C>;
  /**
   * A quick pick its owner drives: a box at the top in the middle of the workbench with the items the owner sets as
   * the text changes. Hidden until `show`; one box at a time (a new one hides the open one).
   */
  createQuickPick<T extends QuickPickItem>(): QuickPick<T>;
  /** Adds what `provider` finds to search everywhere, as a group of its own under `provider.label`, until disposed; `provider.id` is unique. */
  registerSearchProvider(provider: SearchProvider): Disposable;
  /** The search providers registered now, in registration order. */
  getSearchProviders(): readonly SearchProvider[];
}

/** One kind of thing search everywhere finds (dashboards, commands, …), shown as a group of its own. */
export interface SearchProvider {
  /** `<extension>.<name>`, unique. */
  readonly id: string;
  /** The group's heading ("Dashboards"), and its name in the prefix hint. */
  readonly label: string;
  /** Typed first (`>`), narrows the search to the providers with this prefix, and they show more results. */
  readonly prefix?: string;
  /** The group's place (lower first; default 100; equal: by `id`). */
  readonly order?: number;
  /**
   * The items for `query` (the text after the prefix, trimmed; '' at first), asked again whenever it changes. Items
   * without `highlights` are matched fuzzily against their label, else their description: return every candidate.
   * Items with `highlights` were matched by the provider and are shown as they are, in its order. May be async: check
   * `token` between steps and stop once it is cancelled (the viewer typed on, or closed the search).
   */
  provideItems(query: string, token: CancellationToken): readonly SearchItem[] | Promise<readonly SearchItem[]>;
}

/** A result of search everywhere: what it shows, and what picking it does. */
export interface SearchItem extends QuickPickItem {
  /**
   * Opens, runs or applies what the item stands for; called once the search is closed and the focus is back.
   * `newTab`: picked with Cmd / Ctrl, a page opens in a new tab.
   */
  accept(options?: { readonly newTab?: boolean }): void | Promise<unknown>;
}

export interface ContextMenuOptions {
  /** Where the menu opens: below an element, or at a point (a right click's `clientX` / `clientY`). */
  readonly anchor: MenuAnchor;
  /** The menu's accessible name ("Shop"). */
  readonly title: string;
  /** What `when` and `toggled` are asked with. */
  readonly context?: object;
  /** What a chosen entry's command is run with. */
  readonly args?: readonly unknown[];
}

/** An entry of `showChoices`. */
export interface Choice {
  /** What it says ("instance = web-1"). */
  readonly label: string;
  run(): void;
}

export type MenuAnchor = Element | { readonly x: number; readonly y: number };

export interface FloatingBarOptions<C extends object> {
  /** Its menu's id (`widget/selection`), unique among the floating bars. */
  readonly id: string;
  /** The bar's accessible name ("Selection"). */
  readonly title: string;
  /** Where it lies when two bars overlap: the higher order on top; default 0. */
  readonly order?: number;
  /** Where `context` is in the viewport (a selected bar's box); `null` while it is gone. Asked on `show`, on scrolling and resizing. */
  anchor(context: C): DOMRect | null;
}

/** A floating bar its owner shows for a context, as `UiApi.registerFloatingBar` says. */
export interface FloatingBar<C extends object> {
  /** Shows the bar for `context` with the entries whose `when` holds in it; moves it there while it shows another. */
  show(context: C): void;
  hide(): void;
  /** Hides it for good. */
  dispose(): void;
}

/** How an item of a quick pick was picked. */
export interface QuickPickAccept {
  /** With Cmd / Ctrl held: what it opens goes into a new tab. */
  readonly newTab: boolean;
}

/** A row of a quick pick. */
export interface QuickPickItem {
  /** What the item is called ("Shop"). */
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
 * and tells what the viewer does. Picking an item (Enter, a click, either with Cmd / Ctrl) fires `onDidAccept` with it in `selectedItems`; the
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
  readonly onDidAccept: Event<QuickPickAccept>;
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
export { createView, type ViewOptions } from './views/view';
