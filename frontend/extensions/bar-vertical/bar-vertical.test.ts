// @vitest-environment jsdom
// Tests for bar-vertical.ts: bars drawn from the widget’s data, sorted by their measure when asked, a click on a bar
// showing the data point menu of its categories for the chart.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settle, widgetTestbed, dataUrlOf, type RecordedDataPointMenu } from '../../hosts/widgets/widgets-testing';
import { clickMark, pointAt } from '../chart-library/plot-testing';
import { barVertical } from './bar-vertical';

let testbed: ReturnType<typeof widgetTestbed>;
/** The data point menus shown, in order: what each click showed. */
let offers: readonly RecordedDataPointMenu[];
/** The fields the server lets each chart here filter by (page.json's `filterable`). */
const filterable = ['status', 'host', 'region'];

beforeEach(() => {
  testbed = widgetTestbed();
  offers = testbed.dataPointMenus;
  testbed.activate(barVertical);
});

afterEach(() => testbed.dispose());

const inView = async () => {
  testbed.resize(640);
  testbed.scrollIntoView();
  await settle();
};
const error = (widgetContainer: HTMLElement) => widgetContainer.querySelector('.d-widget-error')?.textContent;
/** The data points the last click showed, as "status = 500". */
const offered = () => offers.at(-1)?.dataPoints.map(({ field, value }) => `${field} = ${value}`);

