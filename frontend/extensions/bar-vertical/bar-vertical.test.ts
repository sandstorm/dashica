// @vitest-environment jsdom
// Tests for bar-vertical.ts: bars drawn from the widget’s data, sorted by their measure when asked, a click on a bar
// offering its categories, choosing one selecting it for the floating bar's filters.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settle, widgetTestbed } from '../../hosts/widgets/widgets-testing';
import { clickMark, pointAt } from '../chart-library/plot-testing';
import { filters } from '../filters/filters';
import { barVertical } from './bar-vertical';

let testbed: ReturnType<typeof widgetTestbed>;

beforeEach(() => {
  testbed = widgetTestbed();
  testbed.activate(barVertical, filters);
});

afterEach(() => testbed.dispose());

const inView = async () => {
  testbed.resize(640);
  testbed.scrollIntoView();
  await settle();
};
const error = (el: HTMLElement) => el.querySelector('.d-widget-error')?.textContent;
// closes the menu shown, as a user does
const escape = () => (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

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

  describe('a click on a bar', () => {
    const bars = (el: HTMLElement) => [...el.querySelectorAll<SVGRectElement>('g[aria-label="bar"] rect')];
    const entry = (title: string) => [...(testbed.floatingBar()?.querySelectorAll('button') ?? [])].find((button) => button.textContent === title);
    const byStatus = (more: object = {}) =>
      ({ type: 'barVertical', props: { x: { kind: 'expr', alias: 'status' }, y: { kind: 'count', alias: 'cnt' } }, dataUrl: '/p/shop/api/1', ...more }) as const;

    it('offers its category, also as the only candidate; choosing it selects, and "Filter by" in the floating bar filters by it', async () => {
      testbed.serve('/p/shop/api/1/query', { status: ['200', '500'], cnt: [30, 2] });
      const { el } = testbed.render(byStatus());
      await inView();
      await clickMark(bars(el)[1]);
      expect(testbed.choices()).toEqual(['status = 500']);
      expect(testbed.widgets.selection).toBeUndefined();
      testbed.choose('status = 500');
      expect(testbed.choices()).toEqual([]);
      expect(testbed.widgets.selection).toMatchObject({ kind: 'category', widgetId: '1', fieldId: 'status', value: '500', anchor: bars(el)[1] });
      entry('Filter by')!.click();
      await settle();
      expect(testbed.query.filters.chips).toEqual([{ kind: 'field', fieldId: 'status', op: 'eq', value: '500' }]);
      expect(testbed.widgets.selection).toBeUndefined();
      expect(testbed.floatingBar()).toBeNull();
      expect(testbed.requests.at(-1)!.searchParams.getAll('f')).toEqual(['status:eq:500']);
    });

    it('offers each category of its row in the order of x, fill, fx, fy', async () => {
      testbed.serve('/p/shop/api/1/query', { status: ['200', '500'], host: ['a', 'b'], region: ['eu', 'us'], cnt: [30, 2] });
      const props = { ...byStatus().props, fill: { kind: 'expr', alias: 'host' }, fx: { kind: 'expr', alias: 'region' } } as const;
      const { el } = testbed.render(byStatus({ props }));
      await inView();
      await clickMark(bars(el).at(-1)!);
      expect(testbed.choices()).toEqual(['status = 500', 'host = b', 'region = us']);
      testbed.choose('host = b');
      expect(testbed.widgets.selection).toMatchObject({ fieldId: 'host', value: 'b' });
      expect(entry('Filter by')).toBeDefined();
    });

    it('offers again on the next click, on the same bar and on another: Plot does not pin its tip', async () => {
      testbed.serve('/p/shop/api/1/query', { status: ['200', '500'], cnt: [30, 2] });
      const { el } = testbed.render(byStatus());
      await inView();
      await clickMark(bars(el)[1]);
      testbed.choose('status = 500');
      await clickMark(bars(el)[1]);
      expect(testbed.choices()).toEqual(['status = 500']);
      await clickMark(bars(el)[0]);
      expect(testbed.choices()).toEqual(['status = 200']);
      testbed.choose('status = 200');
      expect(testbed.widgets.selection).toMatchObject({ fieldId: 'status', value: '200' });
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

    it('"Exclude" adds the category as ≠', async () => {
      testbed.serve('/p/shop/api/1/query', { status: ['200', '500'], cnt: [30, 2] });
      const { el } = testbed.render(byStatus());
      await inView();
      await clickMark(bars(el)[0]);
      testbed.choose('status = 200');
      entry('Exclude')!.click();
      expect(testbed.query.filters.chips).toEqual([{ kind: 'field', fieldId: 'status', op: 'ne', value: '200' }]);
    });

    // a time bucket as x, which is never a candidate
    const byBucket = (more: object = {}) => byStatus({ props: { ...byStatus().props, x: { kind: 'autoBucket', alias: 'status', xBucketSizeMs: 900000 } }, ...more });

    it('offers the fill when the category is a time bucket, and nothing without a fill', async () => {
      testbed.serve('/p/shop/api/1/query', { status: ['200', '500'], host: ['a', 'b'], cnt: [30, 2] });
      const fill = { kind: 'expr', alias: 'host' } as const;
      const { el } = testbed.render(byBucket({ props: { ...byBucket().props, fill } }));
      await inView();
      await clickMark(bars(el)[1]);
      expect(testbed.choices()).toEqual(['host = b']);
      escape();
      const { el: without } = testbed.render(byBucket());
      await inView();
      await clickMark(bars(without)[1]);
      expect(testbed.choices()).toEqual([]);
    });

    it('looks clickable while Plot points at a bar, and never without a category', async () => {
      testbed.serve('/p/shop/api/1/query', { status: ['200', '500'], cnt: [30, 2] });
      const { el } = testbed.render(byStatus());
      const { el: without } = testbed.render(byBucket());
      await inView();
      const pointing = () => el.querySelector('.d-select-on-click--pointing') !== null;
      expect(el.querySelector('.d-select-on-click')).not.toBeNull();
      expect(pointing()).toBe(false);
      await pointAt(bars(el)[1]);
      expect(pointing()).toBe(true);
      expect(without.querySelector('.d-select-on-click')).toBeNull();
    });

    it('never offers a measure, nor a NULL', async () => {
      testbed.serve('/p/shop/api/1/query', { status: ['200', null], host: ['a', 'b'], cnt: [30, 2] });
      const { el } = testbed.render(byStatus({ props: { ...byStatus().props, fill: { kind: 'expr', alias: 'host' } } }));
      await inView();
      await clickMark(bars(el)[1]);
      expect(testbed.choices()).toEqual(['host = b']);
      escape();
      const { el: measured } = testbed.render({ ...byStatus(), props: { x: { kind: 'count', alias: 'cnt' }, y: { kind: 'count', alias: 'cnt' } } });
      await inView();
      if (bars(measured)[0]) await clickMark(bars(measured)[0]);
      expect(testbed.choices()).toEqual([]);
    });

    it('offers the facet of a bar whose x is a time bucket', async () => {
      testbed.serve('/p/shop/api/1/query', { status: ['200', '500', '200'], region: ['eu', 'eu', 'us'], cnt: [30, 2, 4] });
      const { el } = testbed.render(byBucket({ props: { ...byBucket().props, fx: { kind: 'expr', alias: 'region' } } }));
      await inView();
      await clickMark(bars(el).at(-1)!);
      expect(testbed.choices()).toEqual(['region = us']);
    });
  });
});
