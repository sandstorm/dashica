// @vitest-environment jsdom
// Tests for bar-vertical.ts: bars drawn from the widget’s data, sorted by their measure when asked, a click on a bar
// running filters.offer with its categories and the chart's pills.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settle, widgetTestbed } from '../../hosts/widgets/widgets-testing';
import { recordOffers, type RecordedOffer } from '../chart-library/offer-testing';
import { clickMark, pointAt } from '../chart-library/plot-testing';
import { barVertical } from './bar-vertical';

let testbed: ReturnType<typeof widgetTestbed>;
/** The runs of `filters.offer`, in order: what each click offered. */
let offers: RecordedOffer[];
/** The fields the server lets each chart here filter by (page.json's `filterable`). */
const filterable = ['status', 'host', 'region'];

beforeEach(() => {
  testbed = widgetTestbed();
  offers = recordOffers(testbed.commands);
  testbed.activate(barVertical);
});

afterEach(() => testbed.dispose());

const inView = async () => {
  testbed.resize(640);
  testbed.scrollIntoView();
  await settle();
};
const error = (el: HTMLElement) => el.querySelector('.d-widget-error')?.textContent;
/** The candidates the last click offered, as "status = 500". */
const offered = () => offers.at(-1)?.candidates.map(({ fieldId, value }) => `${fieldId} = ${value}`);

