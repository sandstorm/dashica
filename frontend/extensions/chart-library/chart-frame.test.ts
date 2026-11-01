// @vitest-environment jsdom
// Tests for chart-frame.ts: the title above the chart, querying once in view and on a refresh, drawing again for
// another width, the error, the widget's decorations (a badge each, the chart muted while one says so), an answer
// without a table, the dragged time range, the time cursor told to the last draw only, the menu button.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WidgetNode } from '../../generated/zz_generated.dashica';
import type { TimeCursor, WidgetDecoration } from '../../hosts/widgets/widgets';
import { settle, widgetTestbed } from '../../hosts/widgets/widgets-testing';
import { TIME, type TimeRange } from '../time-library/time-state';
import { ChartFrame } from './chart-frame';

let testbed: ReturnType<typeof widgetTestbed>;

beforeEach(() => {
  // sent along, declared as by the time-range extension
  process.env.TZ = 'Europe/Berlin';
  testbed = widgetTestbed({ keys: [TIME] });
});

afterEach(() => {
  delete process.env.TZ;
  testbed.dispose();
});

const requests: WidgetNode = { type: 'timeBar', props: { title: 'Requests', x: { kind: 'expr', alias: 'time' }, y: { kind: 'count', alias: 'cnt' } }, dataUrl: '/p/shop/api/1' };

