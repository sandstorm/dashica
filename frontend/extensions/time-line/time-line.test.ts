// @vitest-environment jsdom
// Tests for time-line.ts: the props as the chart takes them, a line drawn from the widget’s data.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settle, widgetTestbed } from '../../hosts/widgets/widgets-testing';
import { timeLine, timeLineChartProps } from './time-line';

let testbed: ReturnType<typeof widgetTestbed>;

beforeEach(() => {
  testbed = widgetTestbed();
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
const error = (el: HTMLElement) => el.querySelector('.dashica-widget-error')?.textContent;

describe('timeLine', () => {
  it('gives the chart the stroke field’s alias, else the stroke color', () => {
    const x = { kind: 'expr' as const, alias: 'time', xBucketSizeMs: QUARTER };
    const y = { kind: 'count' as const, alias: 'cnt' };
    expect(timeLineChartProps({ x, y, stroke: '#4682B4', strokeField: { kind: 'expr', alias: 'host' }, zField: { kind: 'expr', alias: 'session' } })).toMatchObject({ x: 'time', xBucketSize: QUARTER, y: 'cnt', stroke: 'host', z: 'session' });
    expect(timeLineChartProps({ x, y, stroke: '#4682B4' }).stroke).toBe('#4682B4');
  });

  it('draws the widget’s data once it is in view', async () => {
    testbed.serve('/p/wetell/api/1/query', { time: [T0, T0 + QUARTER], cnt: [3, 5] });
    const { el } = testbed.render({ type: 'timeLine', props: { x: { kind: 'autoBucket', alias: 'time', xBucketSizeMs: QUARTER }, y: { kind: 'count', alias: 'cnt' } }, dataUrl: '/p/wetell/api/1' });
    await inView();
    expect(error(el)).toBeUndefined();
    expect(el.querySelectorAll('.dashica-chart__body svg path').length).toBeGreaterThan(0);
  });
});