describe('barVertical', () => {
  it('draws the widget’s data once it is in view', async () => {
    testbed.serve('/p/shop/api/1/query', { status: ['200', '500'], cnt: [30, 2] });
    const { el } = testbed.render({ type: 'barVertical', props: { x: { kind: 'expr', alias: 'status' }, y: { kind: 'count', alias: 'cnt' } }, dataUrl: '/p/shop/api/1', filterable });
    await inView();
    expect(error(el)).toBeUndefined();
    expect(el.querySelectorAll('.d-chart-frame__body svg rect').length).toBeGreaterThan(0);
  });

  it('sorts the categories by their measure when asked, descending for sortReverse', async () => {
    testbed.serve('/p/shop/api/1/query', { status: ['200', '500'], cnt: [2, 30] });
    const { el } = testbed.render({ type: 'barVertical', props: { x: { kind: 'expr', alias: 'status' }, y: { kind: 'count', alias: 'cnt' }, sortReverse: true }, dataUrl: '/p/shop/api/1', filterable });
    await inView();
    const ticks = [...el.querySelectorAll('[aria-label="x-axis tick label"] text')].map((tick) => tick.textContent);
    expect(ticks).toEqual(['500', '200']);
  });

  describe('a click on a bar', () => {
    const bars = (el: HTMLElement) => [...el.querySelectorAll<SVGRectElement>('g[aria-label="bar"] rect')];
    const byStatus = (more: object = {}) =>
      ({ type: 'barVertical', props: { x: { kind: 'expr', alias: 'status' }, y: { kind: 'count', alias: 'cnt' } }, dataUrl: '/p/shop/api/1', filterable, ...more }) as const;

    it('runs filters.offer at the click with its category, also as the only candidate, and the chart’s pills', async () => {
      testbed.serve('/p/shop/api/1/query', { status: ['200', '500'], cnt: [30, 2] });
      const { el } = testbed.render(byStatus());
      await inView();
      await clickMark(bars(el)[1]);
      expect(offers).toEqual([
        { at: { x: expect.any(Number), y: expect.any(Number) }, candidates: [{ fieldId: 'status', value: '500' }], source: { dataUrl: '/p/shop/api/1', filterable } },
      ]);
    });

    it('offers each category of its row in the order of x, fill, fx, fy', async () => {
      testbed.serve('/p/shop/api/1/query', { status: ['200', '500'], host: ['a', 'b'], region: ['eu', 'us'], cnt: [30, 2] });
      const props = { ...byStatus().props, fill: { kind: 'expr', alias: 'host' }, fx: { kind: 'expr', alias: 'region' } } as const;
      const { el } = testbed.render(byStatus({ props }));
      await inView();
      await clickMark(bars(el).at(-1)!);
      expect(offered()).toEqual(['status = 500', 'host = b', 'region = us']);
    });

    it('offers again on the next click, on the same bar and on another: Plot does not pin its tip', async () => {
      testbed.serve('/p/shop/api/1/query', { status: ['200', '500'], cnt: [30, 2] });
      const { el } = testbed.render(byStatus());
      await inView();
      await clickMark(bars(el)[1]);
      await clickMark(bars(el)[1]);
      expect(offered()).toEqual(['status = 500']);
      await clickMark(bars(el)[0]);
      expect(offered()).toEqual(['status = 200']);
      expect(offers).toHaveLength(3);
    });

    it('stops a mouse’s pointerdown on a bar, on which Plot would pin its tip, and lets a touch or pen pass', async () => {
      testbed.serve('/p/shop/api/1/query', { status: ['200', '500'], cnt: [30, 2] });
      const { el } = testbed.render(byStatus());
      await inView();
      const seen: string[] = [];
      const listener = (event: Event) => seen.push((event as PointerEvent).pointerType);
      document.addEventListener('pointerdown', listener);
      await pointAt(bars(el)[1]);
      for (const pointerType of ['mouse', 'touch', 'pen']) {
        const down = new MouseEvent('pointerdown', { bubbles: true });
        Object.defineProperty(down, 'pointerType', { value: pointerType });
        bars(el)[1].dispatchEvent(down);
      }
      document.removeEventListener('pointerdown', listener);
      expect(seen).toEqual(['touch', 'pen']);
    });

    // a time bucket as x, which is never a candidate
    const byBucket = (more: object = {}) => byStatus({ props: { ...byStatus().props, x: { kind: 'autoBucket', alias: 'status', xBucketSizeMs: 900000 } }, ...more });

    it('offers the fill when the category is a time bucket, and nothing without a fill', async () => {
      testbed.serve('/p/shop/api/1/query', { status: ['200', '500'], host: ['a', 'b'], cnt: [30, 2] });
      const fill = { kind: 'expr', alias: 'host' } as const;
      const { el } = testbed.render(byBucket({ props: { ...byBucket().props, fill } }));
      await inView();
      await clickMark(bars(el)[1]);
      expect(offered()).toEqual(['host = b']);
      const { el: without } = testbed.render(byBucket());
      await inView();
      await clickMark(bars(without)[1]);
      expect(offers).toHaveLength(1);
    });

    it('looks clickable while Plot points at a bar, and never without a category', async () => {
      testbed.serve('/p/shop/api/1/query', { status: ['200', '500'], cnt: [30, 2] });
      const { el } = testbed.render(byStatus());
      const { el: without } = testbed.render(byBucket());
      await inView();
      const pointing = () => el.querySelector('.d-filter-on-click--pointing') !== null;
      expect(el.querySelector('.d-filter-on-click')).not.toBeNull();
      expect(pointing()).toBe(false);
      await pointAt(bars(el)[1]);
      expect(pointing()).toBe(true);
      expect(without.querySelector('.d-filter-on-click')).toBeNull();
    });

    it('never offers a measure, nor a NULL', async () => {
      testbed.serve('/p/shop/api/1/query', { status: ['200', null], host: ['a', 'b'], cnt: [30, 2] });
      const { el } = testbed.render(byStatus({ props: { ...byStatus().props, fill: { kind: 'expr', alias: 'host' } } }));
      await inView();
      await clickMark(bars(el)[1]);
      expect(offered()).toEqual(['host = b']);
      const { el: measured } = testbed.render({ ...byStatus(), props: { x: { kind: 'count', alias: 'cnt' }, y: { kind: 'count', alias: 'cnt' } } });
      await inView();
      if (bars(measured)[0]) await clickMark(bars(measured)[0]);
      expect(offers).toHaveLength(1);
    });

    it('offers the facet of a bar whose x is a time bucket', async () => {
      testbed.serve('/p/shop/api/1/query', { status: ['200', '500', '200'], region: ['eu', 'eu', 'us'], cnt: [30, 2, 4] });
      const { el } = testbed.render(byBucket({ props: { ...byBucket().props, fx: { kind: 'expr', alias: 'region' } } }));
      await inView();
      await clickMark(bars(el).at(-1)!);
      expect(offered()).toEqual(['region = us']);
    });
  });
});