describe('ChartFrame', () => {
  const drawn: { rows: number; width: number }[] = [];
  let selectTime: (from: Date, to: Date) => void;
  /** Each draw's time cursor, in order. */
  const cursors: TimeCursor[] = [];

  beforeEach(() => {
    drawn.length = 0;
    cursors.length = 0;
    testbed.widgets.registerWidget(
      'timeBar',
      (widgetContainer, widget, ctx) =>
        new ChartFrame(widgetContainer, ctx, {
          title: widget.props.title,
          height: 200,
          draw(result, { width, onTimeSelect, timeCursor }) {
            selectTime = onTimeSelect;
            cursors.push(timeCursor);
            drawn.push({ rows: result.numRows, width });
            const chartElement = document.createElement('figure');
            chartElement.textContent = `${result.numRows} rows`;
            return chartElement;
          },
        }),
    );
  });

  const body = (widgetContainer: HTMLElement) => widgetContainer.querySelector('.d-chart-frame__body')!;
  const muted = (widgetContainer: HTMLElement) => widgetContainer.querySelector('.d-chart-frame')!.classList.contains('d-chart-frame--muted');

  it('shows the title above the chart, and queries only once it is in view', async () => {
    testbed.serve('/p/shop/api/1/query', { cnt: [3, 4] });
    const { widgetContainer } = testbed.render(requests);
    const titleElement = widgetContainer.querySelector<HTMLElement>('.d-chart-frame__title')!;
    expect(titleElement.textContent).toBe('Requests');
    expect(titleElement.nextElementSibling!.contains(body(widgetContainer))).toBe(true);
    testbed.query.refresh();
    await settle();
    expect(testbed.requests).toHaveLength(0);
    testbed.scrollIntoView();
    await settle();
    expect(body(widgetContainer).textContent).toBe('2 rows');
    expect(titleElement.textContent).toBe('Requests');
  });

  it('tells the time cursor’s change to the last draw only, not once removed', async () => {
    testbed.serve('/p/shop/api/1/query', { cnt: [3] });
    const { rendered } = testbed.render(requests);
    testbed.resize(640);
    testbed.scrollIntoView();
    await settle();
    testbed.resize(320);
    await settle();
    const told = cursors.map(() => 0);
    cursors.forEach((cursor, at) => cursor.onDidChange(() => told[at]++));
    cursors[1].set(1_000);
    expect(told).toEqual([0, 1]);
    expect(cursors[0].time).toBe(1_000);
    rendered.dispose();
    testbed.widgets.timeCursor.set(2_000);
    expect(told).toEqual([0, 1]);
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
    const { widgetContainer } = testbed.render(requests);
    testbed.scrollIntoView();
    await settle();
    expect(body(widgetContainer).textContent).toBe('Unknown identifier status');
  });

  /** What the test's decoration provider gives each answer from now on. */
  let decorating: readonly WidgetDecoration[] = [];
  beforeEach(() => {
    decorating = [];
    testbed.widgets.registerDecorationProvider({ provideDecorations: () => decorating });
  });
  const badges = (widgetContainer: HTMLElement) => [...widgetContainer.querySelectorAll<HTMLElement>('.d-chart-frame__decoration')].map((badgeElement) => ({ text: badgeElement.textContent, title: badgeElement.title }));
  const ignores: WidgetDecoration = { badge: 'ignores host = a', tooltip: 'not applied', muted: true, source: 'test' };

  it('draws a badge per decoration in its title row, with its tooltip, until it has none', async () => {
    decorating = [ignores, { badge: 'slow', source: 'test' }];
    testbed.serve('/p/shop/api/1/query', { cnt: [3] });
    const { widgetContainer } = testbed.render(requests);
    testbed.scrollIntoView();
    await settle();
    expect(badges(widgetContainer)).toEqual([
      { text: 'ignores host = a', title: 'not applied' },
      { text: 'slow', title: '' },
    ]);
    expect(widgetContainer.querySelector('.d-chart-frame__title')!.textContent).toBe('Requestsignores host = aslow');
    decorating = [];
    testbed.query.refresh();
    await settle();
    expect(badges(widgetContainer)).toEqual([]);
  });

  it('draws a chart muted while a decoration says so, and at full strength again without', async () => {
    const { widgetContainer } = testbed.render(requests);
    expect(muted(widgetContainer)).toBe(false);
    decorating = [ignores];
    testbed.serve('/p/shop/api/1/query', { cnt: [3] });
    testbed.scrollIntoView();
    await settle();
    expect(muted(widgetContainer)).toBe(true);
    decorating = [{ badge: 'slow', source: 'test' }];
    testbed.query.refresh();
    await settle();
    expect(muted(widgetContainer)).toBe(false);
  });

  it('has no decorations, unmuted, after a failed query', async () => {
    decorating = [ignores];
    testbed.serve('/p/shop/api/1/query', { cnt: [3] });
    const { widgetContainer } = testbed.render(requests);
    testbed.scrollIntoView();
    await settle();
    testbed.serveText('/p/shop/api/1/query', 'Unknown identifier status', 500);
    testbed.query.refresh();
    await settle();
    expect(badges(widgetContainer)).toEqual([]);
    expect(muted(widgetContainer)).toBe(false);
  });

  it('shows the title row of a chart without title only for its badges', async () => {
    testbed.widgets.registerWidget('stats', (widgetContainer, _widget, ctx) => new ChartFrame(widgetContainer, ctx, { draw: () => document.createElement('figure') }));
    decorating = [ignores];
    testbed.serve('/p/shop/api/2/query', { cnt: [3] });
    const { widgetContainer } = testbed.render({ type: 'stats', props: {}, dataUrl: '/p/shop/api/2' } as WidgetNode);
    const titleElement = widgetContainer.querySelector<HTMLElement>('.d-chart-frame__title')!;
    expect(titleElement.hidden).toBe(true);
    testbed.scrollIntoView();
    await settle();
    expect(titleElement.hidden).toBe(false);
  });

  it('draws nothing for an answer without a table (a chart that did not run), and draws it again once it runs', async () => {
    decorating = [{ badge: 'skipped: pick a host', source: 'test' }];
    testbed.serveNothing('/p/shop/api/1/query', {});
    const { widgetContainer } = testbed.render(requests);
    testbed.scrollIntoView();
    await settle();
    expect(drawn).toEqual([]);
    expect(body(widgetContainer).childElementCount).toBe(0);
    expect(badges(widgetContainer).map(({ text }) => text)).toEqual(['skipped: pick a host']);
    decorating = [];
    testbed.serve('/p/shop/api/1/query', { time: [1], cnt: [3] });
    testbed.query.refresh();
    await settle();
    expect(body(widgetContainer).textContent).toBe('1 rows');
  });

  it('sets the page’s time range to the range dragged across the chart', async () => {
    testbed.serve('/p/shop/api/1/query', { cnt: [3] });
    testbed.render(requests);
    testbed.scrollIntoView();
    await settle();
    selectTime(new Date(Date.UTC(2026, 9, 29, 9, 0)), new Date(Date.UTC(2026, 9, 29, 10, 30)));
    // in the viewer's time zone, here Berlin's, with its offset
    expect(testbed.query.get(TIME)).toEqual({ range: 'custom', custom: '2026-10-29 10:00+01:00 to 2026-10-29 11:30+01:00' });
  });

  it('opens the widget’s menu from its button', () => {
    const { widgetContainer } = testbed.render(requests);
    widgetContainer.querySelector<HTMLButtonElement>('.d-chart-frame__menu button')!.click();
    expect(testbed.menus.map((menu) => menu.menuId)).toEqual(['widget/context']);
  });
});
