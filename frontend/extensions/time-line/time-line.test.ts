// @vitest-environment jsdom
// Tests for time-line.ts: a line drawn from the widget’s data, in its stroke color or one per strokeField value; a
// click on a line offering its zField and strokeField, also through the drag area above it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settle, widgetTestbed } from '../../hosts/widgets/widgets-testing';
import { clickMark } from '../chart-library/plot-testing';
import { timeLine } from './time-line';

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
const error = (el: HTMLElement) => el.querySelector('.d-widget-error')?.textContent;

describe('timeLine', () => {
  it('draws the widget’s data once it is in view', async () => {
    testbed.serve('/p/shop/api/1/query', { time: [T0, T0 + QUARTER], cnt: [3, 5] });
    const { el } = testbed.render({ type: 'timeLine', props: { x: { kind: 'autoBucket', alias: 'time', xBucketSizeMs: QUARTER }, y: { kind: 'count', alias: 'cnt' } }, dataUrl: '/p/shop/api/1' });
    await inView();
    expect(error(el)).toBeUndefined();
    expect(el.querySelectorAll('.d-chart-frame__body svg path').length).toBeGreaterThan(0);
  });

  it('draws a line in the color stroke, or one per value of strokeField, which wins', async () => {
    testbed.serve('/p/shop/api/1/query', { time: [T0, T0 + QUARTER], cnt: [3, 5], host: ['a', 'b'] });
    const x = { kind: 'expr' as const, alias: 'time', xBucketSizeMs: QUARTER };
    const y = { kind: 'count' as const, alias: 'cnt' };
    const colored = testbed.render({ type: 'timeLine', props: { x, y, stroke: '#ff0000' }, dataUrl: '/p/shop/api/1' }).el;
    const perHost = testbed.render({ type: 'timeLine', props: { x, y, stroke: '#ff0000', strokeField: { kind: 'expr', alias: 'host' } }, dataUrl: '/p/shop/api/1' }).el;
    await inView();
    expect(colored.querySelector('svg g[stroke="#ff0000"] path')).not.toBeNull();
    expect(perHost.querySelector('svg g[stroke="#ff0000"]')).toBeNull();
    expect(perHost.querySelectorAll('svg [aria-label="line"] path')).toHaveLength(2);
  });

  describe('a click', () => {
    const x = { kind: 'expr' as const, alias: 'time', xBucketSizeMs: QUARTER };
    const y = { kind: 'count' as const, alias: 'cnt' };
    const rows = { time: [T0, T0 + QUARTER, T0, T0 + QUARTER], cnt: [3, 5, 1, 2], host: ['a', 'a', 'b', 'b'], session: ['s1', 's1', 's2', 's2'] };
    const lines = (el: HTMLElement) => [...el.querySelectorAll<SVGPathElement>('[aria-label="line"] path')];

    it('on a line offers its zField, then its strokeField; choosing one filters by it', async () => {
      testbed.serve('/p/shop/api/1/query', rows);
      testbed.serve('/p/shop/api/2/query', rows);
      const strokeField = { kind: 'expr' as const, alias: 'host' };
      const zField = { kind: 'expr' as const, alias: 'session' };
      const both = testbed.render({ type: 'timeLine', props: { x, y, strokeField, zField }, dataUrl: '/p/shop/api/1' }).el;
      const strokeOnly = testbed.render({ type: 'timeLine', props: { x, y, strokeField }, dataUrl: '/p/shop/api/2' }).el;
      await inView();
      await clickMark(lines(both)[1]);
      expect(testbed.candidates()).toEqual(['session = s2', 'host = b']);
      await testbed.choose('Filter session = s2');
      expect(testbed.query.filters.chips).toContainEqual({ kind: 'field', fieldId: 'session', op: 'eq', value: 's2' });
      await clickMark(lines(strokeOnly)[1]);
      expect(testbed.candidates()).toEqual(['host = b']);
      await testbed.choose('Filter host = b');
      expect(testbed.query.filters.chips).toContainEqual({ kind: 'field', fieldId: 'host', op: 'eq', value: 'b' });
    });

    it('on the drag area offers the line Plot points at below it', async () => {
      testbed.serve('/p/shop/api/1/query', rows);
      const { el } = testbed.render({ type: 'timeLine', props: { x, y, strokeField: { kind: 'expr', alias: 'host' } }, dataUrl: '/p/shop/api/1' });
      await inView();
      const overlay = el.querySelector('svg .overlay')!;
      await clickMark(lines(el)[0], overlay);
      expect(testbed.candidates()).toEqual(['host = a']);
      await testbed.choose('Filter host = a');
      expect(testbed.query.filters.chips).toContainEqual({ kind: 'field', fieldId: 'host', op: 'eq', value: 'a' });
    });
  });
});
