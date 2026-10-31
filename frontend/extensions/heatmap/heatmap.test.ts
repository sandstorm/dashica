// @vitest-environment jsdom
// Tests for heatmap.ts: both heatmaps’ cells drawn from the widget’s data; a time heatmap needs its y bucket size; a
// click on an ordinal heatmap's cell offering its row.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settle, widgetTestbed } from '../../hosts/widgets/widgets-testing';
import { clickMark } from '../chart-library/plot-testing';
import { heatmap } from './heatmap';

let testbed: ReturnType<typeof widgetTestbed>;

beforeEach(() => {
  testbed = widgetTestbed();
  testbed.activate(heatmap);
  // Plot paints a color legend's ramp on a canvas, which jsdom cannot draw on
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect() {} } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:,');
});

afterEach(() => {
  testbed.dispose();
  vi.restoreAllMocks();
});

const T0 = Date.UTC(2026, 9, 29, 10);
const QUARTER = 15 * 60 * 1000;
const inView = async () => {
  testbed.resize(640);
  testbed.scrollIntoView();
  await settle();
};
const error = (el: HTMLElement) => el.querySelector('.d-widget-error')?.textContent;

const x = { kind: 'expr' as const, alias: 'time', xBucketSizeMs: QUARTER };

describe('heatmap', () => {
  it('draws a time heatmap’s cells once it is in view', async () => {
    testbed.serve('/p/shop/api/1/query', { time: [T0, T0 + QUARTER], duration_ms: [100, 200], cnt: [3, 5] });
    const { el } = testbed.render({ type: 'timeHeatmap', props: { x, y: { kind: 'expr', alias: 'duration_ms' }, fill: { kind: 'count', alias: 'cnt' }, yBucketSize: 100 }, dataUrl: '/p/shop/api/1' });
    await inView();
    expect(error(el)).toBeUndefined();
    expect(el.querySelectorAll('.d-chart-frame__body svg rect').length).toBeGreaterThan(0);
  });

  it('refuses a time heatmap without a positive y bucket size', () => {
    const { el } = testbed.render({ type: 'timeHeatmap', props: { x, y: { kind: 'expr', alias: 'duration_ms' } }, dataUrl: '/p/shop/api/1' });
    expect(error(el)).toBe('YBucketSize must be set to a positive value (was 0) (timeHeatmap)');
  });

  it('draws an ordinal heatmap’s cells once it is in view', async () => {
    testbed.serve('/p/shop/api/1/query', { time: [T0, T0 + QUARTER], status: ['200', '500'], cnt: [3, 5] });
    const { el } = testbed.render({ type: 'timeHeatmapOrdinal', props: { x, y: { kind: 'enum', alias: 'status' }, fill: { kind: 'count', alias: 'cnt' } }, dataUrl: '/p/shop/api/1' });
    await inView();
    expect(error(el)).toBeUndefined();
    expect(el.querySelectorAll('.d-chart-frame__body svg rect').length).toBeGreaterThan(0);
  });

  it('offers the row of a clicked cell of an ordinal heatmap, never its measure; choosing it filters by it', async () => {
    testbed.serve('/p/shop/api/1/query', { time: [T0, T0 + QUARTER], status: ['200', '500'], cnt: [3, 5] });
    const props = { x, y: { kind: 'enum', alias: 'status' }, fill: { kind: 'count', alias: 'cnt' } } as const;
    const { el } = testbed.render({ type: 'timeHeatmapOrdinal', props, dataUrl: '/p/shop/api/1' });
    await inView();
    await clickMark(el.querySelectorAll('g[aria-label="bar"] rect')[1]);
    expect(testbed.candidates()).toEqual(['status = 500']);
    await testbed.choose('Filter status = 500');
    expect(testbed.query.filters.chips).toContainEqual({ kind: 'field', fieldId: 'status', op: 'eq', value: '500' });
  });

  it('has no filter mark on a time heatmap, and a click offers nothing', async () => {
    testbed.serve('/p/shop/api/1/query', { time: [T0, T0 + QUARTER], duration_ms: [100, 200], cnt: [3, 5] });
    const { el } = testbed.render({ type: 'timeHeatmap', props: { x, y: { kind: 'expr', alias: 'duration_ms' }, fill: { kind: 'count', alias: 'cnt' }, yBucketSize: 100 }, dataUrl: '/p/shop/api/1' });
    await inView();
    expect(el.querySelector('.d-filter-on-click')).toBeNull();
    await clickMark(el.querySelectorAll('g[aria-label="rect"] rect')[1]);
    expect(testbed.choices()).toEqual([]);
  });
});
