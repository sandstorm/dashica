// @vitest-environment jsdom
// Tests for debug.ts: the panel following the active widget, asking /debug only while shown, its views, the status bar;
// popped out into a tab, bound to the widget active then.
import { Table } from 'apache-arrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { CommandOptions } from '../../hosts/commands/commands';
import type { ExtensionContext, Memento } from '../../hosts/extension-host/extension-host';
import type { PoppedView } from '../../hosts/page/page';
import type { QueryResult, WidgetDecoration, WidgetStatus } from '../../hosts/widgets/widgets';
import { fakeWidget, type FakeWidget } from '../../hosts/widgets/widgets-testing';
import { clickhouseSummaryOf, debug, statusParts } from './debug';

let bodyContainer: HTMLElement;
let statusElement: HTMLElement;
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
  bodyContainer = document.body.appendChild(document.createElement('div'));
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
        bodyContainer,
        get visible() {
          return panel.visible;
        },
        onDidChangeVisibility: visibility.event,
        show: () => panel.shown++,
        dispose() {},
      }),
      registerBarItem: (_bar: string, itemElement: HTMLElement) => {
        statusElement = itemElement;
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
function chart(widgetStatus: WidgetStatus, api = 1, lastResult?: QueryResult): FakeWidget {
  const widget = { type: 'timeBar', props: { title: 'Requests', x: { kind: 'expr', alias: 'time' }, y: { kind: 'expr', alias: 'value' } }, dataUrl: `/p/shop/api/${api}` } as FakeWidget['widget'];
  return fakeWidget(widget, { url: (path) => `/p/shop/api/${api}${path}?time=24h`, status: widgetStatus, lastResult });
}

/** An answer of no rows with `headers`. */
const answer = (headers: Record<string, string>): QueryResult => Object.assign(new Table(), { headers: new Headers(headers) });

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

    activate(chart({ kind: 'done', rows: 3, ms: 12 }));
    expect(enabled()).toBe(true);
    commands['debug.popOut']();
    expect(popped.map((view) => view.title)).toEqual(['Debug: Requests']);
    const tabElement = document.body.appendChild(document.createElement('div'));
    const shown = popped[0].render(tabElement);
    await settle();
    expect(requested).toEqual(['/p/shop/api/1/debug?time=24h']);
    expect(tabElement.querySelector('.d-debug-tab pre')!.textContent).toBe('SELECT count() FROM http_logs');

    // another active widget: the tab stays with its own, whose next answer it asks for
    const bound = active!;
    activate(chart({ kind: 'done', rows: 1, ms: 5 }, 2));
    bound.setStatus({ kind: 'done', rows: 4, ms: 9 });
    await settle();
    expect(requested).toEqual(['/p/shop/api/1/debug?time=24h', '/p/shop/api/1/debug?time=24h']);

    // the tab closed: nothing more
    shown.dispose();
    bound.setStatus({ kind: 'done', rows: 5, ms: 9 });
    await settle();
    expect(requested).toHaveLength(2);
  });

  it('asks nothing while hidden; shown without an active widget, it hints to click a chart', () => {
    activate(chart({ kind: 'done', rows: 3, ms: 12 }));
    active!.setStatus({ kind: 'done', rows: 4, ms: 9 });
    expect(requested).toEqual([]);
    active = undefined;
    showPanel();
    expect(bodyContainer.textContent).toContain('Click a chart to see what it queried.');
  });

  it('shows the active widget’s query and EXPLAIN as views, and follows it', async () => {
    activate(chart({ kind: 'done', rows: 3, ms: 12 }));
    showPanel();
    await settle();
    expect(requested).toEqual(['/p/shop/api/1/debug?time=24h']);
    expect([...bodyContainer.querySelectorAll('.d-view__title')].map((titleElement) => titleElement.textContent)).toEqual(['Query', 'Decorations', 'Stats', 'EXPLAIN plan', 'Pipeline', 'Syntax', 'Result']);
    expect(bodyContainer.querySelector('pre')!.textContent).toBe('SELECT count() FROM http_logs');
    expect(bodyContainer.textContent).toContain('ReadFromMergeTree (default.http_logs)');
    expect(bodyContainer.textContent).toContain('The chart has not queried yet.');

    // its query running again: kept; answered: asked again
    active!.setStatus({ kind: 'loading' });
    expect(requested).toHaveLength(1);
    active!.setStatus({ kind: 'done', rows: 4, ms: 9 });
    await settle();
    expect(requested).toHaveLength(2);

    // another widget, though still loading; the one before is no longer listened to
    const before = active!;
    activate(chart({ kind: 'loading' }, 2));
    await settle();
    before.setStatus({ kind: 'done', rows: 5, ms: 3 });
    await settle();
    expect(requested).toEqual(['/p/shop/api/1/debug?time=24h', '/p/shop/api/1/debug?time=24h', '/p/shop/api/2/debug?time=24h']);

    // hidden: nothing more
    panel.visible = false;
    visibility.fire();
    activate(chart({ kind: 'done', rows: 1, ms: 5 }, 3));
    active!.setStatus({ kind: 'done', rows: 2, ms: 5 });
    expect(requested).toHaveLength(3);
  });

  it('lists the active widget’s decorations with their source, drawn anew on each change, asking nothing', async () => {
    activate(chart({ kind: 'done', rows: 3, ms: 12 }));
    showPanel();
    await settle();
    const decorations = () => bodyContainer.querySelector('.d-debug__decorations')!;
    expect(decorations().textContent).toBe('None.');
    active!.setDecorations([{ badge: 'ignores host = a', tooltip: 'not applied', muted: true, source: 'filters' }]);
    expect([...decorations().querySelectorAll('tbody td')].map((cellElement) => cellElement.textContent)).toEqual(['filters', 'ignores host = a', 'not applied', 'yes']);
    expect(requested).toHaveLength(1);
  });

  it('asks nothing again when an aborted query puts back its status', async () => {
    activate(chart({ kind: 'done', rows: 3, ms: 12 }));
    showPanel();
    await settle();
    expect(requested).toHaveLength(1);
    const drawnElement = bodyContainer.querySelector('.d-debug');
    const answered = active!.status;
    active!.setStatus({ kind: 'loading' });
    active!.setStatus(answered);
    await settle();
    expect(requested).toHaveLength(1);
    expect(bodyContainer.querySelector('.d-debug')).toBe(drawnElement);
  });

  it('shows the server’s error in the panel', async () => {
    vi.stubGlobal('fetch', async () => new Response('Code: 60. Table default.http_logs does not exist', { status: 500 }));
    activate(chart({ kind: 'idle' }));
    showPanel();
    await settle();
    expect(bodyContainer.querySelector('.d-notice--error')!.textContent).toContain('does not exist');
  });

  it('says the active widget’s status in the status bar; a click opens the panel', () => {
    expect(statusElement.textContent).toBe('No active chart');
    activate(chart({ kind: 'loading' }));
    expect(statusElement.textContent).toBe('querying…');
    active!.setStatus({ kind: 'done', rows: 1234, ms: 87 });
    active!.setDecorations([{ badge: 'ignores host = a', muted: true, source: 'filters' }]);
    expect([...statusElement.children].map((partElement) => partElement.textContent)).toEqual(['1,234 rows', '87 ms', 'ignores host = a']);
    statusElement.click();
    expect(panel.shown).toBe(1);
  });
});

