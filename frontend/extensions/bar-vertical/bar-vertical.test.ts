// @vitest-environment jsdom
// Tests for bar-vertical.ts: the props as the chart takes them, bars drawn from the widget’s data.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settle, widgetTestbed } from '../../hosts/widgets/widgets-testing';
import { barVertical, barVerticalChartProps } from './bar-vertical';

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
const error = (el: HTMLElement) => el.querySelector('.dashica-widget-error')?.textContent;

describe('barVertical', () => {
  it('gives the chart the fields as their aliases, and sorts by y when asked', () => {
    const props = barVerticalChartProps({ x: { kind: 'expr', alias: 'status' }, y: { kind: 'count', alias: 'cnt' }, sortReverse: true });
    expect(props).toMatchObject({ x: 'status', y: 'cnt', sort: { x: 'y', reverse: true } });
    expect(barVerticalChartProps({ x: { kind: 'expr', alias: 'status' }, y: { kind: 'count', alias: 'cnt' } }).sort).toBeUndefined();
  });

  it('draws the widget’s data once it is in view', async () => {
    testbed.serve('/p/shop/api/1/query', { status: ['200', '500'], cnt: [30, 2] });
    const { el } = testbed.render({ type: 'barVertical', props: { x: { kind: 'expr', alias: 'status' }, y: { kind: 'count', alias: 'cnt' } }, dataUrl: '/p/shop/api/1' });
    await inView();
    expect(error(el)).toBeUndefined();
    expect(el.querySelectorAll('.dashica-chart__body svg rect').length).toBeGreaterThan(0);
  });
});
