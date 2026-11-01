// @vitest-environment jsdom
// Tests for time-line.ts: a line drawn from the widget’s data, in its stroke color or one per strokeField value; a
// click on a line running filters.offer with its zField and strokeField and the chart's pills, also through the
// drag area above it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settle, widgetTestbed } from '../../hosts/widgets/widgets-testing';
import { recordOffers, type RecordedOffer } from '../chart-library/offer-testing';
import { clickMark } from '../chart-library/plot-testing';
import { timeLine } from './time-line';

let testbed: ReturnType<typeof widgetTestbed>;
/** The runs of `filters.offer`, in order: what each click offered. */
let offers: RecordedOffer[];
/** The fields the server lets each chart here filter by (page.json's `filterable`). */
const filterable = ['host', 'session'];

beforeEach(() => {
  testbed = widgetTestbed();
  offers = recordOffers(testbed.commands);
  testbed.activate(timeLine);
});

afterEach(() => testbed.dispose());

const T0 = Date.UTC(2026, 9, 29, 10);
const QUARTER = 15 * 60 * 1000;
const inView = async () => {
  testbed.resize(640);
  testbed.scrollIntoView();
  await settle();
};
const error = (widgetContainer: HTMLElement) => widgetContainer.querySelector('.d-widget-error')?.textContent;

describe('timeLine', () => {
  it('draws the widget’s data once it is in view', async () => {
    testbed.serve('/p/shop/api/1/query', { time: [T0, T0 + QUARTER], cnt: [3, 5] });
    const { widgetContainer } = testbed.render({ type: 'timeLine', props: { x: { kind: 'autoBucket', alias: 'time', xBucketSizeMs: QUARTER }, y: { kind: 'count', alias: 'cnt' } }, dataUrl: '/p/shop/api/1', filterable });
    await inView();
    expect(error(widgetContainer)).toBeUndefined();
    expect(widgetContainer.querySelectorAll('.d-chart-frame__body svg path').length).toBeGreaterThan(0);
  });

  it('draws a line in the color stroke, or one per value of strokeField, which wins', async () => {
    testbed.serve('/p/shop/api/1/query', { time: [T0, T0 + QUARTER], cnt: [3, 5], host: ['a', 'b'] });
    const x = { kind: 'expr' as const, alias: 'time', xBucketSizeMs: QUARTER };
    const y = { kind: 'count' as const, alias: 'cnt' };
    const coloredElement = testbed.render({ type: 'timeLine', props: { x, y, stroke: '#ff0000' }, dataUrl: '/p/shop/api/1', filterable }).widgetContainer;
    const perHostElement = testbed.render({ type: 'timeLine', props: { x, y, stroke: '#ff0000', strokeField: { kind: 'expr', alias: 'host' } }, dataUrl: '/p/shop/api/1', filterable }).widgetContainer;
    await inView();
    expect(coloredElement.querySelector('svg g[stroke="#ff0000"] path')).not.toBeNull();
    expect(perHostElement.querySelector('svg g[stroke="#ff0000"]')).toBeNull();
    expect(perHostElement.querySelectorAll('svg [aria-label="line"] path')).toHaveLength(2);
  });

  describe('a click', () => {
    const x = { kind: 'expr' as const, alias: 'time', xBucketSizeMs: QUARTER };
    const y = { kind: 'count' as const, alias: 'cnt' };
    const rows = { time: [T0, T0 + QUARTER, T0, T0 + QUARTER], cnt: [3, 5, 1, 2], host: ['a', 'a', 'b', 'b'], session: ['s1', 's1', 's2', 's2'] };
    const lines = (widgetContainer: HTMLElement) => [...widgetContainer.querySelectorAll<SVGPathElement>('[aria-label="line"] path')];

    it('on a line offers its zField, then its strokeField, with the chart’s pills', async () => {
      testbed.serve('/p/shop/api/1/query', rows);
      testbed.serve('/p/shop/api/2/query', rows);
      const strokeField = { kind: 'expr' as const, alias: 'host' };
      const zField = { kind: 'expr' as const, alias: 'session' };
      const bothElement = testbed.render({ type: 'timeLine', props: { x, y, strokeField, zField }, dataUrl: '/p/shop/api/1', filterable }).widgetContainer;
      const strokeOnlyElement = testbed.render({ type: 'timeLine', props: { x, y, strokeField }, dataUrl: '/p/shop/api/2', filterable }).widgetContainer;
      await inView();
      await clickMark(lines(bothElement)[1]);
      await clickMark(lines(strokeOnlyElement)[1]);
      expect(offers.map(({ candidates, source }) => ({ candidates, source }))).toEqual([
        { candidates: [{ fieldId: 'session', value: 's2' }, { fieldId: 'host', value: 'b' }], source: { dataUrl: '/p/shop/api/1', filterable } },
        { candidates: [{ fieldId: 'host', value: 'b' }], source: { dataUrl: '/p/shop/api/2', filterable } },
      ]);
    });

    it('on the drag area offers the line Plot points at below it', async () => {
      testbed.serve('/p/shop/api/1/query', rows);
      const { widgetContainer } = testbed.render({ type: 'timeLine', props: { x, y, strokeField: { kind: 'expr', alias: 'host' } }, dataUrl: '/p/shop/api/1', filterable });
      await inView();
      const overlayContainer = widgetContainer.querySelector('svg .overlay')!;
      await clickMark(lines(widgetContainer)[0], overlayContainer);
      expect(offers.map(({ candidates }) => candidates)).toEqual([[{ fieldId: 'host', value: 'a' }]]);
    });
  });
});
