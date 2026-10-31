// See UiApi in ui.ts.
import { Disposable } from '../../core/disposable/disposable';
import type { CommandsHost, MenuContext, MenuItem } from '../commands/commands';
import type { Memento } from '../extension-host/extension-host';
import { Bar } from './bar/bar';
import { WindowLayout } from './layout/window-layout';
import { ContextMenu } from './menus/context-menu';
import { Menus } from './menus/menus';
import { QuickInput } from './quick-input/quick-input';
import type {
  BarPlacement,
  ContextMenuOptions,
  InputBoxOptions,
  Panel,
  QuickPick,
  QuickPickItem,
  QuickPickOptions,
  QuickPickSeparator,
  SearchProvider,
  SidePanelOptions,
  UiApi,
} from './ui';
import './layout/window-layout.css';
import './quick-input/quick-input.css';

/** The workbench's `UiApi`, laid out in `host`. `content`: the region the tabs' pages go into; `tabBar`: the tab bar's. */
export class UiHost implements UiApi {
  readonly #layout: WindowLayout;
  readonly #bars: Record<'title' | 'filter' | 'status', Bar>;
  readonly #menus: Menus;
  readonly #contextMenu: ContextMenu;
  readonly #quickInput: QuickInput;
  readonly #searchProviders = new Set<SearchProvider>();
  readonly onDidChangeMenu;

  constructor(host: HTMLElement, layoutState: Memento, commands: CommandsHost) {
    this.#layout = new WindowLayout(host, layoutState, commands);
    this.#bars = { title: new Bar(this.#layout.titleBar), filter: new Bar(this.#layout.filterBar), status: new Bar(this.#layout.statusBar) };
    this.#menus = new Menus(() => commands.getCommands());
    this.#quickInput = new QuickInput(host);
    this.#contextMenu = new ContextMenu(this.#quickInput, this.#menus, commands);
    this.onDidChangeMenu = this.#menus.onDidChange;
  }

  get content(): HTMLElement {
    return this.#layout.content;
  }

  get tabBar(): HTMLElement {
    return this.#layout.tabBar;
  }

  registerSidePanel(id: string, options: SidePanelOptions): Panel {
    return this.#layout.addSidePanel(id, options);
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

  showQuickPick<T extends QuickPickItem>(items: readonly (T | QuickPickSeparator)[], options?: QuickPickOptions): Promise<T | undefined> {
    return this.#quickInput.showQuickPick(items, options);
  }

  showInputBox(options?: InputBoxOptions): Promise<string | undefined> {
    return this.#quickInput.showInputBox(options);
  }

  createQuickPick<T extends QuickPickItem>(): QuickPick<T> {
    return this.#quickInput.createQuickPick<T>();
  }

  registerSearchProvider(provider: SearchProvider): Disposable {
    if (this.getSearchProviders().some((other) => other.id === provider.id)) throw new Error(`There is a search provider ${provider.id} already`);
    this.#searchProviders.add(provider);
    return new Disposable(() => this.#searchProviders.delete(provider));
  }

  getSearchProviders(): readonly SearchProvider[] {
    return [...this.#searchProviders];
  }

  dispose(): void {
    this.#searchProviders.clear();
    this.#quickInput.dispose();
    this.#menus.dispose();
    this.#layout.dispose();
  }
}
