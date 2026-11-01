import { html } from 'htl';
import { Ellipsis, createElement } from 'lucide';
import { Disposable } from '../core/disposable/disposable';
import type { WorkbenchJson } from '../generated/zz_generated.dashica';
import { CommandsHost } from '../hosts/commands/commands';
import { ExtensionHost, StorageMemento, type Extension } from '../hosts/extension-host/extension-host';
import { PageHost } from '../hosts/page/page';
import { adjacentTab } from '../hosts/page/tabs';
import { activeQuery } from '../hosts/query/query';
import { UiHost } from '../hosts/ui/ui';
import { WidgetsHost } from '../hosts/widgets/widgets';
import { TabBar } from './tab-bar';

/**
 * The workbench in `hostContainer`: its hosts (commands, ui, page, query, widgets, extensions) and the extensions
 * activated on them, the tab bar with the commands `workbench.tabs.close` / `next` / `previous`, the global menu's "…"
 * at the start of the left rail, then the page of the URL in the active tab. While the active tab shows a popped-out
 * view, the top bar has only the tabs and there is no filter bar (`showPageBars`). `workbench` is what
 * `/workbench.json` says. Bound keys work anywhere on the page. Lives as long as the page; `dispose` takes it all down
 * (tests).
 */
export function createWorkbench(hostContainer: HTMLElement, options: { extensions: readonly Extension[]; workbench: WorkbenchJson }): Disposable {
  const doc = hostContainer.ownerDocument;
  const session = StorageMemento.of(doc, 'sessionStorage', 'dashica:workbench:');
  const commands = new CommandsHost(doc.documentElement);
  const ui = new UiHost(hostContainer, session, commands);
  const page = new PageHost(doc.defaultView!, options.workbench, ui.contentContainer, session);
  const query = activeQuery(page);
  const widgets = new WidgetsHost(ui, commands, page);
  const extensions = new ExtensionHost({ commands, ui, page, query, widgets, ownerDocument: doc });
  extensions.activate(options.extensions);
  const tabs = showTabs(page, ui.tabBarContainer, commands);
  const globalMenu = showGlobalMenu(ui);
  const pageBars = page.onDidChangeTabs(() => ui.showPageBars(!page.showsPoppedView));
  void page.start();
  return new Disposable(() => {
    page.dispose();
    extensions.dispose();
    tabs.dispose();
    globalMenu.dispose();
    pageBars.dispose();
    widgets.dispose();
    query.dispose();
    ui.dispose();
    commands.dispose();
  });
}

/**
 * The tab bar in `regionContainer`, drawn anew on each change of the tabs; "+" opens the start page in a new tab (or
 * shows the tab that has it). The tab commands work on the active tab.
 */
function showTabs(page: PageHost, regionContainer: HTMLElement, commands: CommandsHost): Disposable {
  const bar = new TabBar(regionContainer, {
    onDidChoose: (id) => page.showTab(id),
    onDidClose: (id) => page.closeTab(id),
    onDidAdd: () => void page.navigate('/', { newTab: true }),
  });
  const draw = () => bar.update(page.tabs, page.activeTab.id);
  draw();
  commands.declareCommands([
    { command: 'workbench.tabs.close', title: 'Close tab', category: 'Tabs' },
    { command: 'workbench.tabs.next', title: 'Next tab', category: 'Tabs' },
    { command: 'workbench.tabs.previous', title: 'Previous tab', category: 'Tabs' },
  ]);
  return Disposable.from(
    bar,
    page.onDidChangeTabs(draw),
    commands.registerCommand('workbench.tabs.close', () => page.closeTab(page.activeTab.id)),
    commands.registerCommand('workbench.tabs.next', () => page.showTab(adjacentTab(page.tabs, page.activeTab.id, 1))),
    commands.registerCommand('workbench.tabs.previous', () => page.showTab(adjacentTab(page.tabs, page.activeTab.id, -1))),
  );
}

/** The menu the "…" at the left rail's start shows (context and arguments none); the button is hidden while it is empty. */
const GLOBAL_MENU = 'workbench/global';

/** The "…" at the left rail's start, above search everywhere. */
function showGlobalMenu(ui: UiHost): Disposable {
  const menuButtonElement: HTMLButtonElement = html`<button type="button" class="d-workbench__rail-button" aria-label="Dashica menu" title="Menu"
    aria-haspopup="dialog" data-testid="wb-global-menu" onclick=${() => ui.showContextMenu(GLOBAL_MENU, { anchor: menuButtonElement, title: 'Dashica' })}></button>`;
  menuButtonElement.append(createElement(Ellipsis, { width: 16, height: 16 }));
  const update = () => (menuButtonElement.hidden = ui.getMenuItems(GLOBAL_MENU).length === 0);
  update();
  ui.railStartContainer.append(menuButtonElement);
  return Disposable.from(
    new Disposable(() => menuButtonElement.remove()),
    ui.onDidChangeMenu((id) => id === GLOBAL_MENU && update()),
  );
}
