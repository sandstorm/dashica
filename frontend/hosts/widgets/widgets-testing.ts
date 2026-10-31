// See WidgetsApi in widgets.ts.
import { Table, tableFromArrays, tableToIPC } from 'apache-arrow';
import { vi } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { PageJson, WidgetNode } from '../../generated/zz_generated.dashica';
import { CommandsHost } from '../commands/commands';
import type { Extension, ExtensionContext, Memento } from '../extension-host/extension-host';
import type { PageApi, PoppedView } from '../page/page';
import { QueryHost } from '../query/query';
import { UiHost, type ContextMenuOptions, type MenuAnchor } from '../ui/ui';
import { WidgetsHost, type FilterCandidate, type PillSource, type RenderedWidget, type WidgetStatus } from './widgets';

/**
 * For the tests of a widget renderer: a `WidgetsHost` on a `UiHost`, widgets rendered with one `QueryHost` (as one
 * tab's), with the browser parts jsdom lacks stubbed. `activate` activates extensions on it (they get `widgets`,
 * `query`, `ui`, `commands` and `page`); `serve` answers a URL path (`/p/shop/api/1/query`) with an Arrow table or an
 * error; `scrollIntoView` makes every chart visible, `resize` sets every chart's width; `menus` are the context menus
 * shown, `offers` the runs of `filters.offer` (a click's point, its candidates, the widget's pills), which the
 * testbed registers in place of the `filters` extension. `dispose` in `afterEach`. For the tests of an extension that follows the active widget, `fakeWidget` is a
 * `RenderedWidget` whose status the test sets. `sqlEnabled` is `page.workbench`'s (default on).
 */
export function widgetTestbed({ sqlEnabled = true }: { sqlEnabled?: boolean } = {}) {
  history.replaceState(null, '', '/p/shop');
  const query = new QueryHost(window);
  const menus: { menuId: string; options: ContextMenuOptions }[] = [];
  const pageChanged = new EventEmitter<PageJson | undefined>();
  /** The views extensions popped out (`page.popOut`), in order. */
  const popped: PoppedView[] = [];
  const page: { current: PageJson | undefined } & Pick<PageApi, 'onDidChangePage' | 'popOut' | 'workbench'> = {
    current: undefined,
    workbench: { menu: [], explore: false, sqlEnabled, connections: [] },
    onDidChangePage: pageChanged.event,
    popOut: async (view) => void popped.push(view),
  };
  const workbench = document.body.appendChild(document.createElement('div'));
  const commands = new CommandsHost(workbench);
  const ui = new UiHost(workbench, { get: (_key: string, defaultValue?: unknown) => defaultValue, update: async () => {} } as Memento, commands);
  const widgets = new WidgetsHost({ showContextMenu: (menuId, options) => menus.push({ menuId, options }) }, { activeQuery: query, onDidChangeTabs: () => Disposable.from() });
  const offers: { at: MenuAnchor; candidates: readonly FilterCandidate[]; source: PillSource }[] = [];
  const offering = commands.registerCommand('filters.offer', (at: MenuAnchor, candidates: readonly FilterCandidate[], source: PillSource) => void offers.push({ at, candidates, source }));
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
    ui,
    commands,
    menus,
    /** The runs of `filters.offer`, in order: what each click offered (`{ at, candidates, source }`). */
    offers,
    /** The page shown, for the extensions that read it. */
    page,
    /** The views popped out into a tab (`page.popOut`). */
    popped,
    /** The URLs fetched, in order. */
    requests,
    /** Answers `path` with the Arrow table of `columns` (a Table for list or map columns), and `headers`. */
    serve(path: string, columns: Record<string, readonly unknown[]> | Table, headers: Record<string, string> = {}) {
      const table = columns instanceof Table ? columns : tableFromArrays(columns);
      answers.set(path, () => new Response(tableToIPC(table) as Uint8Array<ArrayBuffer>, { headers }));
    },
    /** Answers `path` with 204 and `headers`: a chart that did not run. */
    serveNothing(path: string, headers: Record<string, string>) {
      answers.set(path, () => new Response(null, { status: 204, headers }));
    },
    /** Answers `path` with `status` and `text`. */
    serveText(path: string, text: string, status = 200) {
      answers.set(path, () => new Response(text, { status }));
    },
    activate(...extensions: Extension[]) {
      const context = { widgets, query, ui, commands, page, subscriptions: [] } as unknown as ExtensionContext;
      for (const extension of extensions) extension.activate(context);
    },
    /** Renders `widget` into a new element in the document. */
    render(widget: WidgetNode) {
      const el = document.body.appendChild(document.createElement('div'));
      const rendered = widgets.render(el, widget, query);
      return { el, rendered };
    },
    scrollIntoView() {
      for (const callback of intersections) callback([{ isIntersecting: true }]);
    },
    resize(width: number) {
      for (const callback of resizes) callback([{ contentRect: { width } }]);
    },
    dispose() {
      offering.dispose();
      widgets.dispose();
      query.dispose();
      ui.dispose();
      commands.dispose();
      pageChanged.dispose();
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

/** A `RenderedWidget` whose status the test sets (`setStatus`), telling its change. */
export interface FakeWidget extends RenderedWidget {
  setStatus(status: WidgetStatus): void;
}

/** `widget` as rendered, with `url` and `status` (default: answered, 2 rows). */
export function fakeWidget(widget: WidgetNode, { url = (path: string) => path, status = { kind: 'done', rows: 2, ms: 5, diagnostics: {} } }: { url?: (path: string) => string; status?: WidgetStatus } = {}): FakeWidget {
  const statusChanged = new EventEmitter<void>();
  return {
    widget,
    url,
    lastResult: undefined,
    get status() {
      return status;
    },
    onDidChangeStatus: statusChanged.event,
    setStatus(changed) {
      status = changed;
      statusChanged.fire();
    },
  };
}
