// @vitest-environment jsdom
// Tests for WidgetsHost and ChartFrame: rendering by type, the widget context (query, children, menu, filters), the
// filters a click offers, the active widget, the chart frame.
import { tableFromArrays, tableToIPC } from 'apache-arrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { WidgetNode } from '../../generated/zz_generated.dashica';
import { QueryHost } from '../query/query';
import { ChartFrame, WidgetsHost, type WidgetContext, type WidgetMenuContext } from './widgets';
import { settle, widgetTestbed } from './widgets-testing';

let testbed: ReturnType<typeof widgetTestbed>;

beforeEach(() => {
  testbed = widgetTestbed();
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
      states.push(ctx.state);
      return Disposable.from(...Object.values(widget.children ?? {}).map((child) => ctx.renderChild(el.appendChild(document.createElement('div')), child)));
    });
    testbed.widgets.registerWidget('markdown', (_el, _widget, ctx) => (states.push(ctx.state), new Disposable(() => {})));
    const tab = new QueryHost(window);
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

    it('queries the widget’s handler with the page’s query state, and reads what the server says in the headers', async () => {
      testbed.query.filters.add('status >= 500');
      testbed.serve('/p/shop/api/1/query', { cnt: [3] }, { 'X-Dashica-Bucket-Size': '900000', 'X-Dashica-Resolved-Time-Range': '{"from":1,"to":2}' });
      const result = await ctx.query();
      expect(result.toArray().map((row) => row.cnt)).toEqual([3]);
      expect(result.dashicaBucketSize).toBe(900000);
      expect(result.dashicaResolvedTimeRange).toEqual({ from: 1, to: 2 });
      expect(testbed.requests[0].searchParams.get('sql')).toBe('status >= 500');
    });

    it('reads the chart’s diagnostics, empty without the header', async () => {
      testbed.serve('/p/shop/api/1/query', { cnt: [3] }, { 'X-Dashica-Diagnostics': '{"ignored":["host","status"]}' });
      expect((await ctx.query()).dashicaDiagnostics).toEqual({ ignored: ['host', 'status'] });
      testbed.serve('/p/shop/api/1/query', { cnt: [3] });
      expect((await ctx.query()).dashicaDiagnostics).toEqual({});
    });

    it('answers a chart that did not run with no rows and why', async () => {
      testbed.serveNothing('/p/shop/api/1/query', { 'X-Dashica-Diagnostics': '{"skipped":"pick a host"}' });
      const result = await ctx.query();
      expect(result.numRows).toBe(0);
      expect(result.dashicaDiagnostics).toEqual({ skipped: 'pick a host' });
    });

    it('sends the page’s pills with the next query, their keys', async () => {
      testbed.query.filters.add({ key: 'k1.mac', label: 'host ≠ a' });
      testbed.serve('/p/shop/api/1/query', { cnt: [3] });
      await ctx.query();
      expect(testbed.requests[0].searchParams.getAll('f')).toEqual(['k1.mac']);
    });

    it('rejects with the server’s message', async () => {
      testbed.serveText('/p/shop/api/1/query', 'Unknown identifier status', 500);
      await expect(ctx.query()).rejects.toThrow('Unknown identifier status');
    });

    it('names URLs below the widget’s handler with the page’s query state', () => {
      expect(ctx.url('/speedscope-query')).toMatch(/^\/p\/shop\/api\/1\/speedscope-query\?time=24h$/);
    });

    it('shows a menu for the widget, with what it queried last', async () => {
      testbed.serve('/p/shop/api/1/query', { cnt: [3] });
      await ctx.query();
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

  describe('the filters a click offers', () => {
    const contexts: WidgetContext[] = [];

    beforeEach(() => {
      contexts.length = 0;
      testbed.widgets.registerWidget('barVertical', (_el, _widget, given) => {
        contexts.push(given);
        return new Disposable(() => {});
      });
    });

    const byStatus: WidgetNode = {
      type: 'barVertical',
      props: { x: { kind: 'expr', alias: 'status' }, y: { kind: 'count', alias: 'cnt' } },
      dataUrl: '/p/shop/api/3',
      filterable: ['status', 'instance'],
    };

    it('offers to filter by and to exclude each candidate in order, also a single one; choosing one adds its pill at once; none offer nothing', async () => {
      testbed.render(byStatus);
      contexts[0].offerFilters({ x: 10, y: 20 }, [{ fieldId: 'status', value: '500' }, { fieldId: 'instance', value: 'web-1' }]);
      expect(testbed.choices()).toEqual(['Filter status = 500', 'Exclude status = 500', 'Filter instance = web-1', 'Exclude instance = web-1']);
      expect(document.querySelector<HTMLElement>('.d-workbench__quick-pick')!.style.left).toBe('10px');
      await testbed.choose('Exclude instance = web-1');
      await settle();
      expect(testbed.choices()).toEqual([]);
      expect(testbed.query.filters.chips).toEqual([testbed.pill('instance', 'ne', 'web-1')]);
      expect(testbed.requests.at(-1)?.pathname).toBe('/p/shop/api/3/pill');
      expect(Object.fromEntries(testbed.requests.at(-1)!.searchParams)).toEqual({ field: 'instance', op: 'ne', value: 'web-1' });
      contexts[0].offerFilters({ x: 10, y: 20 }, [{ fieldId: 'status', value: '404' }]);
      expect(testbed.choices()).toEqual(['Filter status = 404', 'Exclude status = 404']);
      contexts[0].offerFilters({ x: 10, y: 20 }, []);
      expect(testbed.choices()).toEqual(['Filter status = 404', 'Exclude status = 404']);
      await testbed.choose('Filter status = 404');
      await settle();
      expect(testbed.query.filters.chips).toEqual([testbed.pill('instance', 'ne', 'web-1'), testbed.pill('status', 'eq', '404')]);
    });

    it('offers only the fields the widget can filter by', () => {
      testbed.render({ ...byStatus, filterable: ['status'] } as WidgetNode);
      contexts[0].offerFilters({ x: 10, y: 20 }, [{ fieldId: 'status', value: '500' }, { fieldId: 'cnt', value: '3' }]);
      expect(testbed.candidates()).toEqual(['status = 500']);
    });

    it('adds no pill when its widget’s /pill fails', async () => {
      const failing = vi.spyOn(console, 'error').mockImplementation(() => {});
      testbed.serveText('/p/shop/api/3/pill', '"status" cannot filter this chart\'s table', 422);
      testbed.render(byStatus);
      contexts[0].offerFilters({ x: 10, y: 20 }, [{ fieldId: 'status', value: '500' }]);
      await testbed.choose('Filter status = 500');
      await settle();
      expect(testbed.query.filters.chips).toEqual([]);
      expect(failing).toHaveBeenCalled();
    });

    it('adds nothing when the viewer closes the quick pick', async () => {
      testbed.render(byStatus);
      contexts[0].offerFilters({ x: 10, y: 20 }, [{ fieldId: 'status', value: '500' }]);
      (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle();
      expect([testbed.choices(), testbed.query.filters.chips]).toEqual([[], []]);
    });

    it('adds the filter to the query state given, for a view of a chart outside the page’s widgets', async () => {
      const other = new QueryHost(window);
      testbed.widgets.offerFilters({ x: 0, y: 0 }, [{ fieldId: 'host', value: 'a' }], other, { dataUrl: '/p/shop/api/3', filterable: ['host'] });
      await testbed.choose('Filter host = a');
      await settle();
      expect([other.filters.chips, testbed.query.filters.chips]).toEqual([[testbed.pill('host', 'eq', 'a')], []]);
      other.dispose();
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
      await contexts[0].query();
      expect(testbed.widgets.active).toBe(active);
      expect(statuses).toBe(2);
      expect(changes).toBe(1);
    });

    it('tells how its query goes: rows and time, an error, its diagnostics', async () => {
      testbed.serve('/p/shop/api/1/query', { time: [1, 2, 3] }, { 'X-Dashica-Diagnostics': '{"ignored":["host"]}' });
      const { el } = testbed.render(requests);
      press(el);
      let statuses = 0;
      testbed.widgets.active!.onDidChangeStatus(() => statuses++);
      expect(testbed.widgets.active?.status).toEqual({ kind: 'idle' });
      const answered = contexts[0].query();
      expect(testbed.widgets.active?.status).toEqual({ kind: 'loading' });
      await answered;
      const status = testbed.widgets.active?.status;
      expect(status).toMatchObject({ kind: 'done', rows: 3, diagnostics: { ignored: ['host'] } });
      expect(testbed.widgets.active?.lastResult?.numRows).toBe(3);
      expect(testbed.widgets.active?.url('/debug')).toBe('/p/shop/api/1/debug?time=24h');
      testbed.serveText('/p/shop/api/1/query', 'Code: 60. Table default.http_logs does not exist', 500);
      await expect(contexts[0].query()).rejects.toThrow();
      expect(testbed.widgets.active?.status).toMatchObject({ kind: 'error', message: 'Code: 60. Table default.http_logs does not exist' });
      expect(statuses).toBe(4);
      expect(changes).toBe(1);
    });

    it('tells the latest query only: an aborted earlier one keeps it loading, an aborted latest one puts back the last answer', async () => {
      testbed.serve('/p/shop/api/1/query', { time: [1, 2, 3] });
      const { el } = testbed.render(requests);
      press(el);
      await contexts[0].query();
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
      const firstQuery = contexts[0].query(first.signal);
      first.abort();
      const second = new AbortController();
      const secondQuery = contexts[0].query(second.signal);
      await expect(firstQuery).rejects.toThrow();
      expect(testbed.widgets.active?.status).toEqual({ kind: 'loading' });
      pending[1]();
      await secondQuery;
      expect(testbed.widgets.active?.status).toMatchObject({ kind: 'done', rows: 1 });

      const third = new AbortController();
      const thirdQuery = contexts[0].query(third.signal);
      third.abort();
      await expect(thirdQuery).rejects.toThrow();
      expect(testbed.widgets.active?.status).toMatchObject({ kind: 'done', rows: 1 });
      expect(testbed.widgets.active?.status).not.toBe(answered);
    });

    it('holds the records selected on it, told by their own event; selecting records makes a widget active, none leave it so', () => {
      const first = testbed.render(requests);
      const second = testbed.render(errors);
      press(first.el);
      expect(testbed.widgets.active?.records).toEqual([]);
      expect(changes).toBe(1);
      let told: unknown[] = [];
      // the second one becomes active before its records are told, so who follows the active widget hears them
      testbed.widgets.onDidChangeActive(() => {
        told.push('active');
        testbed.widgets.active?.onDidChangeRecords(() => told.push(testbed.widgets.active?.records));
      });
      contexts[1].selectRecords([{ status: 500 }, { status: 502 }]);
      expect(testbed.widgets.active?.widget).toBe(errors);
      expect(told).toEqual(['active', [{ status: 500 }, { status: 502 }]]);
      expect(changes).toBe(2);
      told = [];
      contexts[1].selectRecords([{ status: 502 }]);
      expect(told).toEqual([[{ status: 502 }]]);
      expect(changes).toBe(2);
      // the first one's records: none yet, and none tell nothing
      contexts[0].selectRecords([]);
      contexts[1].selectRecords([]);
      expect(testbed.widgets.active?.widget).toBe(errors);
      expect(told).toEqual([[{ status: 502 }], []]);
      expect(changes).toBe(2);
      // removed: its events end
      second.rendered.dispose();
      told = [];
      contexts[1].selectRecords([{ status: 500 }]);
      expect(told).toEqual([]);
    });

    it('is kept per tab: switching tabs shows that tab’s active widget', () => {
      const tabs = new EventEmitter<void>();
      const source = { activeQuery: new QueryHost(window), onDidChangeTabs: tabs.event };
      const other = new QueryHost(window);
      const ui = { showContextMenu() {}, showQuickPick: async () => undefined };
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
});

describe('ChartFrame', () => {
  const drawn: { rows: number; width: number }[] = [];
  let selectTime: (from: Date, to: Date) => void;

  beforeEach(() => {
    drawn.length = 0;
    testbed.widgets.registerWidget(
      'timeBar',
      (el, widget, ctx) =>
        new ChartFrame(el, ctx, {
          title: widget.props.title,
          height: 200,
          draw(result, { width, onTimeSelect }) {
            selectTime = onTimeSelect;
            drawn.push({ rows: result.numRows, width });
            const chart = document.createElement('figure');
            chart.textContent = `${result.numRows} rows`;
            return chart;
          },
        }),
    );
  });

  const body = (el: HTMLElement) => el.querySelector('.d-chart-frame__body')!;

  it('shows the title above the chart, and queries only once it is in view', async () => {
    testbed.serve('/p/shop/api/1/query', { cnt: [3, 4] });
    const { el } = testbed.render(requests);
    const title = el.querySelector<HTMLElement>('.d-chart-frame__title')!;
    expect(title.textContent).toBe('Requests');
    expect(title.nextElementSibling!.contains(body(el))).toBe(true);
    testbed.query.refresh();
    await settle();
    expect(testbed.requests).toHaveLength(0);
    testbed.scrollIntoView();
    await settle();
    expect(body(el).textContent).toBe('2 rows');
    expect(title.textContent).toBe('Requests');
  });

  it('queries again on a refresh, and draws again for another width', async () => {
    testbed.serve('/p/shop/api/1/query', { cnt: [3] });
    testbed.render(requests);
    testbed.resize(640);
    testbed.scrollIntoView();
    await settle();
    testbed.query.time.setRange('1h');
    await settle();
    expect(testbed.requests).toHaveLength(2);
    testbed.resize(320);
    await settle();
    expect(testbed.requests).toHaveLength(2);
    expect(drawn.at(-1)).toEqual({ rows: 1, width: 320 });
  });

  it('keeps what it drew while it measures 0 (its tab in the background), and draws again only for another width', async () => {
    testbed.serve('/p/shop/api/1/query', { cnt: [3] });
    testbed.render(requests);
    testbed.resize(640);
    testbed.scrollIntoView();
    await settle();
    expect(drawn).toEqual([{ rows: 1, width: 640 }]);
    testbed.resize(0);
    testbed.resize(640);
    await settle();
    expect(drawn).toEqual([{ rows: 1, width: 640 }]);
  });

  it('shows the error of a failed query in the chart', async () => {
    testbed.serveText('/p/shop/api/1/query', 'Unknown identifier status', 500);
    const { el } = testbed.render(requests);
    testbed.scrollIntoView();
    await settle();
    expect(body(el).textContent).toBe('Unknown identifier status');
  });

  it('names the page’s filters the chart ignores in its title row, by their ids, until it ignores none', async () => {
    testbed.serve('/p/shop/api/1/query', { cnt: [3] }, { 'X-Dashica-Diagnostics': '{"ignored":["host","path"]}' });
    const { el } = testbed.render(requests);
    testbed.scrollIntoView();
    await settle();
    const ignored = el.querySelector<HTMLElement>('.d-chart-frame__ignored')!;
    expect(ignored.hidden).toBe(false);
    expect(ignored.textContent).toBe('ignores host, path');
    expect(ignored.parentElement!.textContent).toBe('Requestsignores host, path');
    testbed.serve('/p/shop/api/1/query', { cnt: [3] });
    testbed.query.refresh();
    await settle();
    expect(ignored.hidden).toBe(true);
  });

  it('shows why a chart did not run in place of it, and draws it again once it runs', async () => {
    testbed.serveNothing('/p/shop/api/1/query', { 'X-Dashica-Diagnostics': '{"skipped":"pick a host","ignored":["path"]}' });
    const { el } = testbed.render(requests);
    testbed.scrollIntoView();
    await settle();
    expect(body(el).textContent).toBe('skipped: pick a host');
    expect(el.querySelector<HTMLElement>('.d-chart-frame__ignored')!.hidden).toBe(true);
    testbed.serve('/p/shop/api/1/query', { time: [1], cnt: [3] });
    testbed.query.refresh();
    await settle();
    expect(body(el).textContent).toBe('1 rows');
  });

  it('sets the page’s time range to the range dragged across the chart', async () => {
    testbed.serve('/p/shop/api/1/query', { cnt: [3] });
    testbed.render(requests);
    testbed.scrollIntoView();
    await settle();
    selectTime(new Date(2026, 9, 29, 10, 0), new Date(2026, 9, 29, 11, 30));
    expect(testbed.query.time.range).toBe('custom');
    expect(testbed.query.time.custom).toBe('2026-10-29 10:00 to 2026-10-29 11:30');
  });

  it('opens the widget’s menu from its button', () => {
    const { el } = testbed.render(requests);
    el.querySelector<HTMLButtonElement>('.d-chart-frame__menu button')!.click();
    expect(testbed.menus.map((menu) => menu.menuId)).toEqual(['widget/context']);
  });
});
