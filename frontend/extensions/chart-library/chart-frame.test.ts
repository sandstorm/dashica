// @vitest-environment jsdom
// Tests for chart-frame.ts: the title above the chart, querying once in view and on a refresh, drawing again for
// another width, the error, the ignored and skipped Diagnostics, the dragged time range, the menu button.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WidgetNode } from '../../generated/zz_generated.dashica';
import { settle, widgetTestbed } from '../../hosts/widgets/widgets-testing';
import { ChartFrame } from './chart-frame';

let testbed: ReturnType<typeof widgetTestbed>;

beforeEach(() => {
  testbed = widgetTestbed();
});

afterEach(() => testbed.dispose());

const requests: WidgetNode = { type: 'timeBar', props: { title: 'Requests', x: { kind: 'expr', alias: 'time' }, y: { kind: 'count', alias: 'cnt' } }, dataUrl: '/p/shop/api/1' };

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
