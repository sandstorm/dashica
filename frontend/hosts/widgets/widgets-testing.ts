// See WidgetsApi in widgets.ts.
import { tableFromArrays, tableToIPC } from 'apache-arrow';
import { vi } from 'vitest';
import type { WidgetNode } from '../../generated/zz_generated.dashica';
import type { Extension, ExtensionContext } from '../extension-host/extension-host';
import { QueryHost } from '../query/query';
import type { ContextMenuOptions } from '../ui/ui';
import { WidgetsHost } from './widgets';

/**
 * For the tests of a widget renderer: a `WidgetsHost` on a `QueryHost`, with the browser parts jsdom lacks stubbed.
 * `activate` activates widget extensions on it (they get `widgets` and `query`); `serve` answers a URL path (`/p/shop/api/1/query`) with an Arrow table or an error; `scrollIntoView` makes every
 * chart visible, `resize` sets every chart's width; `menus` are the context menus shown. `dispose` in `afterEach`.
 */
export function widgetTestbed() {
  history.replaceState(null, '', '/p/shop');
  const query = new QueryHost(window);
  const menus: { menuId: string; options: ContextMenuOptions }[] = [];
  const widgets = new WidgetsHost(query, { showContextMenu: (menuId, options) => menus.push({ menuId, options }) });
  const answers = new Map<string, () => Response>();
  const requests: URL[] = [];
  const intersections: ((entries: { isIntersecting: boolean }[]) => void)[] = [];
  const resizes: ((entries: { contentRect: { width: number } }[]) => void)[] = [];

  vi.stubGlobal('fetch', async (url: string) => {
    const parsed = new URL(url, location.origin);
    requests.push(parsed);
    const answer = answers.get(parsed.pathname);
    return answer ? answer() : new Response('not found', { status: 404 });
  });
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        intersections.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: (entries: { contentRect: { width: number } }[]) => void) {
        resizes.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  query.load();

  return {
    query,
    widgets,
    menus,
    /** The URLs fetched, in order. */
    requests,
    /** Answers `path` with the Arrow table of `columns`, and `headers`. */
    serve(path: string, columns: Record<string, readonly unknown[]>, headers: Record<string, string> = {}) {
      answers.set(path, () => new Response(tableToIPC(tableFromArrays(columns)) as Uint8Array<ArrayBuffer>, { headers }));
    },
    /** Answers `path` with `status` and `text`. */
    serveText(path: string, text: string, status = 200) {
      answers.set(path, () => new Response(text, { status }));
    },
    activate(...extensions: Extension[]) {
      const context = { widgets, query, subscriptions: [] } as unknown as ExtensionContext;
      for (const extension of extensions) extension.activate(context);
    },
    /** Renders `widget` into a new element in the document. */
    render(widget: WidgetNode) {
      const el = document.body.appendChild(document.createElement('div'));
      const rendered = widgets.render(el, widget);
      return { el, rendered };
    },
    scrollIntoView() {
      for (const callback of intersections) callback([{ isIntersecting: true }]);
    },
    resize(width: number) {
      for (const callback of resizes) callback([{ contentRect: { width } }]);
    },
    dispose() {
      query.dispose();
      vi.unstubAllGlobals();
      document.body.replaceChildren();
      history.replaceState(null, '', '/');
    },
  };
}

/** Lets the pending fetches, Arrow decoding and draws finish. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}
