import type { WidgetNode } from '../../generated/zz_generated.dashica';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { WidgetMenuContext } from '../../hosts/widgets/widgets';
import { chartTitle, renderExploreView, type ChartWithRows, type Perspective } from './view';
import './explore-view.css';

/**
 * The Explore view: "Open in Explore view" in a chart's menu (`widget/context`, charts with a `rowsUrl`) opens a new
 * tab with the chart's result in `<perspective-viewer>`, its config rebuilt from the chart's props, while the tab's
 * time range and filters keep working on it. With Explore enabled, "SQL" shows the chart's SQL as it runs, its
 * values written in; the viewer edits it and runs it (`#explore=3&xsql=…`), and the page's time range and filters no
 * longer apply until "Reset to the chart's query". The tab is the page kind `explore`, named in its hash: its URL is
 * the source tab's with `#explore=3` (the id in the chart's `dataUrl`), so it starts with a copy of that tab's query
 * state and a link or a reload opens it again; Back shows the state before, "Close" closes the tab. A click on a
 * group row's value of the chart's result selects it (`widget/selection`: "Filter by …"). Perspective loads on first
 * use (`loadPerspective`).
 */
export const exploreView: Extension = {
  id: 'exploreView',
  activate({ ui, page, widgets, commands, globalState, subscriptions }) {
    subscriptions.push(
      page.registerPageRenderer('explore', (el, shown, context) => {
        const id = new URLSearchParams(context.hash.slice(1)).get('explore') ?? '';
        const widget = findWidget(shown.widgets, id);
        if (!widget || !('rowsUrl' in widget) || !widget.rowsUrl) throw new Error(`${shown.title} has no chart ${id} to explore`);
        // an element of its own: as tall as the tab, whatever the page's element around it does with its content
        const host = el.appendChild(el.ownerDocument.createElement('div'));
        host.className = 'd-explore-view__host';
        const view = renderExploreView(host, {
          widget: widget as ChartWithRows,
          query: context.query,
          state: globalState,
          perspective: () => loadPerspective(el.ownerDocument, PERSPECTIVE_URL),
          hash: () => context.hash,
          onDidChangeHash: context.onDidChangeHash,
          navigate: (hash) => void page.navigate(hash),
          close: () => context.close(),
          select: (selection) => widgets.select({ kind: 'category', widgetId: id, ...selection }),
        });
        return {
          dispose: () => {
            view.dispose();
            host.remove();
          },
          title: `Explore: ${chartTitle(widget)}`,
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
      ui.registerMenuItem<WidgetMenuContext>('widget/context', {
        command: 'exploreView.openWidget',
        title: 'Open in Explore view',
        group: 'data',
        when: ({ widget }) => 'rowsUrl' in widget && !!widget.rowsUrl,
      }),
    );
  },
};

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
