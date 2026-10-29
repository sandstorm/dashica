// @vitest-environment jsdom
// Tests for bar-horizontal.ts: the props as the chart takes them, bars drawn from the widget’s data.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settle, widgetTestbed } from '../../hosts/widgets/widgets-testing';
import { barHorizontal, barHorizontalChartProps } from './bar-horizontal';

let testbed: ReturnType<typeof widgetTestbed>;

beforeEach(() => {
  testbed = widgetTestbed();
  testbed.activate(barHorizontal);
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

describe('barHorizontal', () => {
  it('gives the chart the fields as their aliases', () => {
    expect(barHorizontalChartProps({ x: { kind: 'count', alias: 'cnt' }, y: { kind: 'expr', alias: 'path' }, fill: { kind: 'expr', alias: 'host' } })).toMatchObject({ x: 'cnt', y: 'path', fill: 'host' });
  });

  it('draws the widget’s data once it is in view', async () => {
    testbed.serve('/p/wetell/api/1/query', { path: ['/api', '/login'], cnt: [30, 2] });
    const { el } = testbed.render({ type: 'barHorizontal', props: { x: { kind: 'count', alias: 'cnt' }, y: { kind: 'expr', alias: 'path' } }, dataUrl: '/p/wetell/api/1' });
    await inView();
    expect(error(el)).toBeUndefined();
    expect(el.querySelectorAll('.dashica-chart__body svg rect').length).toBeGreaterThan(0);
  });
});
