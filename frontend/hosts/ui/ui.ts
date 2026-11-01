import type { CancellationToken } from '../../core/cancellation/cancellation';
import type { Disposable } from '../../core/disposable/disposable';
import type { Event } from '../../core/event-emitter/event-emitter';
import type { MenuContext, MenuItem } from '../commands/commands';

/**
 * The workbench's regions as extensions fill them (side panels left and right and command buttons in their rails,
 * items in the top bar around the tabs, the filter bar and the status bar), its menus, its quick inputs, and what
 * search everywhere finds. Each panel has a command `workbench.view.<id>`: it shows and focuses the panel, or hides it
 * while it is shown and has the focus; its header's "…" shows its menu `panel/<id>` (context and arguments none), which
 * has "Hide". The "…" at the left rail's start shows the menu `workbench/global` (context and arguments none) and is
 * hidden while it is empty. Sizes and the panels picked are remembered for the browser session.
 */
export interface UiApi {
  /** Adds a side panel with its rail button on `options.side`; one panel per side shows at a time. Ids are unique across all panels. */
  registerSidePanel(id: string, options: SidePanelOptions): Panel;
  /** Adds a button running `options.command` to the rail of `options.side`, until disposed; its tooltip names the command's key. */
  registerRailButton(id: string, options: RailButtonOptions): Disposable;
  /**
   * Puts `itemElement` into `bar` where `placement` says, until disposed; a bar shows while it has an item (the top bar
   * always: it holds the tabs, its `left` items before them, `center` and `right` ones after them).
   */
  registerBarItem(bar: 'top' | 'filter' | 'status', itemElement: HTMLElement, placement: BarPlacement): Disposable;
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
   * Pops up the menu `menuId` at `options.anchor`, its entries in the quick pick as a menu (`QuickPickOptions.menu`);
   * nothing while no entry applies (an open box hides). Choosing an entry runs its command with `options.args`, after the box closed
   * and gave the focus back. One box at a time: a new one closes the open one; so do Escape and a press elsewhere.
   */
  showContextMenu(menuId: string, options: ContextMenuOptions): void;
  /**
   * Shows `items` in a quick pick at `options.anchor` (else at the top in the middle of the workbench); typing narrows
   * them (fuzzily, by label, else description, else both read as one), a heading shows while an item of its group does. Resolves with the
   * item picked, once the box is gone and the focus back, or `undefined` when it was hidden without (Escape, a press
   * elsewhere, another box). Items still to come (a Promise, as a server's answer) open the box at once, busy (its
   * progress line, no "No results") until they are there; when they fail the box hides and the returned Promise
   * rejects with their error; a menu's that turn out none hide it, resolving with `undefined`. With `options.accept` the box stays open while it runs (`QuickPickOptions.accept`). As VS
   * Code's `window.showQuickPick`.
   */
  showQuickPick<T extends QuickPickItem>(items: QuickPickItems<T>, options?: QuickPickOptions<T>): Promise<T | undefined>;
  /**
   * Asks for a text in a box at `options.anchor` (else at the top in the middle), `options.validateInput`'s message
   * below the field: resolves with it on Enter (unless that message is an error; with `options.accept` once that
   * succeeded), once the box is gone and the focus back, or `undefined` when it was hidden without. As VS Code's
   * `window.showInputBox`.
   */
  showInputBox(options?: InputBoxOptions): Promise<string | undefined>;
  /**
   * A quick pick its owner drives: a box at its `anchor` (else at the top in the middle of the workbench) with the
   * items the owner sets as the text changes. Hidden until `show`; one box at a time (a new one hides the open one).
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

export type MenuAnchor = Element | { readonly x: number; readonly y: number };

/** What `showQuickPick` shows: the items (and headings), or a Promise of them. */
export type QuickPickItems<T extends QuickPickItem> = readonly (T | QuickPickSeparator)[] | Promise<readonly (T | QuickPickSeparator)[]>;

/** Where and how `showQuickPick` shows its box, and what choosing an item does before it closes. */
export interface QuickPickOptions<T extends QuickPickItem = QuickPickItem> {
  /** The box's accessible name ("Filter"). */
  readonly title?: string;
  /** Shown in the empty field. */
  readonly placeholder?: string;
  /** Where the box opens: below an element, or at a point (a click's `clientX` / `clientY`); else at the top in the middle. */
  readonly anchor?: MenuAnchor;
  /**
   * A menu (a context menu, a short choice): a plain list without a field in sight, the arrow keys and Enter working
   * at once; a first letter typed makes the first item starting with it active, more letters show the field and narrow
   * as usual. The element it is anchored at (its opener) is `aria-expanded` and tinted while it is open. Else (a
   * picker: "Add filter", search everywhere) the field shows from the start.
   */
  readonly menu?: boolean;
  /**
   * What choosing `item` does, a request to the server (a chart's `/pill`): the box stays open and busy until it
   * settles; resolved, the box hides and `showQuickPick` resolves with the item; rejected, the box stays, its message
   * line shows the error's message, and the viewer can choose again or hide the box.
   */
  readonly accept?: (item: T) => Promise<unknown>;
}

/** Where and how `showInputBox` shows its box. */
export interface InputBoxOptions {
  /** The box's accessible name ("Parameter value"). */
  readonly title?: string;
  /** A line below the field, e.g. what the text is for. */
  readonly prompt?: string;
  /** Shown in the empty field. */
  readonly placeholder?: string;
  /** The text in the field at first. */
  readonly value?: string;
  /** The part of `value` selected at first, as [start, end) offsets; else all of it. As VS Code's. */
  readonly valueSelection?: readonly [number, number];
  /**
   * Checks the text when the box shows, as it is typed and on Enter; what it says shows below the field. An `Error`
   * message says what is wrong, and Enter does nothing; an `Info` message only tells (the condition a filter button's
   * value makes); `undefined` that all is fine.
   */
  readonly validateInput?: (value: string) => InputBoxValidationMessage | undefined;
  /** Where the box opens, as `QuickPickOptions.anchor`. */
  readonly anchor?: MenuAnchor;
  /** What Enter does with the text, as `QuickPickOptions.accept`: busy until it settles, its error below the field. */
  readonly accept?: (value: string) => Promise<unknown>;
  /**
   * A field of its own in place of the one-line text field (a SQL editor, `showSqlInputBox` in sql-library); its maker
   * gives it its text and placeholder, so `value` and `placeholder` are not used, and disposes it once the box resolved.
   */
  readonly field?: InputBoxField;
}

/**
 * A field `showInputBox` shows in place of its text field: the box focuses it, describes its `inputElement` by its
 * message and prompt, takes its text on `onDidAccept` (Escape and a press elsewhere hide the box as usual) and checks
 * it on `onDidChangeValue`. A key the field takes itself (its completion's Escape) is default prevented, so the box
 * leaves it.
 */
export interface InputBoxField {
  /** What the box shows, its message below it. */
  readonly fieldElement: HTMLElement;
  /** The element the keys go to (its role `textbox`): named, described and marked `aria-invalid` by the box. */
  readonly inputElement: HTMLElement;
  /** The text in it. */
  readonly value: string;
  /** Selects [start, end) of its text. */
  select(start: number, end: number): void;
  focus(): void;
  /** Fires on each change of its text. */
  readonly onDidChangeValue: Event<void>;
  /** Fires when its own key takes the text (Enter, unless its completion took the key). */
  readonly onDidAccept: Event<void>;
}

/** What `InputBoxOptions.validateInput` says of a text, and whether it lets Enter through (`severity`). */
export interface InputBoxValidationMessage {
  readonly message: string;
  readonly severity: InputBoxValidationSeverity;
}

/** How a validation message counts: `Info` lets Enter through, `Error` does not. VS Code's values. */
export const InputBoxValidationSeverity = { Info: 1, Error: 3 } as const;

export type InputBoxValidationSeverity = (typeof InputBoxValidationSeverity)[keyof typeof InputBoxValidationSeverity];

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
  /** In front of the label: SVG markup, drawn in `currentColor`, with its accessible name (`Filter`). */
  readonly icon?: QuickPickIcon;
  /** An item that is on or off (a menu's toggled entry): a check mark in front while on; `undefined` for any other. */
  readonly checked?: boolean;
  /** Shown greyed; choosing it does nothing (a menu's entry whose command cannot run now). */
  readonly disabled?: boolean;
  /** Shown on hover over the item. */
  readonly tooltip?: string;
}

