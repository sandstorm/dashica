// @vitest-environment jsdom
// Tests for time-bar.ts: a time bar drawn from the widget's data; a click on a bar (also through the drag area above
// it) showing the data point menu of its fill and facets, never its time bucket or measure, for the chart; always
// those of the row the tip shows. The tip's time bucket in the viewer's time zone (here Berlin's), the axis naming it;
// the time cursor the pointer on one time bar sets, drawn on every time bar.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settle, widgetTestbed, dataUrlOf, type RecordedDataPointMenu } from '../../hosts/widgets/widgets-testing';
import { anchor, clickAtPoint, clickMark, pointAt } from '../chart-library/plot-testing';
import { timeBar } from './time-bar';

let testbed: ReturnType<typeof widgetTestbed>;
/** The data point menus shown, in order: what each click showed. */
let offers: readonly RecordedDataPointMenu[];
/** The fields the server lets each chart here filter by (page.json's `filterable`). */
const filterable = ['level', 'region'];

beforeEach(() => {
  process.env.TZ = 'Europe/Berlin';
  testbed = widgetTestbed();
  offers = testbed.dataPointMenus;
  testbed.activate(timeBar);
});

afterEach(() => {
  delete process.env.TZ;
  testbed.dispose();
  vi.restoreAllMocks();
});

