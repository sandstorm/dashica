// See WindowApi in window.ts.
import type { Disposable } from '../../core/disposable/disposable';
import type { Memento } from '../extension-host/extension-host';
import { Bar } from './bar/bar';
import { WindowLayout } from './layout/window-layout';
import type { PanelCommands } from './layout/side-bar';
import type { BarPlacement, BottomPanelOptions, Panel, SidePanelOptions, WindowApi } from './window';
import './layout/window-layout.css';

/** The workbench's `WindowApi`, laid out in `host`. `content`: the region the shown page goes into. */
export class WindowHost implements WindowApi {
  readonly #layout: WindowLayout;
  readonly #bars: Record<'title' | 'filter' | 'status', Bar>;

  constructor(host: HTMLElement, layoutState: Memento, commands: PanelCommands) {
    this.#layout = new WindowLayout(host, layoutState, commands);
    this.#bars = { title: new Bar(this.#layout.titleBar), filter: new Bar(this.#layout.filterBar), status: new Bar(this.#layout.statusBar) };
  }

  get content(): HTMLElement {
    return this.#layout.content;
  }

  registerSidePanel(id: string, options: SidePanelOptions): Panel {
    return this.#layout.addSidePanel(id, options);
  }

  registerBottomPanel(id: string, options: BottomPanelOptions): Panel {
    return this.#layout.addBottomPanel(id, options);
  }

  registerBarItem(bar: 'title' | 'filter' | 'status', element: HTMLElement, placement: BarPlacement): Disposable {
    return this.#bars[bar].add(element, placement);
  }

  dispose(): void {
    this.#layout.dispose();
  }
}
