// @vitest-environment jsdom
// Tests for chart-frame.ts: the title above the chart, querying once in view and on a refresh, drawing again for
// another width, the error, the widget's decorations (a badge each, the chart muted while one says so), an answer
// without a table, the dragged time range, the menu button.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WidgetNode } from '../../generated/zz_generated.dashica';
import type { WidgetDecoration } from '../../hosts/widgets/widgets';
import { settle, widgetTestbed } from '../../hosts/widgets/widgets-testing';
import { TIME, type TimeRange } from '../time-library/time-state';
import { ChartFrame } from './chart-frame';

let testbed: ReturnType<typeof widgetTestbed>;

beforeEach(() => {
  // sent along, declared as by the time-range extension
  testbed = widgetTestbed({ keys: [TIME] });
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
  const muted = (el: HTMLElement) => el.querySelector('.d-chart-frame')!.classList.contains('d-chart-frame--muted');

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
    testbed.query.refresh();
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

  /** What the test's decoration provider gives each answer from now on. */
  let decorating: readonly WidgetDecoration[] = [];
  beforeEach(() => {
    decorating = [];
    testbed.widgets.registerDecorationProvider({ provideDecorations: () => decorating });
  });
  const badges = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.d-chart-frame__decoration')].map((badge) => ({ text: badge.textContent, title: badge.title }));
  const ignores: WidgetDecoration = { badge: 'ignores host = a', tooltip: 'not applied', muted: true, source: 'test' };

  it('draws a badge per decoration in its title row, with its tooltip, until it has none', async () => {
    decorating = [ignores, { badge: 'slow', source: 'test' }];
    testbed.serve('/p/shop/api/1/query', { cnt: [3] });
    const { el } = testbed.render(requests);
    testbed.scrollIntoView();
    await settle();
    expect(badges(el)).toEqual([
      { text: 'ignores host = a', title: 'not applied' },
      { text: 'slow', title: '' },
    ]);
    expect(el.querySelector('.d-chart-frame__title')!.textContent).toBe('Requestsignores host = aslow');
    decorating = [];
    testbed.query.refresh();
    await settle();
    expect(badges(el)).toEqual([]);
  });

  it('draws a chart muted while a decoration says so, and at full strength again without', async () => {
    const { el } = testbed.render(requests);
    expect(muted(el)).toBe(false);
    decorating = [ignores];
    testbed.serve('/p/shop/api/1/query', { cnt: [3] });
    testbed.scrollIntoView();
    await settle();
    expect(muted(el)).toBe(true);
    decorating = [{ badge: 'slow', source: 'test' }];
    testbed.query.refresh();
    await settle();
    expect(muted(el)).toBe(false);
  });

  it('has no decorations, unmuted, after a failed query', async () => {
    decorating = [ignores];
    testbed.serve('/p/shop/api/1/query', { cnt: [3] });
    const { el } = testbed.render(requests);
    testbed.scrollIntoView();
    await settle();
    testbed.serveText('/p/shop/api/1/query', 'Unknown identifier status', 500);
    testbed.query.refresh();
    await settle();
    expect(badges(el)).toEqual([]);
    expect(muted(el)).toBe(false);
  });

  it('shows the title row of a chart without title only for its badges', async () => {
    testbed.widgets.registerWidget('stats', (el, _widget, ctx) => new ChartFrame(el, ctx, { draw: () => document.createElement('figure') }));
    decorating = [ignores];
    testbed.serve('/p/shop/api/2/query', { cnt: [3] });
    const { el } = testbed.render({ type: 'stats', props: {}, dataUrl: '/p/shop/api/2' } as WidgetNode);
    const title = el.querySelector<HTMLElement>('.d-chart-frame__title')!;
    expect(title.hidden).toBe(true);
    testbed.scrollIntoView();
    await settle();
    expect(title.hidden).toBe(false);
  });

  it('draws nothing for an answer without a table (a chart that did not run), and draws it again once it runs', async () => {
    decorating = [{ badge: 'skipped: pick a host', source: 'test' }];
    testbed.serveNothing('/p/shop/api/1/query', {});
    const { el } = testbed.render(requests);
    testbed.scrollIntoView();
    await settle();
    expect(drawn).toEqual([]);
    expect(body(el).childElementCount).toBe(0);
    expect(badges(el).map(({ text }) => text)).toEqual(['skipped: pick a host']);
    decorating = [];
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
    expect(testbed.query.get(TIME)).toEqual({ range: 'custom', custom: '2026-10-29 10:00 to 2026-10-29 11:30' });
  });

  it('opens the widget’s menu from its button', () => {
    const { el } = testbed.render(requests);
    el.querySelector<HTMLButtonElement>('.d-chart-frame__menu button')!.click();
    expect(testbed.menus.map((menu) => menu.menuId)).toEqual(['widget/context']);
  });
});
