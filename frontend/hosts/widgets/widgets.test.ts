// @vitest-environment jsdom
// Tests for WidgetsHost: rendering by type, the widget context (query, children, menu), the active widget, the
// widget decorations of the registered providers, the data point menu of the registered providers.
import { tableFromArrays, tableToIPC } from 'apache-arrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { WidgetNode } from '../../generated/zz_generated.dashica';
import { QueryHost } from '../query/query';
import { TEST_TIME } from '../query/query-testing';
import { WidgetsHost, type DataPoint, type DataPointMenuItem, type QueryResult, type RenderedWidget, type WidgetContext, type WidgetDecoration, type WidgetMenuContext } from './widgets';
import { settle, widgetTestbed } from './widgets-testing';

let testbed: ReturnType<typeof widgetTestbed>;

beforeEach(() => {
  // a key every request carries
  testbed = widgetTestbed({ keys: [TEST_TIME] });
});

afterEach(() => testbed.dispose());

const requests: WidgetNode = { type: 'timeBar', props: { title: 'Requests', x: { kind: 'expr', alias: 'time' }, y: { kind: 'count', alias: 'cnt' } }, dataUrl: '/p/shop/api/1' };

describe('WidgetsHost', () => {
  it('renders a widget with the renderer of its type, and empties the element when disposed', () => {
    const disposed: string[] = [];
    testbed.widgets.registerWidget('timeBar', (widgetContainer, widget) => {
      widgetContainer.textContent = widget.props.title ?? '';
      return new Disposable(() => disposed.push(widget.type));
    });
    const { widgetContainer, rendered } = testbed.render(requests);
    expect(widgetContainer.textContent).toBe('Requests');
    rendered.dispose();
    expect(disposed).toEqual(['timeBar']);
    expect(widgetContainer.textContent).toBe('');
  });

  it('shows the error in place of a widget without renderer, or whose renderer throws', () => {
    expect(testbed.render(requests).widgetContainer.textContent).toBe('no renderer for this widget type (timeBar)');
    testbed.widgets.registerWidget('timeBar', () => {
      throw new Error('x has no alias');
    });
    expect(testbed.render(requests).widgetContainer.textContent).toBe('x has no alias (timeBar)');
  });

  it('asks nothing for a widget whose renderer threw', async () => {
    let failed: Promise<QueryResult> | undefined;
    testbed.widgets.registerWidget('timeBar', (_widgetContainer, _widget, given) => {
      failed = given.runQuery();
      throw new Error('x has no alias');
    });
    testbed.serve('/p/shop/api/1/query', { cnt: [3] });
    testbed.render(requests);
    // its query answered: a rendered widget would be decorated
    await failed;
    const asked: RenderedWidget[] = [];
    testbed.widgets.registerDecorationProvider({ provideDecorations: (widget) => (asked.push(widget), [{ badge: 'slow', source: 'timing' }]) });
    expect(asked).toEqual([]);
  });

  it('refuses a second renderer for a type', () => {
    const renderer = () => new Disposable(() => {});
    testbed.widgets.registerWidget('timeBar', renderer);
    expect(() => testbed.widgets.registerWidget('timeBar', renderer)).toThrow('There is a renderer for the widget type timeBar already');
  });

  it('renders the children of a widget with their own renderers', () => {
    testbed.widgets.registerWidget('grid', (widgetContainer, widget, ctx) =>
      Disposable.from(...Object.values(widget.children ?? {}).map((child) => ctx.renderChild(widgetContainer.appendChild(document.createElement('div')), child))),
    );
    testbed.widgets.registerWidget('markdown', (widgetContainer, widget) => {
      widgetContainer.textContent = widget.props.title ?? '';
      return new Disposable(() => {});
    });
    const grid: WidgetNode = { type: 'grid', props: {}, children: { a: { type: 'markdown', props: { title: 'Shop' } } } };
    expect(testbed.render(grid).widgetContainer.textContent).toBe('Shop');
  });

  it('renders a widget and its children with the query state it is given (its tab’s)', () => {
    const states: unknown[] = [];
    testbed.widgets.registerWidget('grid', (widgetContainer, widget, ctx) => {
      states.push(ctx.query);
      return Disposable.from(...Object.values(widget.children ?? {}).map((child) => ctx.renderChild(widgetContainer.appendChild(document.createElement('div')), child)));
    });
    testbed.widgets.registerWidget('markdown', (_widgetContainer, _widget, ctx) => (states.push(ctx.query), new Disposable(() => {})));
    const tab = new QueryHost();
    const grid: WidgetNode = { type: 'grid', props: {}, children: { a: { type: 'markdown', props: {} } } };
    testbed.widgets.render(document.body.appendChild(document.createElement('div')), grid, tab);
    expect(states).toEqual([tab, tab]);
    tab.dispose();
  });

  describe('the widget context', () => {
    let ctx: WidgetContext;

    beforeEach(() => {
      testbed.widgets.registerWidget('timeBar', (_widgetContainer, _widget, given) => {
        ctx = given;
        return new Disposable(() => {});
      });
      testbed.render(requests);
    });

    it('queries the widget’s handler with the page’s query state, and passes the answer’s headers through', async () => {
      testbed.query.set(TEST_TIME, '1h');
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

    it('names URLs below the widget’s handler with the page’s query state, its default time range included', () => {
      expect(ctx.url('/speedscope-query')).toBe('/p/shop/api/1/speedscope-query?time=24h');
      testbed.query.set(TEST_TIME, '1h');
      expect(ctx.url('/speedscope-query')).toBe('/p/shop/api/1/speedscope-query?time=1h');
    });

    it('shows a menu for the widget, with what it queried last', async () => {
      testbed.serve('/p/shop/api/1/query', { cnt: [3] });
      await ctx.runQuery();
      const anchorElement = document.body.appendChild(document.createElement('button'));
      ctx.showMenu('widget/context', anchorElement);
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
      testbed.widgets.registerWidget('timeBar', (widgetContainer, _widget, ctx) => {
        contexts.push(ctx);
        widgetContainer.append(document.createElement('button'));
        return new Disposable(() => {});
      });
      testbed.widgets.onDidChangeActive(() => changes++);
    });

    const press = (targetElement: Element) => targetElement.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    it('is the widget with data pressed or focused in last, outlined; Escape keeps it, removing it ends it', () => {
      const first = testbed.render(requests);
      const second = testbed.render(errors);
      expect(testbed.widgets.active).toBeUndefined();
      press(first.widgetContainer.querySelector('button')!);
      expect(testbed.widgets.active?.widget).toBe(requests);
      expect(first.widgetContainer.classList.contains('d-widget--active')).toBe(true);
      second.widgetContainer.querySelector('button')!.focus();
      expect(testbed.widgets.active?.widget).toBe(errors);
      expect(first.widgetContainer.classList.contains('d-widget--active')).toBe(false);
      expect(second.widgetContainer.classList.contains('d-widget--active')).toBe(true);
      expect(changes).toBe(2);
      press(second.widgetContainer);
      expect(changes).toBe(2);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(testbed.widgets.active?.widget).toBe(errors);
      second.rendered.dispose();
      expect(testbed.widgets.active).toBeUndefined();
      expect(changes).toBe(3);
    });

    it('is the widget pressed in also when its chart stops the press, as a chart does on a mark it selects from', () => {
      const { widgetContainer } = testbed.render(requests);
      const markElement = widgetContainer.querySelector('button')!;
      markElement.addEventListener('pointerdown', (event) => event.stopPropagation(), true);
      press(markElement);
      expect(testbed.widgets.active?.widget).toBe(requests);
    });

    it('is the innermost widget with data: a press on a chart in a grid makes the chart active', () => {
      testbed.widgets.registerWidget('grid', (widgetContainer, widget, ctx) =>
        Disposable.from(...Object.values(widget.children ?? {}).map((child) => ctx.renderChild(widgetContainer.appendChild(document.createElement('div')), child))),
      );
      const { widgetContainer } = testbed.render({ type: 'grid', props: {}, children: { a: requests } });
      press(widgetContainer.querySelector('button')!);
      expect(testbed.widgets.active?.widget).toBe(requests);
      press(widgetContainer);
      expect(testbed.widgets.active?.widget).toBe(requests);
    });

    it('is the widget itself, the same object on each read, which tells its status by its own event', async () => {
      testbed.serve('/p/shop/api/1/query', { time: [1, 2, 3] });
      const { widgetContainer } = testbed.render(requests);
      press(widgetContainer);
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
      const { widgetContainer } = testbed.render(requests);
      press(widgetContainer);
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
      const { widgetContainer } = testbed.render(requests);
      press(widgetContainer);
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
      const ui = { showContextMenu() {}, showQuickPick: async () => undefined };
      const widgets = new WidgetsHost(ui, testbed.commands, source);
      widgets.registerWidget('timeBar', () => new Disposable(() => {}));
      let told = 0;
      widgets.onDidChangeActive(() => told++);
      const inFirstElement = document.body.appendChild(document.createElement('div'));
      const inOtherElement = document.body.appendChild(document.createElement('div'));
      const first = source.activeQuery;
      widgets.render(inFirstElement, requests, first);
      widgets.render(inOtherElement, errors, other);
      press(inFirstElement);
      press(inOtherElement);
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
      testbed.widgets.registerWidget('timeBar', (_widgetContainer, _widget, given) => {
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

  describe('the data point menu', () => {
    let ctx: WidgetContext;
    const points: readonly DataPoint[] = [{ field: 'host', value: 'a' }, { field: 'status', value: '500', type: 'UInt16' }];
    const box = () => document.querySelector<HTMLElement>('.d-workbench__quick-pick[aria-label="Data point"]');
    const options = () => [...document.querySelectorAll<HTMLElement>('.d-workbench__quick-pick[aria-label="Data point"] [role=option]')];
    const item = (label: string, ...args: unknown[]): DataPointMenuItem => ({ label, command: 'test.run', arguments: args });

    beforeEach(() => {
      testbed.widgets.registerWidget('timeBar', (_widgetContainer, _widget, given) => {
        ctx = given;
        return new Disposable(() => {});
      });
      testbed.render(requests);
    });

    it('asks every provider in order with the widget and the data points; shows their items at the point; the chosen one runs its command', async () => {
      const asked: unknown[] = [];
      const runs: unknown[][] = [];
      testbed.commands.registerCommand('test.run', (...args: unknown[]) => void runs.push(args));
      testbed.widgets.registerDataPointMenuProvider({ provideDataPointMenuItems: (widget, dataPoints) => (asked.push([widget, dataPoints]), [item('first', 1)]) });
      testbed.widgets.registerDataPointMenuProvider({ provideDataPointMenuItems: () => [item('second', 'x', 2)] });
      ctx.showDataPointMenu({ x: 10, y: 20 }, points);

      expect(asked).toEqual([[ctx, points]]);
      expect(options().map((optionElement) => optionElement.textContent)).toEqual(['first', 'second']);
      expect(box()!.style.left).toBe('10px');
      options()[1].click();
      await vi.waitFor(() => expect(box()).toBeNull());
      expect(runs).toEqual([['x', 2]]);
    });

    it('skips a provider that throws or rejects; shows nothing without items', async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      testbed.widgets.registerDataPointMenuProvider({
        provideDataPointMenuItems: () => {
          throw new Error('broken');
        },
      });
      const empty = testbed.widgets.registerDataPointMenuProvider({ provideDataPointMenuItems: () => undefined });
      ctx.showDataPointMenu({ x: 0, y: 0 }, points);
      expect(box()).toBeNull();

      testbed.widgets.registerDataPointMenuProvider({ provideDataPointMenuItems: () => Promise.reject(new Error('down')) });
      ctx.showDataPointMenu({ x: 0, y: 0 }, points);
      await vi.waitFor(() => expect(box()).toBeNull());

      empty.dispose();
      testbed.widgets.registerDataPointMenuProvider({ provideDataPointMenuItems: async () => [item('later')] });
      ctx.showDataPointMenu({ x: 0, y: 0 }, points);
      // busy while the items are still to come
      expect(box()!.querySelector<HTMLElement>('.d-workbench__quick-pick-progress')!.hidden).toBe(false);
      await vi.waitFor(() => expect(options().map((optionElement) => optionElement.textContent)).toEqual(['later']));
      // the broken provider on each of the three menus, the rejecting one on the last two
      expect(logged).toHaveBeenCalledTimes(5);
      logged.mockRestore();
    });

    it('keeps the menu open with the command’s error when it fails', async () => {
      testbed.commands.registerCommand('test.run', () => Promise.reject(new Error('422: host cannot filter')));
      testbed.widgets.registerDataPointMenuProvider({ provideDataPointMenuItems: () => [item('host = a')] });
      ctx.showDataPointMenu({ x: 0, y: 0 }, points);
      options()[0].click();
      await vi.waitFor(() => expect(box()!.querySelector('.d-workbench__quick-pick-message')!.textContent).toBe('422: host cannot filter'));
    });
  });
});
