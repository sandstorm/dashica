// See WindowApi in ../window.ts.

import type { Panel, SidePanelOptions, BottomPanelOptions } from '../window';
import type { Memento } from '../../extension-host/extension-host';
import { BottomPanel } from './bottom-panel';
import { html } from 'htl';
import { restoreSideBarState, SideBar, type PanelCommands, type Side } from './side-bar';

/**
 * The workbench's regions in one grid: the title bar and the filter bar above everything; the left side (a rail with a
 * button per side panel and the shown panel); the content with the bottom panel below it; the right side (the shown
 * panel and its rail, on the outer edge); the status bar below everything. Each side shows one panel at a time; clicking
 * the shown one's rail button hides the side and the content takes the room. Sizes and the panels picked are
 * remembered for the session.
 *
 * While the workbench is narrower than 720px the left side's panel lies over the content and closes on Escape, a click
 * outside, or `dismiss()` (e.g. after a dashboard was chosen in it).
 */
export class WindowLayout {
  readonly titleBar: HTMLElement;
  readonly filterBar: HTMLElement;
  readonly content: HTMLElement;
  readonly statusBar: HTMLElement;
  readonly #sides: Record<Side, SideBar>;
  readonly #bottom: BottomPanel;
  readonly #center: HTMLElement;
  readonly #cleanup: (() => void)[] = [];

  constructor(
    private readonly host: HTMLElement,
    /** Where the layout keeps its state for the browser session (key `layout`). */
    memento: Memento,
    /** Where each panel's command `workbench.view.<id>` goes, and the keys its button names. */
    commands: PanelCommands,
  ) {
    const saved = memento.get<unknown>('layout');
    const save = () => void memento.update('layout', { left: this.#sides.left.state, right: this.#sides.right.state, bottom: this.#bottom.state });
    this.#sides = {
      left: new SideBar(host, 'left', restoreSideBarState(saved, 'left'), { save, commands }),
      right: new SideBar(host, 'right', restoreSideBarState(saved, 'right'), { save, commands }),
    };
    this.#bottom = new BottomPanel(host, BottomPanel.restoreState(saved), { save, commands });
    this.titleBar = html`<div class="dashica-wb__title-bar" data-testid="wb-title-bar"></div>`;
    this.filterBar = html`<div class="dashica-wb__filter-bar" data-testid="wb-filter-bar"></div>`;
    this.content = html`<div class="dashica-wb__content"></div>`;
    this.#center = html`<div class="dashica-wb__center">${this.content}${this.#bottom.element}</div>`;
    this.statusBar = html`<div class="dashica-wb__status-bar"></div>`;
    host.classList.add('dashica-wb');
    host.append(this.titleBar, this.filterBar, this.#sides.left.element, this.#center, this.#sides.right.element, this.statusBar);
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

  /** Adds bottom panel `id` with its tab, among the others by `options.order`, and its command `workbench.view.<id>`. */
  addBottomPanel(id: string, options: BottomPanelOptions): Panel {
    this.#refuseTaken(id);
    return this.#bottom.addPanel(id, options);
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
    this.#bottom.dispose();
    this.titleBar.remove();
    this.filterBar.remove();
    this.#center.remove();
    this.statusBar.remove();
    this.host.classList.remove('dashica-wb', 'dashica-wb--narrow');
  }

  #refuseTaken(id: string): void {
    if (this.#sides.left.has(id) || this.#sides.right.has(id) || this.#bottom.has(id)) throw new Error(`There is a panel ${id} already`);
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
      this.host.classList.toggle('dashica-wb--narrow', narrow);
      this.#sides.left.setOverlay(narrow);
    });
    observer.observe(this.host);
    this.#cleanup.push(() => observer.disconnect());
  }
}

/** Below this workbench width the left side's open panel lies over the content instead of beside it. */
const NARROW = 720;
