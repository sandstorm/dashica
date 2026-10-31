import { Disposable } from '../core/disposable/disposable';
import type { WorkbenchJson } from '../generated/zz_generated.dashica';
import { CommandsHost } from '../hosts/commands/commands';
import { ExtensionHost, StorageMemento, type Extension } from '../hosts/extension-host/extension-host';
import { PageHost } from '../hosts/page/page';
import { adjacentTab } from '../hosts/page/tabs';
import { activeQuery } from '../hosts/query/query';
import { TabBar } from '../hosts/ui/layout/tab-bar';
import { UiHost } from '../hosts/ui/ui';
import { WidgetsHost } from '../hosts/widgets/widgets';

/**
 * The workbench in `host`: its hosts (commands, ui, page, query, widgets, extensions) and the extensions activated on
 * them, the tab bar with the commands `workbench.tabs.close` / `next` / `previous`, then the page of the URL in the
 * active tab. `workbench` is what `/workbench.json` says. Bound keys work anywhere on the page. Lives as long as the
 * page; `dispose` takes it all down (tests).
 */
export function createWorkbench(host: HTMLElement, options: { extensions: readonly Extension[]; workbench: WorkbenchJson }): Disposable {
  const doc = host.ownerDocument;
  const session = StorageMemento.of(doc, 'sessionStorage', 'dashica:workbench:');
  const commands = new CommandsHost(doc.documentElement);
  const ui = new UiHost(host, session, commands);
  const page = new PageHost(doc.defaultView!, options.workbench, ui.content, session);
  const query = activeQuery(page);
  const widgets = new WidgetsHost(ui);
  const extensions = new ExtensionHost({ commands, ui, page, query, widgets, ownerDocument: doc });
  extensions.activate(options.extensions);
  const tabs = showTabs(page, widgets, ui.tabBar, commands);
  void page.start();
  return new Disposable(() => {
    page.dispose();
    extensions.dispose();
    tabs.dispose();
    query.dispose();
    ui.dispose();
    commands.dispose();
  });
}

/**
 * The tab bar in `region`, drawn anew on each change of the tabs; a switch ends the selection. The tab commands work
 * on the active tab.
 */
function showTabs(page: PageHost, widgets: WidgetsHost, region: HTMLElement, commands: CommandsHost): Disposable {
  const bar = new TabBar(region, { onDidChoose: (id) => page.showTab(id), onDidClose: (id) => page.closeTab(id) });
  let shown = page.activeTab.id;
  const draw = () => {
    bar.update(page.tabs, page.activeTab.id);
    if (page.activeTab.id === shown) return;
    shown = page.activeTab.id;
    widgets.clearSelection();
  };
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