/** An item's icon: what it shows and what it says to a screen reader. */
export interface QuickPickIcon {
  readonly svg: string;
  readonly label: string;
}

/** The [start, end) offsets of the characters to mark in an item's texts. */
export interface QuickPickHighlights {
  readonly label?: readonly (readonly [number, number])[];
  readonly description?: readonly (readonly [number, number])[];
  readonly detail?: readonly (readonly [number, number])[];
}

/** What `QuickPickSeparator.kind` says. */
export const QuickPickItemKind = { Separator: -1, Default: 0 } as const;

/**
 * A heading starting a group of a quick pick's items ("Dashboards"), with a note after it ("12 more"); without a label
 * only a line between the groups (a menu's).
 */
export interface QuickPickSeparator {
  readonly kind: typeof QuickPickItemKind.Separator;
  readonly label?: string;
  readonly description?: string;
}

/**
 * A quick pick its owner drives: it shows `items` as they are (the owner filters and marks them as `value` changes) and
 * tells what the viewer does. Picking an item (Enter, a click, either with Cmd / Ctrl) fires `onDidAccept` with it in
 * `selectedItems`; the box stays until `hide`. Escape, a press outside or another box hide it.
 */
export interface QuickPick<T extends QuickPickItem> {
  /** The box's accessible name. */
  title: string | undefined;
  /** Where the box opens, as `QuickPickOptions.anchor`; read on `show`. */
  anchor: MenuAnchor | undefined;
  /** Shown as a menu, as `QuickPickOptions.menu`; read on `show`. `onDidChangeValue` fires once the field shows. */
  menu: boolean;
  /** Shown in the empty field. */
  placeholder: string | undefined;
  /** The text in the field; setting it fires `onDidChangeValue`. */
  value: string;
  /** A line below the list, e.g. how to narrow the search. */
  prompt: string | undefined;
  /** An error line below the field, e.g. what the server said to a choice (`QuickPickOptions.accept`); none: hidden. */
  message: string | undefined;
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

/** A rail button that runs a command (search everywhere's). */
export interface RailButtonOptions {
  /** The button's tooltip (with the command's key) and accessible name. */
  label: string;
  /** SVG markup, drawn in `currentColor`. */
  icon: string;
  /** Run without arguments on a click. */
  command: string;
  /** Default `'left'`. */
  side?: 'left' | 'right';
  /** As `SidePanelOptions.alignment`. */
  alignment?: 'top' | 'bottom';
  /** The place among the side's buttons, panels' included (lower first; equal: registration order); default 0. */
  order?: number;
}

/** A registered panel: the element its content goes into, how it opens, and whether it is shown. */
export interface Panel {
  readonly bodyContainer: HTMLElement;
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
