// @vitest-environment jsdom
// Tests for stats.ts: a number per row under its label.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settle, widgetTestbed } from '../../hosts/widgets/widgets-testing';
import { stats } from './stats';

let testbed: ReturnType<typeof widgetTestbed>;

beforeEach(() => {
  testbed = widgetTestbed();
  testbed.activate(stats);
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

describe('stats', () => {
  it('shows a number per row under its label', async () => {
    testbed.serve('/p/shop/api/shop_stats/query', { label: ['Requests', 'Errors'], value: [1234, 5.678] });
    const { el } = testbed.render({ type: 'stats', props: {}, dataUrl: '/p/shop/api/shop_stats' });
    await inView();
    const shown = [...el.querySelectorAll('.d-stats__stat')].map((stat) => [stat.querySelector('dt')!.textContent, stat.querySelector('dd')!.textContent]);
    expect(shown).toEqual([
      ['Requests', '1234'],
      ['Errors', '5.68'],
    ]);
  });
});