describe('timeBar', () => {
  it('draws the widget’s data once it is in view', async () => {
    testbed.serve('/p/shop/api/1/query', { time: [Date.UTC(2026, 9, 29, 10), Date.UTC(2026, 9, 29, 10, 15)], cnt: [3, 5] }, { 'X-Dashica-Resolved-Time-Range': JSON.stringify({ from: Date.UTC(2026, 9, 29, 10), to: Date.UTC(2026, 9, 29, 11) }) });
    const { widgetContainer } = testbed.render({ type: 'timeBar', props: { title: 'Requests', x: { kind: 'expr', alias: 'time', xBucketSizeMs: 900000 }, y: { kind: 'count', alias: 'cnt' } }, dataUrl: '/p/shop/api/1', filterable });
    testbed.resize(640);
    testbed.scrollIntoView();
    await settle();
    expect(widgetContainer.querySelector('.d-widget-error')?.textContent).toBeUndefined();
    expect(widgetContainer.querySelectorAll('.d-chart-frame__body svg rect').length).toBeGreaterThan(0);
    // the time selection: an area to drag across
    expect(widgetContainer.querySelector('.d-chart-frame__body svg .overlay')).not.toBeNull();
  });

  describe('a click', () => {
    /** The data points the last click showed, as "level = error". */
    const offered = () => offers.at(-1)?.dataPoints.map(({ field, value }) => `${field} = ${value}`);
    const T0 = Date.UTC(2026, 9, 29, 10);
    const QUARTER = 15 * 60 * 1000;
    const range = { 'X-Dashica-Resolved-Time-Range': JSON.stringify({ from: T0, to: T0 + 4 * QUARTER }) };
    const rows = { time: [T0, T0, T0 + QUARTER], level: ['info', 'error', 'info'], region: ['eu', 'eu', 'us'], cnt: [3, 1, 5] };
    const props = { x: { kind: 'expr', alias: 'time', xBucketSizeMs: QUARTER }, y: { kind: 'count', alias: 'cnt' }, fill: { kind: 'enum', alias: 'level' } } as const;
    const render = (more: object = {}) => {
      testbed.serve('/p/shop/api/1/query', rows, range);
      return testbed.render({ type: 'timeBar', props, dataUrl: '/p/shop/api/1', filterable, ...more }).widgetContainer;
    };
    const inView = async () => {
      testbed.resize(640);
      testbed.scrollIntoView();
      await settle();
    };
    const bars = (widgetContainer: HTMLElement) => [...widgetContainer.querySelectorAll<SVGRectElement>('g[aria-label="rect"] rect')];

    it('on a bar offers its fill, never its time bucket or measure, for the chart', async () => {
      const widgetContainer = render();
      await inView();
      await clickMark(bars(widgetContainer)[1]);
      expect(offers.map(({ dataPoints, widget }) => ({ dataPoints, dataUrl: dataUrlOf(widget) }))).toEqual([
        { dataPoints: [{ field: 'level', value: 'error' }], dataUrl: '/p/shop/api/1' },
      ]);
    });

    it('on the drag area offers the bar Plot points at below it, again on the next click', async () => {
      const widgetContainer = render();
      await inView();
      const overlay = () => widgetContainer.querySelector('svg .overlay')!;
      await clickMark(bars(widgetContainer)[2], overlay());
      expect(offered()).toEqual(['level = info']);
      await clickMark(bars(widgetContainer)[1], overlay());
      expect(offered()).toEqual(['level = error']);
    });

    it('on a bar offers its fill and its facet', async () => {
      const widgetContainer = render({ props: { ...props, fy: { kind: 'expr', alias: 'region' } } });
      await inView();
      await clickMark(bars(widgetContainer).at(-1)!);
      expect(offered()).toEqual(['level = info', 'region = us']);
    });

    describe('offers the row the tip shows', () => {
      // many buckets, so a bar of the next bucket lies within Plot's pointer radius: bucket 0 holds a short "info",
      // bucket 1 a short "info" and a tall "error" above it
      const many = { 'X-Dashica-Resolved-Time-Range': JSON.stringify({ from: T0, to: T0 + 16 * QUARTER }) };
      const stacked = { time: [T0, T0 + QUARTER, T0 + QUARTER], level: ['info', 'info', 'error'], region: ['eu', 'eu', 'eu'], cnt: [1, 1, 10] };
      const shown = (widgetContainer: HTMLElement) => /level (\S+)/.exec(widgetContainer.querySelector('g[aria-label="tip"]')?.textContent ?? '')?.[1];
      /** Clicks the drag area right of bucket 0's bar, at the height of bucket 1's "error", and in a bar's middle. */
      const clicks = async (widgetContainer: HTMLElement) => {
        const overlayContainer = widgetContainer.querySelector('svg .overlay')!;
        const [shortElement, , tallElement] = bars(widgetContainer);
        const said: [string | undefined, string | undefined][] = [];
        const [x] = anchor(shortElement!);
        const width = Number(shortElement!.getAttribute('width'));
        for (const at of [[x + 0.4 * width, anchor(tallElement!)[1]], anchor(tallElement!), anchor(shortElement!), [x + 0.4 * width, anchor(tallElement!)[1]]] as [number, number][]) {
          await clickAtPoint(overlayContainer, at);
          said.push([shown(widgetContainer), offers.at(-1)?.dataPoints[0]?.value as string | undefined]);
        }
        return said;
      };

      it('on stacked bars, where the closest bar is another bucket’s', async () => {
        testbed.serve('/p/shop/api/1/query', stacked, many);
        const { widgetContainer } = testbed.render({ type: 'timeBar', props, dataUrl: '/p/shop/api/1', filterable });
        await inView();
        expect(await clicks(widgetContainer)).toEqual([
          ['info', 'info'],
          ['error', 'error'],
          ['info', 'info'],
          ['info', 'info'],
        ]);
      });

      it('on a faceted chart', async () => {
        testbed.serve('/p/shop/api/1/query', { time: [...stacked.time, T0], level: [...stacked.level, 'error'], region: [...stacked.region, 'us'], cnt: [...stacked.cnt, 4] }, many);
        const { widgetContainer } = testbed.render({ type: 'timeBar', props: { ...props, fy: { kind: 'expr', alias: 'region' } }, dataUrl: '/p/shop/api/1', filterable });
        await inView();
        expect(await clicks(widgetContainer)).toEqual([
          ['info', 'info'],
          ['error', 'error'],
          ['info', 'info'],
          ['info', 'info'],
        ]);
      });
    });

    it('on a bar without a fill offers its facet', async () => {
      const { fill: _, ...unfilled } = props;
      const widgetContainer = render({ props: { ...unfilled, fy: { kind: 'expr', alias: 'region' } } });
      await inView();
      await clickMark(bars(widgetContainer).at(-1)!);
      expect(offered()).toEqual(['region = us']);
    });
  });

  describe('time', () => {
    const T0 = Date.UTC(2026, 9, 31, 19, 45);
    const QUARTER = 15 * 60 * 1000;
    const range = { 'X-Dashica-Resolved-Time-Range': JSON.stringify({ from: T0, to: T0 + 4 * QUARTER }) };
    const props = { x: { kind: 'expr', alias: 'time', xBucketSizeMs: QUARTER }, y: { kind: 'count', alias: 'cnt' } } as const;
    const render = (dataUrl: string) => {
      testbed.serve(`${dataUrl}/query`, { time: [T0, T0 + QUARTER], cnt: [3, 5] }, range);
      return testbed.render({ type: 'timeBar', props, dataUrl, filterable }).widgetContainer;
    };
    const inView = async () => {
      testbed.resize(640);
      testbed.scrollIntoView();
      await settle();
    };

    it('shows a bar’s bucket in the tip in local time, and the time zone on the axis', async () => {
      const widgetContainer = render('/p/shop/api/1');
      await inView();
      await pointAt(widgetContainer.querySelectorAll('g[aria-label="rect"] rect')[1]);
      expect(widgetContainer.querySelector('g[aria-label="tip"]')?.textContent).toContain('time Sat 2026-10-31 21:00–21:15');
      expect(widgetContainer.querySelector('g[aria-label="x-axis label"]')?.textContent).toContain('time (local, UTC+1)');
    });

    it('draws where the pointer is on one time bar on every time bar, until it leaves', async () => {
      const pointedContainer = render('/p/shop/api/1');
      const otherContainer = render('/p/shop/api/2');
      await inView();
      const cursorX = (widgetContainer: HTMLElement) => {
        const lineElement = widgetContainer.querySelector('.d-time-cursor')!;
        return lineElement.getAttribute('visibility') === 'visible' ? Number(lineElement.getAttribute('x1')) : undefined;
      };
      expect([cursorX(pointedContainer), cursorX(otherContainer)]).toEqual([undefined, undefined]);
      const [x] = await pointAt(pointedContainer.querySelectorAll('g[aria-label="rect"] rect')[1]);
      expect(cursorX(pointedContainer)).toBeCloseTo(x);
      expect(cursorX(otherContainer)).toBeCloseTo(x);
      expect(new Date(testbed.widgets.timeCursor.time!).toISOString()).toMatch(/^2026-10-31T20:0/);
      (pointedContainer.querySelector<SVGElement>('.d-time-cursor')!.ownerSVGElement!).dispatchEvent(new MouseEvent('pointerleave'));
      expect([cursorX(pointedContainer), cursorX(otherContainer)]).toEqual([undefined, undefined]);
    });
  });
});
