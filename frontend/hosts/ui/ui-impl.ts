// See UiApi in ui.ts.
import type { Disposable } from '../../core/disposable/disposable';
import type { CommandsHost, MenuContext, MenuItem } from '../commands/commands';
import type { Memento } from '../extension-host/extension-host';
import { Bar } from './bar/bar';
import { WindowLayout } from './layout/window-layout';
import { ContextMenu } from './menus/context-menu';
import { Menus } from './menus/menus';
import { QuickInput } from './quick-input/quick-input';
import type { BarPlacement, BottomPanelOptions, ContextMenuOptions, Panel, QuickPick, QuickPickItem, SidePanelOptions, UiApi } from './ui';
import './layout/window-layout.css';
import './menus/context-menu.css';
import './quick-input/quick-input.css';

/** The workbench's `UiApi`, laid out in `host`. `content`: the region the shown page goes into. */
export class UiHost implements UiApi {
  readonly #layout: WindowLayout;
  readonly #bars: Record<'title' | 'filter' | 'status', Bar>;
  readonly #menus: Menus;
  readonly #contextMenu: ContextMenu;
  readonly #quickInput: QuickInput;
  readonly onDidChangeMenu;

  constructor(host: HTMLElement, layoutState: Memento, commands: CommandsHost) {
    this.#layout = new WindowLayout(host, layoutState, commands);
    this.#bars = { title: new Bar(this.#layout.titleBar), filter: new Bar(this.#layout.filterBar), status: new Bar(this.#layout.statusBar) };
    this.#menus = new Menus(() => commands.getCommands());
    this.#contextMenu = new ContextMenu(host, this.#menus, commands);
    this.onDidChangeMenu = this.#menus.onDidChange;
    this.#quickInput = new QuickInput(host);
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

  registerMenuItem<C extends object = MenuContext>(menuId: string, item: MenuItem<C>): Disposable {
    return this.#menus.register(menuId, item);
  }

  getMenuItems<C extends object = MenuContext>(menuId: string, context?: C): readonly MenuItem<C>[] {
    return this.#menus.items(menuId, context);
  }

  showContextMenu(menuId: string, options: ContextMenuOptions): void {
    this.#contextMenu.show(menuId, options);
  }

  createQuickPick<T extends QuickPickItem>(): QuickPick<T> {
    return this.#quickInput.createQuickPick<T>();
  }

  dispose(): void {
    this.#quickInput.dispose();
    this.#contextMenu.dispose();
    this.#menus.dispose();
    this.#layout.dispose();
  }
}
