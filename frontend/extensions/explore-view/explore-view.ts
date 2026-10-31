import type { WidgetNode } from '../../generated/zz_generated.dashica';
import type { MenuItem } from '../../hosts/commands/commands';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { WidgetMenuContext } from '../../hosts/widgets/widgets';
import { editedQueryKeys, fetchSql, sqlRequest, type EditedQuery } from './rows';
import { chartTitle, renderExploreView, type ChartWithRows, type Perspective } from './view';
import './explore-view.css';

/**
 * The Explore view, only with Explore enabled (`workbench.json`'s `explore`, explore.enabled; else only "Explore"
 * greyed in the global menu, EXPLORE_NOT_ENABLED): "Open in Explore view" in a chart's menu (`widget/context`, charts
 * with a `rowsUrl`) opens a new tab with the chart's result in `<perspective-viewer>`, its config rebuilt from the chart's props, while the tab's time range and filters keep
 * working on it. "SQL" shows the chart's SQL as it runs, its placeholders kept and their values beside it; the viewer
 * edits it and runs it (`#explore=3&exploreSql=…`), and the page's time range and filters no longer apply until
 * "Reset to the chart's query". The tab is the page kind `explore`, named in its hash: its URL is
 * the source tab's with `#explore=3` (the id in the chart's `dataUrl`), so it starts with a copy of that tab's query
 * state and a link or a reload opens it again; Back shows the state before, "Close" closes the tab. A click on a
 * group row's value of the chart's result offers to filter the tab by it or exclude it. The global menu's "Explore"
 * opens a blank Explore in a new tab (`#explore=&connection=<name>`): a connection picker and an empty editor, run on
 * that connection (`/rows?connection=…`); its "Start from chart…" opens one with the SQL and parameters of a chart of
 * the shown page, run at once. Perspective loads on first use (`loadPerspective`).
 */
export const exploreView: Extension = {
  id: 'exploreView',
  activate({ ui, page, query, widgets, commands, globalState, subscriptions }) {
    if (!page.workbench.explore) {
      subscriptions.push(ui.registerMenuItem('workbench/global', EXPLORE_NOT_ENABLED));
      return;
    }
    subscriptions.push(
      page.registerPageRenderer('explore', (el, shown, context) => {
        const id = new URLSearchParams(context.hash.slice(1)).get('explore') ?? '';
        const widget = id === '' ? undefined : findWidget(shown.widgets, id);
        if (id !== '' && (!widget || !('rowsUrl' in widget) || !widget.rowsUrl)) throw new Error(`${shown.title} has no chart ${id} to explore`);
        // an element of its own: as tall as the tab, whatever the page's element around it does with its content
        const host = el.appendChild(el.ownerDocument.createElement('div'));
        host.className = 'd-explore-view__host';
        const view = renderExploreView(host, {
          widget: widget as ChartWithRows | undefined,
          connections: page.workbench.connections,
          query: context.query,
          state: globalState,
          perspective: () => loadPerspective(el.ownerDocument, PERSPECTIVE_URL),
          hash: () => context.hash,
          onDidChangeHash: context.onDidChangeHash,
          navigate: (hash) => void page.navigate(hash),
          close: () => context.close(),
          offerFilters: (at, candidates) => widget && widgets.offerFilters(at, candidates, context.query, widget as ChartWithRows),
        });
        return {
          dispose: () => {
            view.dispose();
            host.remove();
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
    const charts = () => chartsOf(page.current?.widgets ?? []);
    subscriptions.push(
      commands.registerCommand('exploreView.open', () =>
        page.navigate(blankExploreUrl(page.activeTab.url, charts()[0]?.connection ?? page.workbench.connections[0] ?? 'default'), { newTab: true }),
      ),
      commands.registerCommand('exploreView.startFromChart', async () => {
        const picked = await ui.showQuickPick(
          charts().map((chart) => ({ label: chartTitle(chart), description: chart.connection, chart })),
          { title: 'Start from chart', placeholder: 'The chart whose SQL the editor starts with' },
        );
        if (!picked) return;
        const { sql, parameters } = await fetchSql(sqlRequest(picked.chart.dataUrl, query.requestParams()));
        const connection = picked.chart.connection ?? page.workbench.connections[0] ?? 'default';
        return page.navigate(blankExploreUrl(page.activeTab.url, connection, sql === '' ? undefined : { sql, parameters }), { newTab: true });
      }),
      ui.registerMenuItem('workbench/global', { ...EXPLORE_ENTRY, tooltip: 'A blank Explore: SQL on a connection of dashica_config' }),
      ui.registerMenuItem('workbench/global', {
        command: 'exploreView.startFromChart',
        title: 'Start from chart…',
        group: 'explore',
        order: 1,
        enabled: () => charts().length > 0,
        tooltip: 'A blank Explore with the SQL of one of the shown page’s charts',
      }),
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

/** The global menu's "Explore": a blank Explore in a new tab (`exploreView.open`). */
const EXPLORE_ENTRY: MenuItem = { command: 'exploreView.open', title: 'Explore', group: 'explore' };

/** The global menu's only trace of the Explore view while it is not enabled: "Explore" greyed, its tooltip saying so. */
export const EXPLORE_NOT_ENABLED: MenuItem = {
  ...EXPLORE_ENTRY,
  enabled: () => false,
  tooltip: 'Explore is not enabled (explore.enabled)',
};

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
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = url.replace(/\.js$/, '.css');
    doc.head.append(link);
    const module: { explorePerspective: Perspective } = await import(/* @vite-ignore */ url);
    return module.explorePerspective;
  })();
  loaded.catch(() => (loaded = undefined));
  return loaded;
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
