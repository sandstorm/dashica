// @vitest-environment jsdom
// Tests for bar-horizontal.ts: bars drawn from the widget’s data, a click on a bar running filters.offer with its category
// and fill.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settle, widgetTestbed } from '../../hosts/widgets/widgets-testing';
import { recordOffers, type RecordedOffer } from '../chart-library/offer-testing';
import { anchor, clickAtPoint, clickMark } from '../chart-library/plot-testing';
import { barHorizontal } from './bar-horizontal';

let testbed: ReturnType<typeof widgetTestbed>;
/** The runs of `filters.offer`, in order: what each click offered. */
let offers: RecordedOffer[];
/** The fields the server lets each chart here filter by (page.json's `filterable`). */
const filterable = ['path', 'host'];

beforeEach(() => {
  testbed = widgetTestbed();
  offers = recordOffers(testbed.commands);
  testbed.activate(barHorizontal);
});

afterEach(() => testbed.dispose());

const inView = async () => {
  testbed.resize(640);
  testbed.scrollIntoView();
  await settle();
};
const error = (widgetContainer: HTMLElement) => widgetContainer.querySelector('.d-widget-error')?.textContent;

describe('barHorizontal', () => {
  it('draws the widget’s data once it is in view', async () => {
    testbed.serve('/p/shop/api/1/query', { path: ['/api', '/login'], cnt: [30, 2] });
    const { widgetContainer } = testbed.render({ type: 'barHorizontal', props: { x: { kind: 'count', alias: 'cnt' }, y: { kind: 'expr', alias: 'path' } }, dataUrl: '/p/shop/api/1', filterable });
    await inView();
    expect(error(widgetContainer)).toBeUndefined();
    expect(widgetContainer.querySelectorAll('.d-chart-frame__body svg rect').length).toBeGreaterThan(0);
  });

  it('runs filters.offer with the category and the fill of a clicked bar and the chart’s pills', async () => {
    testbed.serve('/p/shop/api/1/query', { path: ['/api', '/login'], host: ['a', 'b'], cnt: [30, 2] });
    const props = { x: { kind: 'count', alias: 'cnt' }, y: { kind: 'expr', alias: 'path' }, fill: { kind: 'expr', alias: 'host' } } as const;
    const { widgetContainer } = testbed.render({ type: 'barHorizontal', props, dataUrl: '/p/shop/api/1', filterable });
    await inView();
    await clickMark(widgetContainer.querySelectorAll('g[aria-label="bar"] rect')[1]);
    expect(offers.map(({ candidates, source }) => ({ candidates, source }))).toEqual([
      {
        candidates: [{ fieldId: 'path', value: '/login' }, { fieldId: 'host', value: 'b' }],
        source: { dataUrl: '/p/shop/api/1', filterable },
      },
    ]);
  });

  it('offers the row the tip shows, the bar under the mouse, though another one’s middle is closer', async () => {
    // many categories, so a bar of the next one lies within Plot's pointer radius: /0 a short "a", /1 a short "a" and a
    // long "b" right of it
    const paths = Array.from({ length: 16 }, (_, at) => `/${at}`);
    testbed.serve('/p/shop/api/1/query', { path: ['/0', '/1', '/1', ...paths.slice(2)], host: ['a', 'a', 'b', ...paths.slice(2).map(() => 'a')], cnt: [1, 1, 10, ...paths.slice(2).map(() => 1)] });
    const props = { x: { kind: 'count', alias: 'cnt' }, y: { kind: 'expr', alias: 'path' }, fill: { kind: 'expr', alias: 'host' } } as const;
    const { widgetContainer } = testbed.render({ type: 'barHorizontal', props, dataUrl: '/p/shop/api/1', filterable });
    await inView();
    const [shortElement, , longElement] = widgetContainer.querySelectorAll('g[aria-label="bar"] rect');
    const [, y] = anchor(shortElement!);
    // below /0's middle, still on its band, as far right as /1's "b" is in its middle
    await clickAtPoint((shortElement as SVGElement).ownerSVGElement!, [anchor(longElement!)[0], y + 0.4 * Number(shortElement!.getAttribute('height'))]);
    const shown = /path (\S+)/.exec(widgetContainer.querySelector('g[aria-label="tip"]')?.textContent ?? '')?.[1];
    expect([shown, offers.at(-1)?.candidates.map(({ value }) => value)]).toEqual(['/0', ['/0', 'a']]);
  });
});
