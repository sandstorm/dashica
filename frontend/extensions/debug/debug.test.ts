// @vitest-environment jsdom
// Tests for debug.ts: the panel following the active widget, asking /debug only while shown, its views, the status bar;
// popped out into a tab, bound to the widget active then.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { CommandOptions } from '../../hosts/commands/commands';
import type { ExtensionContext, Memento } from '../../hosts/extension-host/extension-host';
import type { PoppedView } from '../../hosts/page/page';
import type { WidgetStatus } from '../../hosts/widgets/widgets';
import { fakeWidget, type FakeWidget } from '../../hosts/widgets/widgets-testing';
import { debug, statusParts } from './debug';

let body: HTMLElement;
let status: HTMLElement;
let panel: { visible: boolean; shown: number };
let visibility: EventEmitter<void>;
let activeChanged: EventEmitter<void>;
let active: FakeWidget | undefined;
let commands: Record<string, () => unknown>;
let menuItems: { menuId: string; command: string; title?: string }[];
/** Each command's `enablement` as registered. */
let enablements: Record<string, (() => boolean) | undefined>;
let popped: PoppedView[];
let requested: string[];

const memento: Memento = { get: (_key: string, defaultValue?: unknown) => defaultValue, update: async () => {} } as Memento;

beforeEach(() => {
  body = document.body.appendChild(document.createElement('div'));
  panel = { visible: false, shown: 0 };
  visibility = new EventEmitter<void>();
  activeChanged = new EventEmitter<void>();
  active = undefined;
  menuItems = [];
  commands = {};
  enablements = {};
  popped = [];
  requested = [];
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
        return { dispose() {} };
      },
      registerMenuItem: (menuId: string, item: { command: string; title?: string }) => menuItems.push({ menuId, command: item.command, title: item.title }),
    },
    widgets: {
      get active() {
        return active;
      },
      onDidChangeActive: activeChanged.event,
    },
    page: { popOut: async (view: PoppedView) => void popped.push(view) },
    commands: {
      registerCommand: (id: string, run: () => unknown, options?: CommandOptions) => {
        commands[id] = run;
        enablements[id] = options?.enablement;
      },
    },
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

/** A chart with the data under `/p/shop/api/<api>`. */
function chart(widgetStatus: WidgetStatus, api = 1): FakeWidget {
  const widget = { type: 'timeBar', props: { title: 'Requests', x: { kind: 'expr', alias: 'time' }, y: { kind: 'expr', alias: 'value' } }, dataUrl: `/p/shop/api/${api}` } as FakeWidget['widget'];
  return fakeWidget(widget, { url: (path) => `/p/shop/api/${api}${path}?time=24h`, status: widgetStatus });
}

/** Makes `widget` the active one, as the host tells it. */
const activate = (widget: FakeWidget | undefined) => {
  active = widget;
  activeChanged.fire();
};

const showPanel = () => {
  panel.visible = true;
  visibility.fire();
};

