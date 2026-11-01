// @vitest-environment jsdom
// Tests for time-bar.ts: a time bar drawn from the widget's data; a click on a bar (also through the drag area above
// it) running filters.offer with its fill and facets, never its time bucket or measure, and the chart's pills; always
// those of the row the tip shows.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settle, widgetTestbed } from '../../hosts/widgets/widgets-testing';
import { recordOffers, type RecordedOffer } from '../chart-library/offer-testing';
import { anchor, clickAtPoint, clickMark } from '../chart-library/plot-testing';
import { timeBar } from './time-bar';

let testbed: ReturnType<typeof widgetTestbed>;
/** The runs of `filters.offer`, in order: what each click offered. */
let offers: RecordedOffer[];
/** The fields the server lets each chart here filter by (page.json's `filterable`). */
const filterable = ['level', 'region'];

beforeEach(() => {
  testbed = widgetTestbed();
  offers = recordOffers(testbed.commands);
  testbed.activate(timeBar);
});

afterEach(() => {
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
    /** The candidates the last click offered, as "level = error". */
    const offered = () => offers.at(-1)?.candidates.map(({ fieldId, value }) => `${fieldId} = ${value}`);
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
    const bars = (el: HTMLElement) => [...el.querySelectorAll<SVGRectElement>('g[aria-label="rect"] rect')];

    it('on a bar offers its fill, never its time bucket or measure, with the chart’s pills', async () => {
      const el = render();
      await inView();
      await clickMark(bars(el)[1]);
      expect(offers.map(({ candidates, source }) => ({ candidates, source }))).toEqual([
        { candidates: [{ fieldId: 'level', value: 'error' }], source: { dataUrl: '/p/shop/api/1', filterable } },
      ]);
    });

    it('on the drag area offers the bar Plot points at below it, again on the next click', async () => {
      const el = render();
      await inView();
      const overlay = () => el.querySelector('svg .overlay')!;
      await clickMark(bars(el)[2], overlay());
      expect(offered()).toEqual(['level = info']);
      await clickMark(bars(el)[1], overlay());
      expect(offered()).toEqual(['level = error']);
    });

    it('on a bar offers its fill and its facet', async () => {
      const el = render({ props: { ...props, fy: { kind: 'expr', alias: 'region' } } });
      await inView();
      await clickMark(bars(el).at(-1)!);
      expect(offered()).toEqual(['level = info', 'region = us']);
    });

    describe('offers the row the tip shows', () => {
      // many buckets, so a bar of the next bucket lies within Plot's pointer radius: bucket 0 holds a short "info",
      // bucket 1 a short "info" and a tall "error" above it
      const many = { 'X-Dashica-Resolved-Time-Range': JSON.stringify({ from: T0, to: T0 + 16 * QUARTER }) };
      const stacked = { time: [T0, T0 + QUARTER, T0 + QUARTER], level: ['info', 'info', 'error'], region: ['eu', 'eu', 'eu'], cnt: [1, 1, 10] };
      const shown = (el: HTMLElement) => /level (\S+)/.exec(el.querySelector('g[aria-label="tip"]')?.textContent ?? '')?.[1];
      /** Clicks the drag area right of bucket 0's bar, at the height of bucket 1's "error", and in a bar's middle. */
      const clicks = async (el: HTMLElement) => {
        const overlay = el.querySelector('svg .overlay')!;
        const [short, , tall] = bars(el);
        const said: [string | undefined, string | undefined][] = [];
        const [x] = anchor(short!);
        const width = Number(short!.getAttribute('width'));
        for (const at of [[x + 0.4 * width, anchor(tall!)[1]], anchor(tall!), anchor(short!), [x + 0.4 * width, anchor(tall!)[1]]] as [number, number][]) {
          await clickAtPoint(overlay, at);
          said.push([shown(el), offers.at(-1)?.candidates[0]?.value as string | undefined]);
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
      const el = render({ props: { ...unfilled, fy: { kind: 'expr', alias: 'region' } } });
      await inView();
      await clickMark(bars(el).at(-1)!);
      expect(offered()).toEqual(['region = us']);
    });
  });
});
