// @vitest-environment jsdom
// Tests for WidgetsHost and ChartFrame: rendering by type, the widget context (query, children, menu), the chart frame.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import type { WidgetNode } from '../../generated/zz_generated.dashica';
import { ChartFrame, type WidgetContext, type WidgetMenuContext } from './widgets';
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
      testbed.query.filters.setSql('status >= 500');
      testbed.serve('/p/shop/api/1/query', { cnt: [3] }, { 'X-Dashica-Bucket-Size': '900000', 'X-Dashica-Resolved-Time-Range': '{"from":1,"to":2}' });
      const result = await ctx.query();
      expect(result.toArray().map((row) => row.cnt)).toEqual([3]);
      expect(result.dashicaBucketSize).toBe(900000);
      expect(result.dashicaResolvedTimeRange).toEqual({ from: 1, to: 2 });
      expect(JSON.parse(testbed.requests[0].searchParams.get('filters')!).sqlFilter).toBe('status >= 500');
    });

    it('rejects with the server’s message', async () => {
      testbed.serveText('/p/shop/api/1/query', 'Unknown identifier status', 500);
      await expect(ctx.query()).rejects.toThrow('Unknown identifier status');
    });

    it('names URLs below the widget’s handler with the page’s query state', () => {
      expect(ctx.url('/speedscope-query')).toMatch(/^\/p\/shop\/api\/1\/speedscope-query\?filters=/);
    });

    it('shows the menu widget/context for the widget, with what it queried last', async () => {
      testbed.serve('/p/shop/api/1/query', { cnt: [3] });
      await ctx.query();
      const anchor = document.body.appendChild(document.createElement('button'));
      ctx.showMenu(anchor);
      const [{ menuId, options }] = testbed.menus;
      expect(menuId).toBe('widget/context');
      expect(options.title).toBe('timeBar');
      const context = options.args![0] as WidgetMenuContext;
      expect(context.widget).toBe(requests);
      expect(context.lastResult?.numRows).toBe(1);
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

  it('shows the error of a failed query in the chart', async () => {
    testbed.serveText('/p/shop/api/1/query', 'Unknown identifier status', 500);
    const { el } = testbed.render(requests);
    testbed.scrollIntoView();
    await settle();
    expect(body(el).textContent).toBe('Unknown identifier status');
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
