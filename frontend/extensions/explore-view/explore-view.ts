import type { WidgetNode, WorkbenchJson } from '../../generated/zz_generated.dashica';
import type { CommandOptions, MenuItem } from '../../hosts/commands/commands';
import { QuickPickItemKind, type QuickPickItem, type QuickPickSeparator, type UiApi } from '../../hosts/ui/ui';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { WidgetMenuContext } from '../../hosts/widgets/widgets';
import { Schemas } from '../sql-library/schemas';
import { loadSqlEditors } from '../sql-library/sql-editor';
import { editedQueryKeys, fetchSql, sqlRequest, type EditedQuery } from './rows';
import { chartTitle, renderExploreView, type ChartWithRows, type Perspective } from './view';
import './explore-view.css';

/**
 * The Explore view, with Explore enabled (`workbench.json`'s `explore`, explore_enabled): "Open in Explore view" in a
 * chart's menu (`widget/context`, charts with a `rowsUrl`) opens a new tab with the chart's result in
 * `<perspective-viewer>`, its config rebuilt from the chart's props, the tab's time range and filters applying; "SQL"
 * shows the chart's SQL with its placeholders and their values, which the viewer edits and runs (`exploreSql`). The
 * tab is the page kind `explore`, its hash naming the chart on the source tab's URL (`#explore=3`, the id in its
 * `dataUrl`), so a link or a reload opens it again. The global menu's "Explore (from scratch)" opens a blank Explore on
 * a connection (`#explore=&connection=<name>`), "Explore (from chart…)" one with a chart's SQL (`menuCharts`). A click
 * on a group row shows the chart's data point menu. Perspective and the SQL editor load on first use. With Explore
 * off, the global menu shows "Explore" greyed (`EXPLORE_NOT_ENABLED`).
 */
export const exploreView: Extension = {
  id: 'exploreView',
  activate({ ui, page, query, commands, widgets, globalState, subscriptions }) {
    if (!page.workbench.explore) {
      subscriptions.push(commands.registerCommand(EXPLORE_ENTRY.command, () => {}, EXPLORE_NOT_ENABLED), ui.registerMenuItem('workbench/global', EXPLORE_ENTRY));
      return;
    }
    // the schemas the editors complete from, asked once per connection, shared by the Explore tabs
    const schemas = new Schemas();
    subscriptions.push(
      page.registerPageRenderer('explore', (pageContainer, shown, context) => {
        const id = new URLSearchParams(context.hash.slice(1)).get('explore') ?? '';
        const widget = id === '' ? undefined : findWidget(shown.widgets, id);
        if (id !== '' && (!widget || !('rowsUrl' in widget) || !widget.rowsUrl)) throw new Error(`${shown.title} has no chart ${id} to explore`);
        // an element of its own: as tall as the tab, whatever the page's element around it does with its content
        const hostContainer = pageContainer.appendChild(pageContainer.ownerDocument.createElement('div'));
        hostContainer.className = 'd-explore-view__host';
        const view = renderExploreView(hostContainer, {
          widget: widget as ChartWithRows | undefined,
          connections: page.workbench.connections,
          query: context.query,
          state: globalState,
          perspective: () => loadPerspective(pageContainer.ownerDocument, PERSPECTIVE_URL),
          sqlEditors: () => loadSqlEditors(),
          schema: (connection) => schemas.get(connection),
          hash: () => context.hash,
          onDidChangeHash: context.onDidChangeHash,
          navigate: (hash) => void page.navigate(hash),
          close: () => context.close(),
          // the chart is on another tab: its data point menu is shown for it as its menus are (`WidgetMenuContext`)
          showDataPointMenu: (at, dataPoints) =>
            widget &&
            widgets.showDataPointMenu({ widget, url: (path) => `${(widget as ChartWithRows).dataUrl}${path}?${context.query.requestParams()}`, lastResult: undefined }, at, dataPoints),
          confirmReset: (anchorElement) => confirmReset(ui, anchorElement),
        });
        return {
          dispose: () => {
            view.dispose();
            hostContainer.remove();
          },
          title: widget ? `Explore: ${chartTitle(widget)}` : chartTitle(undefined),
        };
      }),
    );
    subscriptions.push(
      commands.registerCommand('exploreView.openWidget', ({ widget }: WidgetMenuContext) => {
        if (!('dataUrl' in widget)) return;
        return page.navigate(exploreUrl(page.activeTab.url, widget.dataUrl.split('/').pop()!), { newTab: true });
      }),
    );
    subscriptions.push(
      commands.registerCommand('exploreView.open', () =>
        page.navigate(
          blankExploreUrl(page.activeTab.url, chartsOf(page.current?.widgets ?? [])[0]?.connection ?? page.workbench.connections[0] ?? 'default'),
          { newTab: true },
        ),
      ),
      commands.registerCommand(
        'exploreView.startFromChart',
        async () => {
          const picked = await ui.showQuickPick(menuCharts(page.workbench.menu, new URL(page.activeTab.url, location.origin).pathname), {
            title: 'Explore (from chart…)',
            placeholder: 'The chart whose SQL the editor starts with',
          });
          if (!picked) return;
          const { connection, sql, parameters } = await fetchSql(sqlRequest(picked.dataUrl, query.requestParams()));
          // a chart that did not run answers its connection with an empty SQL: an empty editor on that connection
          return page.navigate(blankExploreUrl(page.activeTab.url, connection, sql === '' ? undefined : { sql, parameters }), { newTab: true });
        },
        { enablement: () => menuCharts(page.workbench.menu, '').length > 0, disabledReason: 'No dashboard has a chart' },
      ),
      ui.registerMenuItem('workbench/global', EXPLORE_ENTRY),
      ui.registerMenuItem('workbench/global', { command: 'exploreView.startFromChart', title: 'Explore (from chart…)', group: 'explore', order: 1 }),
    );
    subscriptions.push(
      ui.registerMenuItem<WidgetMenuContext>('widget/context', {
        command: 'exploreView.openWidget',
        title: 'Open in Explore view',
        group: 'data',
        when: ({ widget }) => 'rowsUrl' in widget && !!widget.rowsUrl,
      }),
    );
  },
};