describe('debug', () => {
  it('is in the chart’s menu, which opens the panel', () => {
    expect(menuItems.map(({ menuId, title }) => ({ menuId, title }))).toEqual([
      { menuId: 'widget/context', title: 'Debug' },
      { menuId: 'panel/debug', title: 'Pop out' },
    ]);
    commands['debug.showWidget']();
    expect(panel.shown).toBe(1);
  });

  it('pops the active widget’s debug info out into a tab, which keeps following that widget, not the active one', async () => {
    const popOut = menuItems.find((item) => item.menuId === 'panel/debug')!;
    const enabled = enablements[popOut.command]!;
    expect(enabled()).toBe(false);
    commands['debug.popOut']();
    expect(popped).toEqual([]);

    activate(chart({ kind: 'done', rows: 3, ms: 12, diagnostics: {} }));
    expect(enabled()).toBe(true);
    commands['debug.popOut']();
    expect(popped.map((view) => view.title)).toEqual(['Debug: Requests']);
    const tab = document.body.appendChild(document.createElement('div'));
    const shown = popped[0].render(tab);
    await settle();
    expect(requested).toEqual(['/p/shop/api/1/debug?time=24h']);
    expect(tab.querySelector('.d-debug-tab pre')!.textContent).toBe('SELECT count() FROM http_logs');

    // another active widget: the tab stays with its own, whose next answer it asks for
    const bound = active!;
    activate(chart({ kind: 'done', rows: 1, ms: 5, diagnostics: {} }, 2));
    bound.setStatus({ kind: 'done', rows: 4, ms: 9, diagnostics: {} });
    await settle();
    expect(requested).toEqual(['/p/shop/api/1/debug?time=24h', '/p/shop/api/1/debug?time=24h']);

    // the tab closed: nothing more
    shown.dispose();
    bound.setStatus({ kind: 'done', rows: 5, ms: 9, diagnostics: {} });
    await settle();
    expect(requested).toHaveLength(2);
  });

  it('asks nothing while hidden; shown without an active widget, it hints to click a chart', () => {
    activate(chart({ kind: 'done', rows: 3, ms: 12, diagnostics: {} }));
    active!.setStatus({ kind: 'done', rows: 4, ms: 9, diagnostics: {} });
    expect(requested).toEqual([]);
    active = undefined;
    showPanel();
    expect(body.textContent).toContain('Click a chart to see what it queried.');
  });

  it('shows the active widget’s query and EXPLAIN as views, and follows it', async () => {
    activate(chart({ kind: 'done', rows: 3, ms: 12, diagnostics: {} }));
    showPanel();
    await settle();
    expect(requested).toEqual(['/p/shop/api/1/debug?time=24h']);
    expect([...body.querySelectorAll('.d-view__title')].map((title) => title.textContent)).toEqual(['Query', 'Stats', 'EXPLAIN plan', 'Pipeline', 'Syntax', 'Result']);
    expect(body.querySelector('pre')!.textContent).toBe('SELECT count() FROM http_logs');
    expect(body.textContent).toContain('ReadFromMergeTree (default.http_logs)');
    expect(body.textContent).toContain('The chart has not queried yet.');

    // its query running again: kept; answered: asked again
    active!.setStatus({ kind: 'loading' });
    expect(requested).toHaveLength(1);
    active!.setStatus({ kind: 'done', rows: 4, ms: 9, diagnostics: {} });
    await settle();
    expect(requested).toHaveLength(2);

    // another widget, though still loading; the one before is no longer listened to
    const before = active!;
    activate(chart({ kind: 'loading' }, 2));
    await settle();
    before.setStatus({ kind: 'done', rows: 5, ms: 3, diagnostics: {} });
    await settle();
    expect(requested).toEqual(['/p/shop/api/1/debug?time=24h', '/p/shop/api/1/debug?time=24h', '/p/shop/api/2/debug?time=24h']);

    // hidden: nothing more
    panel.visible = false;
    visibility.fire();
    activate(chart({ kind: 'done', rows: 1, ms: 5, diagnostics: {} }, 3));
    active!.setStatus({ kind: 'done', rows: 2, ms: 5, diagnostics: {} });
    expect(requested).toHaveLength(3);
  });

  it('asks nothing again when an aborted query puts back its status', async () => {
    activate(chart({ kind: 'done', rows: 3, ms: 12, diagnostics: {} }));
    showPanel();
    await settle();
    expect(requested).toHaveLength(1);
    const drawn = body.querySelector('.d-debug');
    const answered = active!.status;
    active!.setStatus({ kind: 'loading' });
    active!.setStatus(answered);
    await settle();
    expect(requested).toHaveLength(1);
    expect(body.querySelector('.d-debug')).toBe(drawn);
  });

  it('shows the server’s error in the panel', async () => {
    vi.stubGlobal('fetch', async () => new Response('Code: 60. Table default.http_logs does not exist', { status: 500 }));
    activate(chart({ kind: 'idle' }));
    showPanel();
    await settle();
    expect(body.querySelector('.d-notice--error')!.textContent).toContain('does not exist');
  });

  it('says the active widget’s status in the status bar; a click opens the panel', () => {
    expect(status.textContent).toBe('No active chart');
    activate(chart({ kind: 'loading' }));
    expect(status.textContent).toBe('querying…');
    active!.setStatus({ kind: 'done', rows: 1234, ms: 87, diagnostics: { ignored: ['host'] } });
    expect([...status.children].map((part) => part.textContent)).toEqual(['1,234 rows', '87 ms', 'ignores host']);
    status.click();
    expect(panel.shown).toBe(1);
  });
});

describe('statusParts', () => {
  const texts = (widgetStatus: WidgetStatus) => statusParts(chart(widgetStatus)).map((part) => `${part.tone}:${part.text}`);

  it('says how the last query went', () => {
    expect(texts({ kind: 'idle' })).toEqual(['muted:not queried yet']);
    expect(texts({ kind: 'loading' })).toEqual(['muted:querying…']);
    expect(texts({ kind: 'done', rows: 1, ms: 3, diagnostics: {} })).toEqual(['plain:1 row', 'plain:3 ms']);
    expect(texts({ kind: 'done', rows: 0, ms: 2, diagnostics: { skipped: 'needs host' } })).toEqual(['muted:skipped: needs host']);
  });

  it('shortens an error to its first line', () => {
    const [error] = statusParts(chart({ kind: 'error', message: `Code: 60. ${'x'.repeat(100)}\nStack trace`, ms: 40 }));
    expect(error.tone).toBe('error');
    expect(error.text).toHaveLength(80);
    expect(error.text.endsWith('…')).toBe(true);
  });
});
