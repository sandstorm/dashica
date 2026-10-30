// @vitest-environment jsdom
// Tests for time-bar.ts: a time bar drawn from the widget's data; a click on a bar (also through the drag area above
// it) offering its fill and facets, never its time bucket or measure.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settle, widgetTestbed } from '../../hosts/widgets/widgets-testing';
import { clickMark } from '../chart-library/plot-testing';
import { timeBar } from './time-bar';

let testbed: ReturnType<typeof widgetTestbed>;

beforeEach(() => {
  testbed = widgetTestbed();
  testbed.activate(timeBar);
});

afterEach(() => {
  testbed.dispose();
  vi.restoreAllMocks();
});

describe('timeBar', () => {
  it('draws the widget’s data once it is in view', async () => {
    testbed.serve('/p/shop/api/1/query', { time: [Date.UTC(2026, 9, 29, 10), Date.UTC(2026, 9, 29, 10, 15)], cnt: [3, 5] }, { 'X-Dashica-Resolved-Time-Range': JSON.stringify({ from: Date.UTC(2026, 9, 29, 10), to: Date.UTC(2026, 9, 29, 11) }) });
    const { el } = testbed.render({ type: 'timeBar', props: { title: 'Requests', x: { kind: 'expr', alias: 'time', xBucketSizeMs: 900000 }, y: { kind: 'count', alias: 'cnt' } }, dataUrl: '/p/shop/api/1' });
    testbed.resize(640);
    testbed.scrollIntoView();
    await settle();
    expect(el.querySelector('.d-widget-error')?.textContent).toBeUndefined();
    expect(el.querySelectorAll('.d-chart-frame__body svg rect').length).toBeGreaterThan(0);
    // the time selection: an area to drag across
    expect(el.querySelector('.d-chart-frame__body svg .overlay')).not.toBeNull();
  });

  describe('a click', () => {
    const T0 = Date.UTC(2026, 9, 29, 10);
    const QUARTER = 15 * 60 * 1000;
    const range = { 'X-Dashica-Resolved-Time-Range': JSON.stringify({ from: T0, to: T0 + 4 * QUARTER }) };
    const rows = { time: [T0, T0, T0 + QUARTER], level: ['info', 'error', 'info'], region: ['eu', 'eu', 'us'], cnt: [3, 1, 5] };
    const props = { x: { kind: 'expr', alias: 'time', xBucketSizeMs: QUARTER }, y: { kind: 'count', alias: 'cnt' }, fill: { kind: 'enum', alias: 'level' } } as const;
    const render = (more: object = {}) => {
      testbed.serve('/p/shop/api/1/query', rows, range);
      return testbed.render({ type: 'timeBar', props, dataUrl: '/p/shop/api/1', ...more }).el;
    };
    const inView = async () => {
      testbed.resize(640);
      testbed.scrollIntoView();
      await settle();
    };
    const bars = (el: HTMLElement) => [...el.querySelectorAll<SVGRectElement>('g[aria-label="rect"] rect')];

    it('on a bar offers its fill, never its time bucket or measure; choosing it selects', async () => {
      const el = render();
      await inView();
      await clickMark(bars(el)[1]);
      expect(testbed.choices()).toEqual(['level = error']);
      testbed.choose('level = error');
      expect(testbed.widgets.selection).toMatchObject({ kind: 'category', widgetId: '1', fieldId: 'level', value: 'error', anchor: bars(el)[1] });
    });

    it('on the drag area offers the bar Plot points at below it, again on the next click', async () => {
      const el = render();
      await inView();
      const overlay = el.querySelector('svg .overlay')!;
      await clickMark(bars(el)[2], overlay);
      expect(testbed.choices()).toEqual(['level = info']);
      testbed.choose('level = info');
      expect(testbed.widgets.selection).toMatchObject({ fieldId: 'level', value: 'info', anchor: overlay });
      await clickMark(bars(el)[1], overlay);
      expect(testbed.choices()).toEqual(['level = error']);
    });

    it('on a bar offers its fill and its facet', async () => {
      const el = render({ props: { ...props, fy: { kind: 'expr', alias: 'region' } } });
      await inView();
      await clickMark(bars(el).at(-1)!);
      expect(testbed.choices()).toEqual(['level = info', 'region = us']);
    });

    it('on a bar without a fill offers its facet', async () => {
      const { fill: _, ...unfilled } = props;
      const el = render({ props: { ...unfilled, fy: { kind: 'expr', alias: 'region' } } });
      await inView();
      await clickMark(bars(el).at(-1)!);
      expect(testbed.choices()).toEqual(['region = us']);
    });
  });
});
