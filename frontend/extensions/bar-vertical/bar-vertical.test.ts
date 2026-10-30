// @vitest-environment jsdom
// Tests for bar-vertical.ts: bars drawn from the widget’s data, sorted by their measure when asked.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settle, widgetTestbed } from '../../hosts/widgets/widgets-testing';
import { barVertical } from './bar-vertical';

let testbed: ReturnType<typeof widgetTestbed>;

beforeEach(() => {
  testbed = widgetTestbed();
  testbed.activate(barVertical);
});

afterEach(() => testbed.dispose());

const T0 = Date.UTC(2026, 9, 29, 10);
const QUARTER = 15 * 60 * 1000;
const inView = async () => {
  testbed.resize(640);
  testbed.scrollIntoView();
  await settle();
};
const error = (el: HTMLElement) => el.querySelector('.d-widget-error')?.textContent;

describe('barVertical', () => {
  it('draws the widget’s data once it is in view', async () => {
    testbed.serve('/p/shop/api/1/query', { status: ['200', '500'], cnt: [30, 2] });
    const { el } = testbed.render({ type: 'barVertical', props: { x: { kind: 'expr', alias: 'status' }, y: { kind: 'count', alias: 'cnt' } }, dataUrl: '/p/shop/api/1' });
    await inView();
    expect(error(el)).toBeUndefined();
    expect(el.querySelectorAll('.d-chart-frame__body svg rect').length).toBeGreaterThan(0);
  });

  it('sorts the categories by their measure when asked, descending for sortReverse', async () => {
    testbed.serve('/p/shop/api/1/query', { status: ['200', '500'], cnt: [2, 30] });
    const { el } = testbed.render({ type: 'barVertical', props: { x: { kind: 'expr', alias: 'status' }, y: { kind: 'count', alias: 'cnt' }, sortReverse: true }, dataUrl: '/p/shop/api/1' });
    await inView();
    const ticks = [...el.querySelectorAll('[aria-label="x-axis tick label"] text')].map((tick) => tick.textContent);
    expect(ticks).toEqual(['500', '200']);
  });
});
