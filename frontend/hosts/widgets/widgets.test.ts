// @vitest-environment jsdom
// Tests for WidgetsHost: rendering by type, the widget context (query, children, menu), the active widget, the
// widget decorations of the registered providers.
import { tableFromArrays, tableToIPC } from 'apache-arrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { WidgetNode } from '../../generated/zz_generated.dashica';
import { TIME, presetRange } from '../../extensions/time-library/time-state';
import { QueryHost } from '../query/query';
import { WidgetsHost, type QueryResult, type RenderedWidget, type WidgetContext, type WidgetDecoration, type WidgetMenuContext } from './widgets';
import { settle, widgetTestbed } from './widgets-testing';

let testbed: ReturnType<typeof widgetTestbed>;

beforeEach(() => {
  testbed = widgetTestbed();
  // as the time-range extension keeps it, which every request carries
  testbed.query.get(TIME);
});

afterEach(() => testbed.dispose());

const requests: WidgetNode = { type: 'timeBar', props: { title: 'Requests', x: { kind: 'expr', alias: 'time' }, y: { kind: 'count', alias: 'cnt' } }, dataUrl: '/p/shop/api/1' };

describe('WidgetsHost', () => {
  it('renders a widget with the renderer of its type, and empties the element when disposed', () => {
    const disposed: string[] = [];
    testbed.widgets.registerWidget('timeBar', (el, widget) => {
      el.textContent = widget.props.title ?? '';
      return new Disposable(() => disposed.push(widget.type));
    });
    const { el, rendered } = testbed.render(requests);
    expect(el.textContent).toBe('Requests');
    rendered.dispose();
    expect(disposed).toEqual(['timeBar']);
    expect(el.textContent).toBe('');
  });

  it('shows the error in place of a widget without renderer, or whose renderer throws', () => {
    expect(testbed.render(requests).el.textContent).toBe('no renderer for this widget type (timeBar)');
    testbed.widgets.registerWidget('timeBar', () => {
      throw new Error('x has no alias');
    });
    expect(testbed.render(requests).el.textContent).toBe('x has no alias (timeBar)');
  });

  it('refuses a second renderer for a type', () => {
    const renderer = () => new Disposable(() => {});
    testbed.widgets.registerWidget('timeBar', renderer);
    expect(() => testbed.widgets.registerWidget('timeBar', renderer)).toThrow('There is a renderer for the widget type timeBar already');
  });

  it('renders the children of a widget with their own renderers', () => {
    testbed.widgets.registerWidget('grid', (el, widget, ctx) =>
      Disposable.from(...Object.values(widget.children ?? {}).map((child) => ctx.renderChild(el.appendChild(document.createElement('div')), child))),
    );
    testbed.widgets.registerWidget('markdown', (el, widget) => {
      el.textContent = widget.props.title ?? '';
      return new Disposable(() => {});
    });
    const grid: WidgetNode = { type: 'grid', props: {}, children: { a: { type: 'markdown', props: { title: 'Shop' } } } };
    expect(testbed.render(grid).el.textContent).toBe('Shop');
  });

  it('renders a widget and its children with the query state it is given (its tab’s)', () => {
    const states: unknown[] = [];
    testbed.widgets.registerWidget('grid', (el, widget, ctx) => {
      states.push(ctx.query);
      return Disposable.from(...Object.values(widget.children ?? {}).map((child) => ctx.renderChild(el.appendChild(document.createElement('div')), child)));
    });
    testbed.widgets.registerWidget('markdown', (_el, _widget, ctx) => (states.push(ctx.query), new Disposable(() => {})));
    const tab = new QueryHost();
    const grid: WidgetNode = { type: 'grid', props: {}, children: { a: { type: 'markdown', props: {} } } };
    testbed.widgets.render(document.body.appendChild(document.createElement('div')), grid, tab);
    expect(states).toEqual([tab, tab]);
    tab.dispose();
  });

  describe('the widget context', () => {
    let ctx: WidgetContext;

    beforeEach(() => {
      testbed.widgets.registerWidget('timeBar', (_el, _widget, given) => {
        ctx = given;
        return new Disposable(() => {});
      });
      testbed.render(requests);
    });

    it('queries the widget’s handler with the page’s query state, and passes the answer’s headers through', async () => {
      testbed.query.set(TIME, presetRange('1h'));
      testbed.serve('/p/shop/api/1/query', { cnt: [3] }, { 'X-Example': 'as sent' });
      const result = await ctx.runQuery();
      expect(result.toArray().map((row) => row.cnt)).toEqual([3]);
      expect(result.headers.get('X-Example')).toBe('as sent');
      expect(testbed.requests[0].searchParams.get('time')).toBe('1h');
    });

    it('answers a 204 with an empty table and its headers', async () => {
      testbed.serveNothing('/p/shop/api/1/query', { 'X-Example': 'nothing' });
      const result = await ctx.runQuery();
      expect(result.numRows).toBe(0);
      expect(result.numCols).toBe(0);
      expect(result.headers.get('X-Example')).toBe('nothing');
    });

    it('rejects with the server’s message', async () => {
      testbed.serveText('/p/shop/api/1/query', 'Unknown identifier status', 500);
      await expect(ctx.runQuery()).rejects.toThrow('Unknown identifier status');
    });

    it('names URLs below the widget’s handler with the page’s query state', () => {
      expect(ctx.url('/speedscope-query')).toMatch(/^\/p\/shop\/api\/1\/speedscope-query\?time=24h$/);
    });

    it('shows a menu for the widget, with what it queried last', async () => {
      testbed.serve('/p/shop/api/1/query', { cnt: [3] });
      await ctx.runQuery();
      const anchor = document.body.appendChild(document.createElement('button'));
      ctx.showMenu('widget/context', anchor);
      ctx.showMenu('shop/rows', { x: 10, y: 20 });
      const [{ menuId, options }, rows] = testbed.menus;
      expect(menuId).toBe('widget/context');
      expect(rows).toMatchObject({ menuId: 'shop/rows', options: { anchor: { x: 10, y: 20 }, args: [options.args![0]] } });
      expect(options.title).toBe('timeBar');
      const context = options.args![0] as WidgetMenuContext;
      expect(context.widget).toBe(requests);
      expect(context.lastResult?.numRows).toBe(1);
    });
  });

  describe('the active widget', () => {
    const errors: WidgetNode = { ...requests, props: { ...requests.props, title: 'Errors' }, dataUrl: '/p/shop/api/2' } as WidgetNode;
    let contexts: WidgetContext[];
    let changes: number;

    beforeEach(() => {
      contexts = [];
      changes = 0;
      testbed.widgets.registerWidget('timeBar', (el, _widget, ctx) => {
        contexts.push(ctx);
        el.append(document.createElement('button'));
        return new Disposable(() => {});
      });
      testbed.widgets.onDidChangeActive(() => changes++);
    });

    const press = (el: Element) => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    it('is the widget with data pressed or focused in last, outlined; Escape keeps it, removing it ends it', () => {
      const first = testbed.render(requests);
      const second = testbed.render(errors);
      expect(testbed.widgets.active).toBeUndefined();
      press(first.el.querySelector('button')!);
      expect(testbed.widgets.active?.widget).toBe(requests);
      expect(first.el.classList.contains('d-widget--active')).toBe(true);
      second.el.querySelector('button')!.focus();
      expect(testbed.widgets.active?.widget).toBe(errors);
      expect(first.el.classList.contains('d-widget--active')).toBe(false);
      expect(second.el.classList.contains('d-widget--active')).toBe(true);
      expect(changes).toBe(2);
      press(second.el);
      expect(changes).toBe(2);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(testbed.widgets.active?.widget).toBe(errors);
      second.rendered.dispose();
      expect(testbed.widgets.active).toBeUndefined();
      expect(changes).toBe(3);
    });

    it('is the widget pressed in also when its chart stops the press, as a chart does on a mark it selects from', () => {
      const { el } = testbed.render(requests);
      const mark = el.querySelector('button')!;
      mark.addEventListener('pointerdown', (event) => event.stopPropagation(), true);
      press(mark);
      expect(testbed.widgets.active?.widget).toBe(requests);
    });

    it('is the innermost widget with data: a press on a chart in a grid makes the chart active', () => {
      testbed.widgets.registerWidget('grid', (el, widget, ctx) =>
        Disposable.from(...Object.values(widget.children ?? {}).map((child) => ctx.renderChild(el.appendChild(document.createElement('div')), child))),
      );
      const { el } = testbed.render({ type: 'grid', props: {}, children: { a: requests } });
      press(el.querySelector('button')!);
      expect(testbed.widgets.active?.widget).toBe(requests);
      press(el);
      expect(testbed.widgets.active?.widget).toBe(requests);
    });

    it('is the widget itself, the same object on each read, which tells its status by its own event', async () => {
      testbed.serve('/p/shop/api/1/query', { time: [1, 2, 3] });
      const { el } = testbed.render(requests);
      press(el);
      const active = testbed.widgets.active!;
      let statuses = 0;
      active.onDidChangeStatus(() => statuses++);
      await contexts[0].runQuery();
      expect(testbed.widgets.active).toBe(active);
      expect(statuses).toBe(2);
      expect(changes).toBe(1);
    });

    it('tells how its query goes: rows and time, an error', async () => {
      testbed.serve('/p/shop/api/1/query', { time: [1, 2, 3] });
      const { el } = testbed.render(requests);
      press(el);
      let statuses = 0;
      testbed.widgets.active!.onDidChangeStatus(() => statuses++);
      expect(testbed.widgets.active?.status).toEqual({ kind: 'idle' });
      const answered = contexts[0].runQuery();
      expect(testbed.widgets.active?.status).toEqual({ kind: 'loading' });
      await answered;
      const status = testbed.widgets.active?.status;
      expect(status).toMatchObject({ kind: 'done', rows: 3 });
      expect(testbed.widgets.active?.lastResult?.numRows).toBe(3);
      expect(testbed.widgets.active?.url('/debug')).toBe('/p/shop/api/1/debug?time=24h');
      testbed.serveText('/p/shop/api/1/query', 'Code: 60. Table default.http_logs does not exist', 500);
      await expect(contexts[0].runQuery()).rejects.toThrow();
      expect(testbed.widgets.active?.status).toMatchObject({ kind: 'error', message: 'Code: 60. Table default.http_logs does not exist' });
      expect(statuses).toBe(4);
      expect(changes).toBe(1);
    });

    it('tells the latest query only: an aborted earlier one keeps it loading, an aborted latest one puts back the last answer', async () => {
      testbed.serve('/p/shop/api/1/query', { time: [1, 2, 3] });
      const { el } = testbed.render(requests);
      press(el);
      await contexts[0].runQuery();
      const answered = testbed.widgets.active?.status;
      // each fetch waits until it is aborted, rejecting then as the browser does, or answered
      const pending: (() => void)[] = [];
      vi.stubGlobal('fetch', (_url: string, { signal }: { signal: AbortSignal }) =>
        new Promise<Response>((resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          pending.push(() => resolve(new Response(tableToIPC(tableFromArrays({ time: [1] })) as Uint8Array<ArrayBuffer>)));
        }),
      );
      const first = new AbortController();
      const firstQuery = contexts[0].runQuery(first.signal);
      first.abort();
      const second = new AbortController();
      const secondQuery = contexts[0].runQuery(second.signal);
      await expect(firstQuery).rejects.toThrow();
      expect(testbed.widgets.active?.status).toEqual({ kind: 'loading' });
      pending[1]();
      await secondQuery;
      expect(testbed.widgets.active?.status).toMatchObject({ kind: 'done', rows: 1 });

      const third = new AbortController();
      const thirdQuery = contexts[0].runQuery(third.signal);
      third.abort();
      await expect(thirdQuery).rejects.toThrow();
      expect(testbed.widgets.active?.status).toMatchObject({ kind: 'done', rows: 1 });
      expect(testbed.widgets.active?.status).not.toBe(answered);
    });

    it('is kept per tab: switching tabs shows that tab’s active widget', () => {
      const tabs = new EventEmitter<void>();
      const source = { activeQuery: new QueryHost(), onDidChangeTabs: tabs.event };
      const other = new QueryHost();
      const ui = { showContextMenu() {} };
      const widgets = new WidgetsHost(ui, source);
      widgets.registerWidget('timeBar', () => new Disposable(() => {}));
      let told = 0;
      widgets.onDidChangeActive(() => told++);
      const inFirst = document.body.appendChild(document.createElement('div'));
      const inOther = document.body.appendChild(document.createElement('div'));
      const first = source.activeQuery;
      widgets.render(inFirst, requests, first);
      widgets.render(inOther, errors, other);
      press(inFirst);
      press(inOther);
      expect(widgets.active?.widget).toBe(requests);
      expect(told).toBe(1);
      source.activeQuery = other;
      tabs.fire();
      expect(widgets.active?.widget).toBe(errors);
      expect(told).toBe(2);
      tabs.fire();
      expect(told).toBe(2);
      widgets.dispose();
      first.dispose();
      other.dispose();
    });
  });

  describe('decorations', () => {
    let ctx: WidgetContext;
    const slow: WidgetDecoration = { badge: 'slow', tooltip: 'over a second', source: 'timing' };

    beforeEach(() => {
      testbed.widgets.registerWidget('timeBar', (_el, _widget, given) => {
        ctx = given;
        return new Disposable(() => {});
      });
      testbed.serve('/p/shop/api/1/query', { cnt: [3] }, { 'X-Slow': 'yes' });
    });

    it('asks every provider in order when an answer arrives, before the status tells it; none before', async () => {
      const asked: { widget: RenderedWidget; result: QueryResult }[] = [];
      testbed.widgets.registerDecorationProvider({ provideDecorations: (widget, result) => (asked.push({ widget, result }), result.headers.get('X-Slow') ? [slow] : undefined) });
      testbed.widgets.registerDecorationProvider({ provideDecorations: () => [{ badge: 'second', muted: true, source: 'other' }] });
      testbed.render(requests);
      expect(ctx.decorations).toEqual([]);
      let seen: readonly WidgetDecoration[] = [];
      let changes = 0;
      ctx.onDidChangeDecorations(() => changes++);
      // the context is the rendered widget, the status event comes after the decorations
      (ctx as unknown as RenderedWidget).onDidChangeStatus(() => (seen = ctx.decorations));
      const result = await ctx.runQuery();
      expect(asked).toEqual([{ widget: ctx, result }]);
      expect(ctx.decorations).toEqual([slow, { badge: 'second', muted: true, source: 'other' }]);
      expect(seen).toEqual(ctx.decorations);
      expect(changes).toBe(1);
    });

    it('has none after a failed query', async () => {
      testbed.widgets.registerDecorationProvider({ provideDecorations: () => [slow] });
      testbed.render(requests);
      await ctx.runQuery();
      testbed.serveText('/p/shop/api/1/query', 'Unknown identifier status', 500);
      await expect(ctx.runQuery()).rejects.toThrow();
      expect(ctx.decorations).toEqual([]);
    });

    it('asks again for every answered widget when a provider fires, and drops its decorations once it is disposed', async () => {
      const changed = new EventEmitter<void>();
      let given: readonly WidgetDecoration[] = [slow];
      const registered = testbed.widgets.registerDecorationProvider({ provideDecorations: () => given, onDidChangeDecorations: changed.event });
      testbed.render(requests);
      await ctx.runQuery();
      given = [{ badge: 'fast', source: 'timing' }];
      changed.fire();
      expect(ctx.decorations).toEqual([{ badge: 'fast', source: 'timing' }]);
      registered.dispose();
      expect(ctx.decorations).toEqual([]);
    });

    it('skips a provider that throws', async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      testbed.widgets.registerDecorationProvider({
        provideDecorations: () => {
          throw new Error('broken');
        },
      });
      testbed.widgets.registerDecorationProvider({ provideDecorations: () => [slow] });
      testbed.render(requests);
      await ctx.runQuery();
      expect(ctx.decorations).toEqual([slow]);
      expect(logged).toHaveBeenCalled();
      logged.mockRestore();
    });
  });
});
