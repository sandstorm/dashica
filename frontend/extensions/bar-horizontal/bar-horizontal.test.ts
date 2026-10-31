// @vitest-environment jsdom
// Tests for bar-horizontal.ts: bars drawn from the widget’s data, a click on a bar offering its category and fill.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settle, widgetTestbed } from '../../hosts/widgets/widgets-testing';
import { clickMark } from '../chart-library/plot-testing';
import { barHorizontal } from './bar-horizontal';

let testbed: ReturnType<typeof widgetTestbed>;
/** The fields the server lets each chart here filter by (page.json's `filterable`). */
const filterable = ['path', 'host'];

beforeEach(() => {
  testbed = widgetTestbed();
  testbed.activate(barHorizontal);
});

afterEach(() => testbed.dispose());

const inView = async () => {
  testbed.resize(640);
  testbed.scrollIntoView();
  await settle();
};
const error = (el: HTMLElement) => el.querySelector('.d-widget-error')?.textContent;

describe('barHorizontal', () => {
  it('draws the widget’s data once it is in view', async () => {
    testbed.serve('/p/shop/api/1/query', { path: ['/api', '/login'], cnt: [30, 2] });
    const { el } = testbed.render({ type: 'barHorizontal', props: { x: { kind: 'count', alias: 'cnt' }, y: { kind: 'expr', alias: 'path' } }, dataUrl: '/p/shop/api/1', filterable });
    await inView();
    expect(error(el)).toBeUndefined();
    expect(el.querySelectorAll('.d-chart-frame__body svg rect').length).toBeGreaterThan(0);
  });

  it('offers the category and the fill of a clicked bar; choosing one filters by it', async () => {
    testbed.serve('/p/shop/api/1/query', { path: ['/api', '/login'], host: ['a', 'b'], cnt: [30, 2] });
    const props = { x: { kind: 'count', alias: 'cnt' }, y: { kind: 'expr', alias: 'path' }, fill: { kind: 'expr', alias: 'host' } } as const;
    const { el } = testbed.render({ type: 'barHorizontal', props, dataUrl: '/p/shop/api/1', filterable });
    await inView();
    await clickMark(el.querySelectorAll('g[aria-label="bar"] rect')[1]);
    expect(testbed.candidates()).toEqual(['path = /login', 'host = b']);
    await testbed.choose('Filter path = /login');
    expect(testbed.query.filters.chips).toContainEqual(testbed.pill('path', 'eq', '/login'));
  });
});
