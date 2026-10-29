// @vitest-environment jsdom
// Tests for table.ts: the rows drawn into a table, a cell’s filter added to the page’s SQL filter.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settle, widgetTestbed } from '../../hosts/widgets/widgets-testing';
import { table } from './table';

let testbed: ReturnType<typeof widgetTestbed>;

beforeEach(() => {
  testbed = widgetTestbed();
  testbed.activate(table);
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

describe('table', () => {
  it('draws the rows below its title', async () => {
    testbed.serve('/p/shop/api/1/query', { path: ['/api', '/login'], status: [200, 500] });
    const { el } = testbed.render({ type: 'table', props: { title: 'Latest', height: 500 }, dataUrl: '/p/shop/api/1' });
    await inView();
    expect(error(el)).toBeUndefined();
    expect(el.querySelector('.table-with-details h2')!.textContent).toBe('Latest');
  });

  it('adds a cell’s filter to the page’s SQL filter', () => {
    const { el } = testbed.render({ type: 'table', props: {}, dataUrl: '/p/shop/api/1' });
    el.querySelector('.dashica-chart__body')!.dispatchEvent(new CustomEvent('dashica-add-filter', { bubbles: true, detail: "path = '/api'" }));
    expect(testbed.query.filters.sql).toBe("path = '/api'");
  });
});