describe('statusParts', () => {
  const texts = (widgetStatus: WidgetStatus, decorations: readonly WidgetDecoration[] = []) => {
    const widget = chart(widgetStatus);
    widget.setDecorations(decorations);
    return statusParts(widget).map((part) => `${part.tone}:${part.text}`);
  };

  it('says how the last query went', () => {
    expect(texts({ kind: 'idle' })).toEqual(['muted:not queried yet']);
    expect(texts({ kind: 'loading' })).toEqual(['muted:querying…']);
    expect(texts({ kind: 'done', rows: 1, ms: 3 })).toEqual(['plain:1 row', 'plain:3 ms']);
    expect(texts({ kind: 'done', rows: 0, ms: 2 }, [{ badge: 'skipped: needs host', source: 'filters' }])).toEqual(['plain:0 rows', 'plain:2 ms', 'muted:skipped: needs host']);
  });

  it('shortens an error to its first line', () => {
    const [error] = statusParts(chart({ kind: 'error', message: `Code: 60. ${'x'.repeat(100)}\nStack trace`, ms: 40 }));
    expect(error.tone).toBe('error');
    expect(error.text).toHaveLength(80);
    expect(error.text.endsWith('…')).toBe(true);
  });
});

describe('clickhouseSummaryOf', () => {
  it('reads ClickHouse’s summary of the answer, null without the header', () => {
    expect(clickhouseSummaryOf(answer({ 'X-Clickhouse-Summary': '{"read_rows":"12"}' }))).toEqual({ read_rows: '12' });
    expect(clickhouseSummaryOf(answer({}))).toBeNull();
  });
});