describe('barVertical', () => {
  it('draws the widget’s data once it is in view', async () => {
    testbed.serve('/p/shop/api/1/query', { status: ['200', '500'], cnt: [30, 2] });
    const { widgetContainer } = testbed.render({ type: 'barVertical', props: { x: { kind: 'expr', alias: 'status' }, y: { kind: 'count', alias: 'cnt' } }, dataUrl: '/p/shop/api/1', filterable });
    await inView();
    expect(error(widgetContainer)).toBeUndefined();
    expect(widgetContainer.querySelectorAll('.d-chart-frame__body svg rect').length).toBeGreaterThan(0);
  });

  it('sorts the categories by their measure when asked, descending for sortReverse', async () => {
    testbed.serve('/p/shop/api/1/query', { status: ['200', '500'], cnt: [2, 30] });
    const { widgetContainer } = testbed.render({ type: 'barVertical', props: { x: { kind: 'expr', alias: 'status' }, y: { kind: 'count', alias: 'cnt' }, sortReverse: true }, dataUrl: '/p/shop/api/1', filterable });
    await inView();
    const ticks = [...widgetContainer.querySelectorAll('[aria-label="x-axis tick label"] text')].map((tickElement) => tickElement.textContent);
    expect(ticks).toEqual(['500', '200']);
  });

  describe('a click on a bar', () => {
    const bars = (widgetContainer: HTMLElement) => [...widgetContainer.querySelectorAll<SVGRectElement>('g[aria-label="bar"] rect')];
    const byStatus = (more: object = {}) =>
      ({ type: 'barVertical', props: { x: { kind: 'expr', alias: 'status' }, y: { kind: 'count', alias: 'cnt' } }, dataUrl: '/p/shop/api/1', filterable, ...more }) as const;

    it('shows the data point menu at the click of its category, also as the only data point, for the chart', async () => {
      testbed.serve('/p/shop/api/1/query', { status: ['200', '500'], cnt: [30, 2] });
      const { widgetContainer } = testbed.render(byStatus());
      await inView();
      await clickMark(bars(widgetContainer)[1]);
      expect(offers.map(({ at, dataPoints, widget }) => ({ at, dataPoints, dataUrl: dataUrlOf(widget) }))).toEqual([
        { at: { x: expect.any(Number), y: expect.any(Number) }, dataPoints: [{ field: 'status', value: '500' }], dataUrl: '/p/shop/api/1' },
      ]);
    });

    it('offers each category of its row in the order of x, fill, fx, fy', async () => {
      testbed.serve('/p/shop/api/1/query', { status: ['200', '500'], host: ['a', 'b'], region: ['eu', 'us'], cnt: [30, 2] });
      const props = { ...byStatus().props, fill: { kind: 'expr', alias: 'host' }, fx: { kind: 'expr', alias: 'region' } } as const;
      const { widgetContainer } = testbed.render(byStatus({ props }));
      await inView();
      await clickMark(bars(widgetContainer).at(-1)!);
      expect(offered()).toEqual(['status = 500', 'host = b', 'region = us']);
    });

    it('offers again on the next click, on the same bar and on another: Plot does not pin its tip', async () => {
      testbed.serve('/p/shop/api/1/query', { status: ['200', '500'], cnt: [30, 2] });
      const { widgetContainer } = testbed.render(byStatus());
      await inView();
      await clickMark(bars(widgetContainer)[1]);
      await clickMark(bars(widgetContainer)[1]);
      expect(offered()).toEqual(['status = 500']);
      await clickMark(bars(widgetContainer)[0]);
      expect(offered()).toEqual(['status = 200']);
      expect(offers).toHaveLength(3);
    });

    it('stops a mouse’s pointerdown on a bar, on which Plot would pin its tip, and lets a touch or pen pass', async () => {
      testbed.serve('/p/shop/api/1/query', { status: ['200', '500'], cnt: [30, 2] });
      const { widgetContainer } = testbed.render(byStatus());
      await inView();
      const seen: string[] = [];
      const listener = (event: Event) => seen.push((event as PointerEvent).pointerType);
      document.addEventListener('pointerdown', listener);
      await pointAt(bars(widgetContainer)[1]);
      for (const pointerType of ['mouse', 'touch', 'pen']) {
        const down = new MouseEvent('pointerdown', { bubbles: true });
        Object.defineProperty(down, 'pointerType', { value: pointerType });
        bars(widgetContainer)[1].dispatchEvent(down);
      }
      document.removeEventListener('pointerdown', listener);
      expect(seen).toEqual(['touch', 'pen']);
    });

    // a time bucket as x, which is never a candidate
    const byBucket = (more: object = {}) => byStatus({ props: { ...byStatus().props, x: { kind: 'autoBucket', alias: 'status', xBucketSizeMs: 900000 } }, ...more });

    it('offers the fill when the category is a time bucket, and nothing without a fill', async () => {
      testbed.serve('/p/shop/api/1/query', { status: ['200', '500'], host: ['a', 'b'], cnt: [30, 2] });
      const fill = { kind: 'expr', alias: 'host' } as const;
      const { widgetContainer } = testbed.render(byBucket({ props: { ...byBucket().props, fill } }));
      await inView();
      await clickMark(bars(widgetContainer)[1]);
      expect(offered()).toEqual(['host = b']);
      const { widgetContainer: withoutElement } = testbed.render(byBucket());
      await inView();
      await clickMark(bars(withoutElement)[1]);
      expect(offers).toHaveLength(1);
    });

    it('looks clickable while Plot points at a bar, and never without a category', async () => {
      testbed.serve('/p/shop/api/1/query', { status: ['200', '500'], cnt: [30, 2] });
      const { widgetContainer } = testbed.render(byStatus());
      const { widgetContainer: withoutElement } = testbed.render(byBucket());
      await inView();
      const pointing = () => widgetContainer.querySelector('.d-filter-on-click--pointing') !== null;
      expect(widgetContainer.querySelector('.d-filter-on-click')).not.toBeNull();
      expect(pointing()).toBe(false);
      await pointAt(bars(widgetContainer)[1]);
      expect(pointing()).toBe(true);
      expect(withoutElement.querySelector('.d-filter-on-click')).toBeNull();
    });

    it('never offers a measure, nor a NULL', async () => {
      testbed.serve('/p/shop/api/1/query', { status: ['200', null], host: ['a', 'b'], cnt: [30, 2] });
      const { widgetContainer } = testbed.render(byStatus({ props: { ...byStatus().props, fill: { kind: 'expr', alias: 'host' } } }));
      await inView();
      await clickMark(bars(widgetContainer)[1]);
      expect(offered()).toEqual(['host = b']);
      const { widgetContainer: measuredElement } = testbed.render({ ...byStatus(), props: { x: { kind: 'count', alias: 'cnt' }, y: { kind: 'count', alias: 'cnt' } } });
      await inView();
      if (bars(measuredElement)[0]) await clickMark(bars(measuredElement)[0]);
      expect(offers).toHaveLength(1);
    });

    it('offers the facet of a bar whose x is a time bucket', async () => {
      testbed.serve('/p/shop/api/1/query', { status: ['200', '500', '200'], region: ['eu', 'eu', 'us'], cnt: [30, 2, 4] });
      const { widgetContainer } = testbed.render(byBucket({ props: { ...byBucket().props, fx: { kind: 'expr', alias: 'region' } } }));
      await inView();
      await clickMark(bars(widgetContainer).at(-1)!);
      expect(offered()).toEqual(['region = us']);
    });
  });
});
