// See UiApi in ../ui.ts.

import type { Disposable } from '../../../core/disposable/disposable';
import type { Panel, RailButtonOptions, SidePanelOptions } from '../ui';
import type { Memento } from '../../extension-host/extension-host';
import { html } from 'htl';
import { restoreSideBarState, SideBar, type PanelCommands, type PanelMenus, type Side } from './side-bar';

/**
 * The workbench's regions in one grid: the left side (a rail with the global menu's "…" at its start, a button per side
 * panel and per command put there, and the shown panel), full height above the status bar; in the middle the top bar
 * (its items around the tab bar), the filter bar and the content; the right side (the shown panel and its rail, on the
 * outer edge), full height as well; the status bar below everything. Each side shows one panel at a time;
 * clicking the shown one's rail button hides the side and the content takes the room. Sizes and the panels picked are
 * remembered for the session.
 *
 * While the workbench is narrower than 720px the left side's panel lies over the content and closes on Escape, a click
 * outside, or `dismiss()` (e.g. after a dashboard was chosen in it).
 */
export class WindowLayout {
  readonly topBar: HTMLElement;
  /** In the top bar, between its left and its other items: where the tab bar (`TabBar`) goes. */
  readonly tabBar: HTMLElement;
  /** The left rail's start, above its buttons: where the global menu's "…" goes. */
  readonly railStart: HTMLElement;
  readonly filterBar: HTMLElement;
  readonly content: HTMLElement;
  readonly statusBar: HTMLElement;
  readonly #sides: Record<Side, SideBar>;
  readonly #center: HTMLElement;
  readonly #cleanup: (() => void)[] = [];

  constructor(
    private readonly host: HTMLElement,
    /** Where the layout keeps its state for the browser session (key `layout`). */
    memento: Memento,
    /** Where each panel's commands `workbench.view.<id>` go, what rail buttons run, and the keys buttons name. */
    commands: PanelCommands,
    /** Where each panel's menu `panel/<id>` gets "Hide", and how its "…" shows it. */
    menus: PanelMenus,
  ) {
    const saved = memento.get<unknown>('layout');
    const save = () => void memento.update('layout', { left: this.#sides.left.state, right: this.#sides.right.state });
    this.#sides = {
      left: new SideBar(host, 'left', restoreSideBarState(saved, 'left'), { save, commands, menus }),
      right: new SideBar(host, 'right', restoreSideBarState(saved, 'right'), { save, commands, menus }),
    };
    this.tabBar = html`<div class="d-workbench__tab-bar" data-testid="wb-tab-bar"></div>`;
    this.topBar = html`<div class="d-workbench__top-bar" data-testid="wb-top-bar">${this.tabBar}</div>`;
    this.filterBar = html`<div class="d-workbench__filter-bar" data-testid="wb-filter-bar"></div>`;
    this.content = html`<div class="d-workbench__content"></div>`;
    this.#center = html`<div class="d-workbench__center">${this.topBar}${this.filterBar}${this.content}</div>`;
    this.statusBar = html`<div class="d-workbench__status-bar"></div>`;
    this.railStart = this.#sides.left.railStart;
    host.classList.add('d-workbench');
    host.append(this.#sides.left.element, this.#center, this.#sides.right.element, this.statusBar);
    this.#watchWidth();
  }

  /**
   * Adds side panel `id` with its rail button on `options.side` (default left), in the rail's top or bottom group
   * (`options.alignment`, default top), among the others there by `options.order` (lower first; equal: registration
   * order), and its command `workbench.view.<id>`.
   */
  addSidePanel(id: string, options: SidePanelOptions): Panel {
    this.#refuseTaken(id);
    return this.#sides[options.side ?? 'left'].addPanel(id, options);
  }

  /** Adds a button running `options.command` to the rail of `options.side` (default left), placed as a panel's. */
  addRailButton(id: string, options: RailButtonOptions): Disposable {
    return this.#sides[options.side ?? 'left'].addButton(id, options);
  }

  /**
   * The panel `side` shows until the viewer picks one (null: the side starts hidden), before the panels' own
   * `setDefault`; undefined: none named.
   */
  setDefaultPanel(side: Side, id: string | null | undefined): void {
    this.#sides[side].setDefaultPanel(id);
  }

  dispose(): void {
    for (const stop of this.#cleanup) stop();
    this.#sides.left.dispose();
    this.#sides.right.dispose();
    this.#center.remove();
    this.statusBar.remove();
    this.host.classList.remove('d-workbench', 'd-workbench--narrow');
  }

  #refuseTaken(id: string): void {
    if (this.#sides.left.has(id) || this.#sides.right.has(id)) throw new Error(`There is a panel ${id} already`);
  }

  /** Narrow or not, from the workbench's width (ResizeObserver; without it the workbench counts as wide). */
  #watchWidth(): void {
    const view = this.host.ownerDocument.defaultView;
    if (!view?.ResizeObserver) return;
    let narrow = false;
    const observer = new view.ResizeObserver(() => {
      const now = this.host.clientWidth > 0 && this.host.clientWidth < NARROW;
      if (now === narrow) return;
      narrow = now;
      this.host.classList.toggle('d-workbench--narrow', narrow);
      this.#sides.left.setOverlay(narrow);
    });
    observer.observe(this.host);
    this.#cleanup.push(() => observer.disconnect());
  }
}

/** Below this workbench width the left side's open panel lies over the content instead of beside it. */
const NARROW = 720;
