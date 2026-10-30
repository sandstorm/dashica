// @vitest-environment jsdom
// Tests for debug.ts: the chart's menu entry, the debug info in the panel, an error.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionContext } from '../../hosts/extension-host/extension-host';
import type { WidgetMenuContext } from '../../hosts/widgets/widgets';
import { debug } from './debug';

let body: HTMLElement;
let shown: number;
let showDebug: (widget: WidgetMenuContext) => Promise<void>;
let menuItems: { menuId: string; title?: string }[];

beforeEach(() => {
  body = document.body.appendChild(document.createElement('div'));
  shown = 0;
  menuItems = [];
  const context = {
    subscriptions: [],
    ui: {
      registerBottomPanel: () => ({ body, show: () => shown++, dispose() {} }),
      registerMenuItem: (menuId: string, item: { title?: string }) => menuItems.push({ menuId, title: item.title }),
    },
    commands: { registerCommand: (_id: string, run: typeof showDebug) => (showDebug = run) },
  };
  debug.activate(context as unknown as ExtensionContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const chart: WidgetMenuContext = {
  widget: { type: 'timeBar', props: { x: { kind: 'expr', alias: 'time' }, y: { kind: 'expr', alias: 'value' } }, dataUrl: '/p/shop/api/1' },
  url: (path) => `/p/shop/api/1${path}?filters=%7B%7D`,
  lastResult: undefined,
  logScale: undefined,
  setLogScale: () => {},
};

describe('debug', () => {
  it('is in the chart’s menu', () => {
    expect(menuItems).toEqual([{ menuId: 'widget/context', title: 'Debug' }]);
  });

  it('shows the chart’s query and EXPLAIN from its /debug in the panel', async () => {
    const requested: string[] = [];
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
    await showDebug(chart);
    expect(shown).toBe(1);
    expect(requested).toEqual(['/p/shop/api/1/debug?filters=%7B%7D']);
    const sections = [...body.querySelectorAll('details')].map((d) => d.querySelector('summary')!.textContent);
    expect(sections[0]).toBe('SQL Query');
    expect(body.querySelector('pre')!.textContent).toBe('SELECT count() FROM http_logs');
    expect(body.textContent).toContain('ReadFromMergeTree (default.http_logs)');
    expect(body.textContent).toContain('The chart has not queried yet.');
  });

  it('shows the server’s error in the panel', async () => {
    vi.stubGlobal('fetch', async () => new Response('Code: 60. Table default.http_logs does not exist', { status: 500 }));
    await showDebug(chart);
    expect(body.querySelector('.alert-error')!.textContent).toContain('does not exist');
  });
});
