// See WidgetsApi in widgets.ts.
import { Table, tableFromArrays, tableToIPC } from 'apache-arrow';
import { vi } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { PageJson, WidgetNode } from '../../generated/zz_generated.dashica';
import { CommandsHost } from '../commands/commands';
import type { Extension, ExtensionContext, Memento } from '../extension-host/extension-host';
import type { PageApi, PoppedView } from '../page/page';
import { QueryHost, type QueryKey } from '../query/query';
import { UiHost, type ContextMenuOptions } from '../ui/ui';
import { WidgetsHost, type QueryResult, type RenderedWidget, type WidgetDecoration, type WidgetStatus } from './widgets';

/**
 * For the tests of a widget renderer: a `WidgetsHost` on a `UiHost`, widgets rendered with one `QueryHost` (as one
 * tab's), with the browser parts jsdom lacks stubbed. `activate` activates extensions on it (they get `widgets`,
 * `query`, `ui`, `commands` and `page`); `serve` answers a URL path (`/p/shop/api/1/query`) with an Arrow table or an
 * error; `scrollIntoView` makes every chart visible, `resize` sets every chart's width; `menus` are the context menus
 * shown. `dispose` in `afterEach`. For the tests of an extension that follows the active widget, `fakeWidget` is a
 * `RenderedWidget` whose status and decorations the test sets. `sqlEnabled` is `page.workbench`'s (default on); `keys`
 * are the query keys declared, as their extensions would (`[TIME, FILTERS]`).
 */
export function widgetTestbed({ sqlEnabled = true, keys = [] }: { sqlEnabled?: boolean; keys?: readonly QueryKey<unknown>[] } = {}) {
  history.replaceState(null, '', '/p/shop');
  const query = new QueryHost();
  for (const key of keys) query.declare(key);
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

/** A `RenderedWidget` whose status and decorations the test sets (`setStatus`, `setDecorations`), telling each change. */
export interface FakeWidget extends RenderedWidget {
  setStatus(status: WidgetStatus): void;
  setDecorations(decorations: readonly WidgetDecoration[]): void;
}

/** `widget` as rendered, with `url`, `status` (default: answered, 2 rows), `lastResult` (default none), no decorations. */
export function fakeWidget(
  widget: WidgetNode,
  { url = (path: string) => path, status = { kind: 'done', rows: 2, ms: 5 }, lastResult }: { url?: (path: string) => string; status?: WidgetStatus; lastResult?: QueryResult } = {},
): FakeWidget {
  const statusChanged = new EventEmitter<void>();
  const decorationsChanged = new EventEmitter<void>();
  let decorations: readonly WidgetDecoration[] = [];
  return {
    widget,
    url,
    lastResult,
    get status() {
      return status;
    },
    onDidChangeStatus: statusChanged.event,
    setStatus(changed) {
      status = changed;
      statusChanged.fire();
    },
    get decorations() {
      return decorations;
    },
    onDidChangeDecorations: decorationsChanged.event,
    setDecorations(changed) {
      decorations = changed;
      decorationsChanged.fire();
    },
  };
}
