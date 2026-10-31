import { Disposable } from '../../core/disposable/disposable';
import type { WidgetNode } from '../../generated/zz_generated.dashica';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { WidgetMenuContext } from '../../hosts/widgets/widgets';
import { renderExploreView, type ChartWithRows, type Perspective } from './view';
import './explore-view.css';

/**
 * The Explore view: "Open in Explore view" in a chart's menu (`widget/context`, charts with a `rowsUrl`) lays the
 * chart's result in `<perspective-viewer>` over the content, its config rebuilt from the chart's props, while the
 * page's time range and filters keep working on it; "Remove grouping" shows the chart's original rows instead where
 * the server allows it (Explore enabled, a builder query). The view is the page's hash (`/p/shop#explore=3`, the id
 * in the chart's `dataUrl`), so a link opens it and Back closes it; "Close" goes to the chart (`#w=3`). A click on a
 * group row's value selects it (`widget/selection`: "Filter by …"). Perspective loads on first use (`loadPerspective`).
 */
export const exploreView: Extension = {
  id: 'exploreView',
  activate({ ui, page, query, widgets, commands, globalState, subscriptions }) {
    const browserWindow = window;
    let shown: { widget: WidgetNode; view: Disposable } | undefined;
    const close = () => {
      shown?.view.dispose();
      shown = undefined;
    };
    const sync = () => {
      const id = new URLSearchParams(browserWindow.location.hash.slice(1)).get('explore');
      const widget = id && page.current ? findWidget(page.current.widgets, id) : undefined;
      if (widget === shown?.widget) return;
      close();
      if (!widget || !('rowsUrl' in widget) || !widget.rowsUrl) return;
      const el = browserWindow.document.createElement('div');
      el.className = 'd-explore-view__host';
      const over = ui.showOverContent(el);
      const view = renderExploreView(el, {
        widget: widget as ChartWithRows,
        query,
        state: globalState,
        perspective: () => loadPerspective(browserWindow.document, PERSPECTIVE_URL),
        close: () => void page.navigate(`#w=${encodeURIComponent(id!)}`),
        select: (selection) => widgets.select({ kind: 'category', widgetId: id!, ...selection }),
      });
      shown = { widget, view: Disposable.from(view, over) };
    };
    browserWindow.addEventListener('hashchange', sync);
    subscriptions.push({ dispose: () => browserWindow.removeEventListener('hashchange', sync) });
    subscriptions.push(page.onDidChangePage(sync));
    subscriptions.push({ dispose: close });
    subscriptions.push(
      commands.registerCommand('exploreView.openWidget', ({ widget }: WidgetMenuContext) => {
        if (!('dataUrl' in widget)) return;
        return page.navigate(`#explore=${encodeURIComponent(widget.dataUrl.split('/').pop()!)}`);
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
