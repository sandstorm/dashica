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
import { UiHost, type ContextMenuOptions } from '../ui/ui';
import { WidgetsHost, type RenderedWidget, type WidgetRecord, type WidgetStatus } from './widgets';

/**
 * For the tests of a widget renderer: a `WidgetsHost` on a `UiHost`, widgets rendered with one `QueryHost` (as one
 * tab's), with the browser parts jsdom lacks stubbed. `activate` activates extensions on it (they get `widgets`,
 * `query`, `ui`, `commands` and `page`); `serve` answers a URL path (`/p/shop/api/1/query`) with an Arrow table or an
 * error; `scrollIntoView` makes every chart visible, `resize` sets every chart's width; `menus` are the context menus
 * shown, `choices()` / `candidates()` / `choose` what `ctx.offerFilters` offers (in its quick pick "Filter"); every
 * `<dataUrl>/pill` answers a pill whose key names its field, op and value (`pill` gives the chip it adds).
 * `dispose` in `afterEach`. For the tests of an extension that follows the active widget, `fakeWidget` is a
 * `RenderedWidget` whose status and records the test sets.
 */
export function widgetTestbed() {
  history.replaceState(null, '', '/p/shop');
  const query = new QueryHost(window);
  const menus: { menuId: string; options: ContextMenuOptions }[] = [];
  const pageChanged = new EventEmitter<PageJson | undefined>();
  /** The views extensions popped out (`page.popOut`), in order. */
  const popped: PoppedView[] = [];
  const page: { current: PageJson | undefined } & Pick<PageApi, 'onDidChangePage' | 'popOut'> = {
    current: undefined,
    onDidChangePage: pageChanged.event,
    popOut: async (view) => void popped.push(view),
  };
  const workbench = document.body.appendChild(document.createElement('div'));
  const commands = new CommandsHost(workbench);
  const ui = new UiHost(workbench, { get: (_key: string, defaultValue?: unknown) => defaultValue, update: async () => {} } as Memento, commands);
  const widgets = new WidgetsHost({
    showContextMenu: (menuId, options) => menus.push({ menuId, options }),
    showQuickPick: (items, options) => ui.showQuickPick(items, options),
  }, { activeQuery: query, onDidChangeTabs: () => Disposable.from() });
  const filterOptions = () =>
    [...workbench.querySelectorAll<HTMLElement>('.d-workbench__quick-pick[aria-label="Filter"] [role=option]')].map((el) => ({
      el,
      label: `${el.querySelector('[role=img]')?.getAttribute('aria-label') ?? ''} ${el.textContent?.trim()}`.trim(),
    }));
  const answers = new Map<string, () => Response>();
  const requests: URL[] = [];
  const intersections: ((entries: { isIntersecting: boolean }[]) => void)[] = [];
  const resizes: ((entries: { contentRect: { width: number } }[]) => void)[] = [];

  vi.stubGlobal('fetch', async (url: string) => {
    const parsed = new URL(url, location.origin);
    requests.push(parsed);
    const answer = answers.get(parsed.pathname);
    if (!answer && parsed.pathname.endsWith('/pill')) {
      const [field, op, value] = ['field', 'op', 'value'].map((key) => parsed.searchParams.get(key) ?? '');
      return Response.json(fakePill(field, op, value));
    }
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
    /** What `ctx.offerFilters` offers, as its icon and label read ("Filter status = 500", "Exclude status = 500"); `[]` while it offers none. */
    choices: () => filterOptions().map(({ label }) => label),
    /** The candidates `ctx.offerFilters` offers, each once ("status = 500"; each comes as "Filter …" and "Exclude …"). */
    candidates: () => [...new Set(filterOptions().map(({ el }) => el.textContent?.trim()))],
    /** Chooses what `ctx.offerFilters` offers as `label` ("Exclude status = 500"), as a click does; resolves once its filter is added. */
    async choose(label: string) {
      const options = filterOptions();
      const option = options.find((candidate) => candidate.label === label);
      if (!option) throw new Error(`no choice ${label} among ${options.map((candidate) => candidate.label).join(', ')}`);
      option.el.click();
      await settle();
    },
    /** The chip a choice of `field` `op` `value` adds: the pill `<dataUrl>/pill` answers here. */
    pill: (field: string, op: 'eq' | 'ne', value: string) => ({ kind: 'pill' as const, ...fakePill(field, op, value) }),
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

/** The pill the testbed's `/pill` answers: a key that is no signed one, and the label the server writes. */
function fakePill(field: string, op: string, value: string): { key: string; label: string } {
  return { key: `test-pill:${field}:${op}:${value}`, label: `${field} ${op === 'ne' ? '≠' : '='} ${value}` };
}

/** Lets the pending fetches, Arrow decoding and draws finish. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** A `RenderedWidget` whose status and records the test sets (`setStatus`, `setRecords`), each telling its change. */
export interface FakeWidget extends RenderedWidget {
  setStatus(status: WidgetStatus): void;
  setRecords(records: readonly WidgetRecord[]): void;
}

/** `widget` as rendered, with `url` and `status` (default: answered, 2 rows) and no records yet. */
export function fakeWidget(widget: WidgetNode, { url = (path: string) => path, status = { kind: 'done', rows: 2, ms: 5, diagnostics: {} } }: { url?: (path: string) => string; status?: WidgetStatus } = {}): FakeWidget {
  const statusChanged = new EventEmitter<void>();
  const recordsChanged = new EventEmitter<void>();
  let records: readonly WidgetRecord[] = [];
  return {
    widget,
    url,
    lastResult: undefined,
    get status() {
      return status;
    },
    onDidChangeStatus: statusChanged.event,
    get records() {
      return records;
    },
    onDidChangeRecords: recordsChanged.event,
    setStatus(changed) {
      status = changed;
      statusChanged.fire();
    },
    setRecords(selected) {
      records = selected;
      recordsChanged.fire();
    },
  };
}
