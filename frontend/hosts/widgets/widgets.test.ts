// @vitest-environment jsdom
// Tests for WidgetsHost and ChartFrame: rendering by type, the widget context (query, children, menu, filters), the
// selection, the active widget, the chart frame.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { WidgetNode } from '../../generated/zz_generated.dashica';
import { QueryHost } from '../query/query';
import { ChartFrame, WidgetsHost, type Selection, type WidgetContext, type WidgetMenuContext } from './widgets';
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

    it('adds a structured filter to the page, and sends it with the next query', async () => {
      ctx.addFilter('host', 'ne', 'a');
      expect(testbed.query.filters.chips).toEqual([{ kind: 'field', fieldId: 'host', op: 'ne', value: 'a' }]);
      testbed.serve('/p/shop/api/1/query', { cnt: [3] });
      await ctx.query();
      expect(testbed.requests[0].searchParams.getAll('f')).toEqual(['host:ne:a']);
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

  describe('the selection', () => {
    const contexts: WidgetContext[] = [];
    const bar = () => document.body.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'rect'));
    const statusBar = (value: string) => ({ kind: 'category', fieldId: 'status', value, anchor: bar() }) as const;

    beforeEach(() => {
      contexts.length = 0;
      testbed.widgets.registerWidget('barVertical', (_el, _widget, given) => {
        contexts.push(given);
        return new Disposable(() => {});
      });
      testbed.ui.registerMenuItem<Selection>('widget/selection', { command: 'test.filter', title: 'Filter by', when: (selection) => selection.kind === 'category' });
      testbed.ui.registerMenuItem<Selection>('widget/selection', { command: 'test.zoom', title: 'Zoom', when: (selection) => selection.kind !== 'category' });
    });

    const byStatus: WidgetNode = { type: 'barVertical', props: { x: { kind: 'expr', alias: 'status' }, y: { kind: 'count', alias: 'cnt' } }, dataUrl: '/p/shop/api/3' };
    const entries = () => [...(testbed.floatingBar()?.querySelectorAll('button') ?? [])].map((button) => button.textContent);

    it('is one at a time: selecting on another widget ends the selection before', () => {
      testbed.render(byStatus);
      testbed.render({ ...byStatus, dataUrl: '/p/shop/api/4' });
      contexts[0].select(statusBar('500'));
      expect(testbed.widgets.selection).toMatchObject({ kind: 'category', widgetId: '3', fieldId: 'status', value: '500' });
      contexts[1].select(statusBar('404'));
      expect(testbed.widgets.selection).toMatchObject({ widgetId: '4', value: '404' });
      expect(document.querySelectorAll('.d-workbench__floating-bar')).toHaveLength(1);
    });

    it('shows the floating bar widget/selection with the entries for its kind', () => {
      testbed.render(byStatus);
      contexts[0].select(statusBar('500'));
      expect(testbed.floatingBar()!.getAttribute('aria-label')).toBe('Selection');
      expect(entries()).toEqual(['Filter by']);
    });

    it('ends on Escape, on a click elsewhere, on clearSelection, and when its widget goes away', () => {
      const { rendered } = testbed.render(byStatus);
      const select = () => contexts[0].select(statusBar('500'));
      select();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(testbed.widgets.selection).toBeUndefined();
      expect(testbed.floatingBar()).toBeNull();
      select();
      document.body.click();
      expect(testbed.widgets.selection).toBeUndefined();
      select();
      contexts[0].clearSelection();
      expect(testbed.widgets.selection).toBeUndefined();
      select();
      rendered.dispose();
      expect(testbed.widgets.selection).toBeUndefined();
      expect(testbed.floatingBar()).toBeNull();
    });

    it('takes a selection on a view of a chart outside the page’s widgets, which ends on Escape as well', () => {
      testbed.render(byStatus);
      testbed.widgets.select({ ...statusBar('500'), widgetId: '3' });
      expect(testbed.widgets.selection).toMatchObject({ widgetId: '3', value: '500' });
      expect(entries()).toEqual(['Filter by']);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(testbed.widgets.selection).toBeUndefined();
    });

    it('pops up candidates to choose from, in order, also a single one; choosing one selects it; none change nothing', () => {
      testbed.render(byStatus);
      const anchor = bar();
      contexts[0].choose({ x: 10, y: 20 }, [statusBar('500'), { kind: 'category', fieldId: 'instance', value: 'web-1', anchor }]);
      expect(testbed.choices()).toEqual(['status = 500', 'instance = web-1']);
      expect(testbed.widgets.selection).toBeUndefined();
      testbed.choose('instance = web-1');
      expect(testbed.choices()).toEqual([]);
      expect(testbed.widgets.selection).toMatchObject({ kind: 'category', widgetId: '3', fieldId: 'instance', value: 'web-1', anchor });
      expect(entries()).toEqual(['Filter by']);
      contexts[0].choose({ x: 10, y: 20 }, [statusBar('404')]);
      expect(testbed.choices()).toEqual(['status = 404']);
      contexts[0].choose({ x: 10, y: 20 }, []);
      expect(testbed.choices()).toEqual(['status = 404']);
      (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(testbed.choices()).toEqual([]);
    });

    it('keeps the selection made by the click that is under way', () => {
      testbed.render(byStatus);
      const target = bar();
      target.addEventListener('click', () => contexts[0].select({ kind: 'category', fieldId: 'status', value: '500', anchor: target }));
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(testbed.widgets.selection?.value).toBe('500');
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

    it('tells how its query goes: rows and time, an error, its diagnostics', async () => {
      testbed.serve('/p/shop/api/1/query', { time: [1, 2, 3] }, { 'X-Dashica-Diagnostics': '{"ignored":["host"]}' });
      const { el } = testbed.render(requests);
      press(el);
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
      expect(changes).toBe(5);
    });

    it('is kept per tab: switching tabs shows that tab’s active widget', () => {
      const tabs = new EventEmitter<void>();
      const source = { activeQuery: new QueryHost(window), onDidChangeTabs: tabs.event };
      const other = new QueryHost(window);
      const ui = { showContextMenu() {}, showChoices() {}, registerFloatingBar: () => ({ show() {}, hide() {}, dispose() {} }) };
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

  it('shows the title until it is drawn, and queries only once it is in view', async () => {
    testbed.serve('/p/shop/api/1/query', { cnt: [3, 4] });
    const { el } = testbed.render(requests);
    expect(body(el).textContent).toBe('Requests');
    testbed.query.refresh();
    await settle();
    expect(testbed.requests).toHaveLength(0);
    testbed.scrollIntoView();
    await settle();
    expect(body(el).textContent).toBe('2 rows');
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

  it('names the page’s filters the chart ignores, by their ids, until it ignores none', async () => {
    testbed.serve('/p/shop/api/1/query', { cnt: [3] }, { 'X-Dashica-Diagnostics': '{"ignored":["host","path"]}' });
    const { el } = testbed.render(requests);
    testbed.scrollIntoView();
    await settle();
    const ignored = el.querySelector<HTMLElement>('.d-chart-frame__ignored')!;
    expect(ignored.hidden).toBe(false);
    expect(ignored.textContent).toBe('ignores host, path');
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
