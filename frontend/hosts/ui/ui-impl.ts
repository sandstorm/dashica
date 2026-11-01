// See UiApi in ui.ts.
import { Disposable } from '../../core/disposable/disposable';
import type { CommandsHost, MenuContext, MenuItem } from '../commands/commands';
import type { Memento } from '../extension-host/extension-host';
import { Bar } from './bar/bar';
import { WindowLayout } from './layout/window-layout';
import { ContextMenu } from './menus/context-menu';
import { Menus } from './menus/menus';
import { Notifications } from './notifications/notifications';
import { QuickInput } from './quick-input/quick-input';
import type {
  BarPlacement,
  ContextMenuOptions,
  InputBoxOptions,
  Panel,
  QuickPick,
  RailButtonOptions,
  QuickPickItem,
  QuickPickOptions,
  QuickPickItems,
  SearchProvider,
  SidePanelOptions,
  UiApi,
} from './ui';
import './layout/window-layout.css';
import './quick-input/quick-input.css';

/**
 * The workbench's `UiApi`, laid out in `hostContainer`. `contentContainer`: the region the tabs' pages go into;
 * `tabBarContainer`: the tab bar's; `railStartContainer`: the global menu's "…", at the left rail's start.
 */
export class UiHost implements UiApi {
  readonly #layout: WindowLayout;
  readonly #bars: Record<'top' | 'filter' | 'status', Bar>;
  readonly #menus: Menus;
  readonly #contextMenu: ContextMenu;
  readonly #quickInput: QuickInput;
  readonly #notifications: Notifications;
  readonly #searchProviders = new Set<SearchProvider>();
  readonly onDidChangeMenu;

  constructor(hostContainer: HTMLElement, layoutState: Memento, commands: CommandsHost) {
    this.#menus = new Menus(() => commands.getCommands());
    this.#quickInput = new QuickInput(hostContainer);
    this.#notifications = new Notifications(hostContainer);
    this.#contextMenu = new ContextMenu(this.#quickInput, this.#menus, commands);
    this.#layout = new WindowLayout(hostContainer, layoutState, commands, this);
    this.#bars = {
      top: new Bar(this.#layout.topBarContainer, this.#layout.tabBarContainer),
      filter: new Bar(this.#layout.filterBarContainer),
      status: new Bar(this.#layout.statusBarContainer),
    };
    this.onDidChangeMenu = this.#menus.onDidChange;
  }

  get contentContainer(): HTMLElement {
    return this.#layout.contentContainer;
  }

  get tabBarContainer(): HTMLElement {
    return this.#layout.tabBarContainer;
  }

  get railStartContainer(): HTMLElement {
    return this.#layout.railStartContainer;
  }

  /**
   * Shows the items of the top bar and the filter bar, or hides them while the active tab shows a popped-out view:
   * what it shows does not follow the tab's query state, which those items set.
   */
  showPageBars(shown: boolean): void {
    this.#bars.top.withhold(!shown);
    this.#bars.filter.withhold(!shown);
  }

  registerSidePanel(id: string, options: SidePanelOptions): Panel {
    return this.#layout.addSidePanel(id, options);
  }

  registerRailButton(id: string, options: RailButtonOptions): Disposable {
    return this.#layout.addRailButton(id, options);
  }

  registerBarItem(bar: 'top' | 'filter' | 'status', itemElement: HTMLElement, placement: BarPlacement): Disposable {
    return this.#bars[bar].add(itemElement, placement);
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

  showQuickPick<T extends QuickPickItem>(items: QuickPickItems<T>, options?: QuickPickOptions): Promise<T | undefined> {
    return this.#quickInput.showQuickPick(items, options);
  }

  showInputBox(options?: InputBoxOptions): Promise<string | undefined> {
    return this.#quickInput.showInputBox(options);
  }

  createQuickPick<T extends QuickPickItem>(): QuickPick<T> {
    return this.#quickInput.createQuickPick<T>();
  }

  showErrorMessage(message: string): Promise<void> {
    return this.#notifications.showError(message);
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
    this.#notifications.dispose();
    this.#menus.dispose();
    this.#layout.dispose();
  }
}
