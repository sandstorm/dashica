// @vitest-environment jsdom
// Tests for debug.ts: the panel following the active widget, asking /debug only while shown, its views, the status bar.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { PageJson } from '../../generated/zz_generated.dashica';
import type { ExtensionContext, Memento } from '../../hosts/extension-host/extension-host';
import type { ActiveWidget, WidgetStatus } from '../../hosts/widgets/widgets';
import { debug, statusParts } from './debug';

let body: HTMLElement;
let status: HTMLElement;
/** Whether the status bar holds Debug's item. */
let inStatusBar: boolean;
let page: { current: PageJson | undefined; changed: EventEmitter<PageJson | undefined> };
let panel: { visible: boolean; shown: number };
let visibility: EventEmitter<void>;
let activeChanged: EventEmitter<void>;
let active: ActiveWidget | undefined;
let runCommand: () => void;
let menuItems: { menuId: string; title?: string }[];
let requested: string[];

const memento: Memento = { get: (_key: string, defaultValue?: unknown) => defaultValue, update: async () => {} } as Memento;

beforeEach(() => {
  body = document.body.appendChild(document.createElement('div'));
  panel = { visible: false, shown: 0 };
  visibility = new EventEmitter<void>();
  activeChanged = new EventEmitter<void>();
  active = undefined;
  menuItems = [];
  requested = [];
  page = { current: undefined, changed: new EventEmitter<PageJson | undefined>() };
  vi.stubGlobal('fetch', async (url: string) => {
    requested.push(url);
    return new Response(
      JSON.stringify({
        query: 'SELECT count() FROM http_logs',
        explainPlan: 'ReadFromMergeTree (default.http_logs)',
        explainPipeline: '(Expression)',
        explainPipelineText: 'ExpressionTransform',
        explainSyntax: 'SELECT count() FROM http_logs',
        stats: { rows: 1 },
      }),
    );
  });
  const context = {
    subscriptions: [],
    globalState: memento,
    ui: {
      registerSidePanel: () => ({
        body,
        get visible() {
          return panel.visible;
        },
        onDidChangeVisibility: visibility.event,
        show: () => panel.shown++,
        dispose() {},
      }),
      registerBarItem: (_bar: string, element: HTMLElement) => {
        status = element;
        inStatusBar = true;
        return { dispose: () => (inStatusBar = false) };
      },
      registerMenuItem: (menuId: string, item: { title?: string }) => menuItems.push({ menuId, title: item.title }),
    },
    widgets: {
      get active() {
        return active;
      },
      onDidChangeActive: activeChanged.event,
    },
    page: {
      get current() {
        return page.current;
      },
      onDidChangePage: page.changed.event,
    },
    commands: { registerCommand: (_id: string, run: () => void) => (runCommand = run) },
  };
  debug.activate(context as unknown as ExtensionContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

/** Lets the pending fetches finish. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

function chart(widgetStatus: WidgetStatus, title = 'Requests'): ActiveWidget {
  return {
    widget: { type: 'timeBar', props: { title, x: { kind: 'expr', alias: 'time' }, y: { kind: 'expr', alias: 'value' } }, dataUrl: '/p/shop/api/1' } as ActiveWidget['widget'],
    url: (path) => `/p/shop/api/1${path}?time=24h`,
    lastResult: undefined,
    status: widgetStatus,
    records: [],
  };
}

const showPanel = () => {
  panel.visible = true;
  visibility.fire();
};

describe('debug', () => {
  it('is in the chart’s menu, which opens the panel', () => {
    expect(menuItems).toEqual([{ menuId: 'widget/context', title: 'Debug' }]);
    runCommand();
    expect(panel.shown).toBe(1);
  });

  it('asks nothing while hidden; shown without an active widget, it hints to click a chart', () => {
    active = chart({ kind: 'done', rows: 3, ms: 12, diagnostics: {} });
    activeChanged.fire();
    expect(requested).toEqual([]);
    active = undefined;
    showPanel();
    expect(body.textContent).toContain('Click a chart to see what it queried.');
  });

  it('shows the active widget’s query and EXPLAIN as views, and follows it', async () => {
    active = chart({ kind: 'done', rows: 3, ms: 12, diagnostics: {} });
    showPanel();
    await settle();
    expect(requested).toEqual(['/p/shop/api/1/debug?time=24h']);
    expect(body.querySelector('.d-debug__title')!.textContent).toBe('Requests');
    expect([...body.querySelectorAll('.d-view__title')].map((title) => title.textContent)).toEqual(['Query', 'Stats', 'EXPLAIN plan', 'Pipeline', 'Syntax', 'Result']);
    expect(body.querySelector('pre')!.textContent).toBe('SELECT count() FROM http_logs');
    expect(body.textContent).toContain('ReadFromMergeTree (default.http_logs)');
    expect(body.textContent).toContain('The chart has not queried yet.');

    // its query running again: kept; answered: asked again
    active = { ...active, status: { kind: 'loading' } };
    activeChanged.fire();
    expect(requested).toHaveLength(1);
    active = { ...active, status: { kind: 'done', rows: 4, ms: 9, diagnostics: {} } };
    activeChanged.fire();
    await settle();
    expect(requested).toHaveLength(2);

    // another widget, though still loading
    active = chart({ kind: 'loading' }, 'Errors');
    activeChanged.fire();
    await settle();
    expect(requested).toHaveLength(3);
    expect(body.querySelector('.d-debug__title')!.textContent).toBe('Errors');

    // hidden: nothing more
    panel.visible = false;
    visibility.fire();
    active = chart({ kind: 'done', rows: 1, ms: 5, diagnostics: {} }, 'Hosts');
    activeChanged.fire();
    expect(requested).toHaveLength(3);
  });

  it('asks nothing again when only the shown widget’s records change', async () => {
    active = chart({ kind: 'done', rows: 3, ms: 12, diagnostics: {} });
    showPanel();
    await settle();
    expect(requested).toHaveLength(1);
    const drawn = body.querySelector('.d-debug');
    active = { ...active, records: [{ status: 500 }] };
    activeChanged.fire();
    active = { ...active, records: [{ status: 500 }, { status: 502 }] };
    activeChanged.fire();
    await settle();
    expect(requested).toHaveLength(1);
    expect(body.querySelector('.d-debug')).toBe(drawn);
  });

  it('shows the server’s error in the panel', async () => {
    vi.stubGlobal('fetch', async () => new Response('Code: 60. Table default.http_logs does not exist', { status: 500 }));
    active = chart({ kind: 'idle' });
    showPanel();
    await settle();
    expect(body.querySelector('.d-notice--error')!.textContent).toContain('does not exist');
  });

  it('says the active widget’s status in the status bar; a click opens the panel', () => {
    expect(status.textContent).toBe('No active chart');
    active = chart({ kind: 'done', rows: 1234, ms: 87, diagnostics: { ignored: ['host'] } });
    activeChanged.fire();
    expect([...status.children].map((part) => part.textContent)).toEqual(['Requests', '1,234 rows', '87 ms', 'ignores host']);
    status.click();
    expect(panel.shown).toBe(1);
  });

  it('leaves the status bar on the start page, which queries nothing', () => {
    expect(inStatusBar).toBe(true);
    page.current = { kind: 'home', title: 'Home', filterBar: false, filterButtons: [], widgets: [] };
    page.changed.fire(page.current);
    expect(inStatusBar).toBe(false);
    page.current = { kind: 'dashboard', title: 'Shop', filterBar: false, filterButtons: [], widgets: [] };
    page.changed.fire(page.current);
    expect(inStatusBar).toBe(true);
  });
});

describe('statusParts', () => {
  const texts = (widgetStatus: WidgetStatus) => statusParts(chart(widgetStatus)).map((part) => `${part.tone}:${part.text}`);

  it('says how the last query went', () => {
    expect(texts({ kind: 'idle' })).toEqual(['title:Requests', 'muted:not queried yet']);
    expect(texts({ kind: 'loading' })).toEqual(['title:Requests', 'muted:querying…']);
    expect(texts({ kind: 'done', rows: 1, ms: 3, diagnostics: {} })).toEqual(['title:Requests', 'plain:1 row', 'plain:3 ms']);
    expect(texts({ kind: 'done', rows: 0, ms: 2, diagnostics: { skipped: 'needs host' } })).toEqual(['title:Requests', 'muted:skipped: needs host']);
  });

  it('shortens an error to its first line', () => {
    const [, error] = statusParts(chart({ kind: 'error', message: `Code: 60. ${'x'.repeat(100)}\nStack trace`, ms: 40 }));
    expect(error.tone).toBe('error');
    expect(error.text).toHaveLength(80);
    expect(error.text.endsWith('…')).toBe(true);
  });
});
