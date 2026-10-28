import type { Disposable } from '../../core/disposable/disposable';
import type { Event } from '../../core/event-emitter/event-emitter';

/**
 * The workbench's regions as extensions fill them: side panels left and right, panels below the content, and items in
 * the title bar, the filter bar and the status bar. Each panel has a command `workbench.view.<id>`: it shows and
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