/**
 * The global menu's only trace of the Explore view while Explore is off: its command `exploreView.open`, always
 * disabled, so "Explore" shows greyed, its hover saying why.
 */
export const EXPLORE_NOT_ENABLED: CommandOptions = {
  enablement: () => false,
  disabledReason: 'Explore is not enabled (explore_enabled)',
};

/**
 * Asks in a menu below `anchorElement` (the view's "Reset"), under the question as its heading, whether to reset the
 * viewer's config; `true` once "Reset" was picked.
 */
export async function confirmReset(ui: Pick<UiApi, 'showQuickPick'>, anchorElement: Element): Promise<boolean> {
  const picked = await ui.showQuickPick(RESET_CHOICES, { title: 'Reset the view', anchor: anchorElement, menu: true });
  return picked?.reset === true;
}

/**
 * The URL of a blank Explore on the connection `connection` from the page at `url` (a tab's): its path and query, the
 * hash `#explore=&connection=<name>`, with the query `edited` (`exploreSql`, `param_<name>`) when given.
 */
export function blankExploreUrl(url: string, connection: string, edited?: EditedQuery): string {
  const hash = new URLSearchParams([['explore', ''], ['connection', connection], ...(edited ? editedQueryKeys(edited) : [])]);
  return `${url.replace(/#.*$/, '')}#${hash}`;
}

/** The URL of the Explore view of the chart `id` on the page at `url` (a tab's): its path and query, the hash `#explore=<id>`. */
export function exploreUrl(url: string, id: string): string {
  return `${url.replace(/#.*$/, '')}#explore=${encodeURIComponent(id)}`;
}

/** Where the build puts the Perspective bundle (frontendBuild.mjs), beside index.js. */
export const PERSPECTIVE_URL = '/public/dist/perspective.js';

let loaded: Promise<Perspective> | undefined;

/** The Perspective bundle at `url` (and its stylesheet beside it), loaded once for the page. */
export function loadPerspective(doc: Document, url: string): Promise<Perspective> {
  loaded ??= (async () => {
    const linkElement = doc.createElement('link');
    linkElement.rel = 'stylesheet';
    linkElement.href = url.replace(/\.js$/, '.css');
    doc.head.append(linkElement);
    const module: { explorePerspective: Perspective } = await import(/* @vite-ignore */ url);
    return module.explorePerspective;
  })();
  loaded.catch(() => (loaded = undefined));
  return loaded;
}

/**
 * "Explore (from chart…)"'s items: the charts with rows (a `rowsUrl`) in the outlines of `workbench.json`'s `menu`,
 * each its title, its dashboard and collapsible group beside it ("Oekokiste overview › Orders"); the charts of the
 * dashboard at `shownPath` ("/p/shop") first, then the others in menu order.
 */
export function menuCharts(menu: WorkbenchJson['menu'], shownPath: string): (QuickPickItem & { readonly dataUrl: string })[] {
  const entries = menu.flatMap((group) => group.entries);
  return [...entries.filter((entry) => entry.url === shownPath), ...entries.filter((entry) => entry.url !== shownPath)].flatMap((entry) =>
    entry.outline
      .filter((chart) => chart.rowsUrl)
      .map((chart) => ({ label: chart.title, description: [entry.title, chart.group].filter(Boolean).join(' › '), dataUrl: chart.dataUrl })),
  );
}

/** The charts among `widgets` and their children that serve their rows to the view (a `rowsUrl`), in page order. */
export function chartsOf(widgets: readonly WidgetNode[]): ChartWithRows[] {
  return widgets.flatMap((widget): ChartWithRows[] => [
    ...('rowsUrl' in widget && widget.rowsUrl ? [widget as ChartWithRows] : []),
    ...chartsOf('children' in widget && widget.children ? Object.values(widget.children) : []),
  ]);
}

/** The widget among `widgets` and their children whose `dataUrl` ends in `/<id>`. */
export function findWidget(widgets: readonly WidgetNode[], id: string): WidgetNode | undefined {
  for (const widget of widgets) {
    if ('dataUrl' in widget && widget.dataUrl.split('/').pop() === id) return widget;
    const children = 'children' in widget && widget.children ? Object.values(widget.children) : [];
    const found = findWidget(children, id);
    if (found) return found;
  }
  return undefined;
}

/** The global menu's "Explore (from scratch)": a blank Explore in a new tab (`exploreView.open`). */
const EXPLORE_ENTRY: MenuItem = { command: 'exploreView.open', title: 'Explore (from scratch)', group: 'explore' };

/** The question, "Reset" and "Cancel" of `confirmReset`. */
const RESET_CHOICES: readonly ((QuickPickItem & { readonly reset: boolean }) | QuickPickSeparator)[] = [
  { kind: QuickPickItemKind.Separator, label: 'Reset the viewer’s config?' },
  { label: 'Reset', detail: 'The viewer’s config back to its start; what was changed in it is forgotten', reset: true },
  { label: 'Cancel', reset: false },
];
