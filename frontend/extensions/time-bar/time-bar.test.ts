// @vitest-environment jsdom
// Tests for time-bar.ts: a time bar drawn from the widget's data.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settle, widgetTestbed } from '../../hosts/widgets/widgets-testing';
import { timeBar } from './time-bar';

let testbed: ReturnType<typeof widgetTestbed>;

beforeEach(() => {
  testbed = widgetTestbed();
  testbed.activate(timeBar);
});

afterEach(() => testbed.dispose());

describe('timeBar', () => {
  it('draws the widget’s data once it is in view', async () => {
    testbed.serve('/p/shop/api/1/query', { time: [Date.UTC(2026, 9, 29, 10), Date.UTC(2026, 9, 29, 10, 15)], cnt: [3, 5] }, { 'X-Dashica-Resolved-Time-Range': JSON.stringify({ from: Date.UTC(2026, 9, 29, 10), to: Date.UTC(2026, 9, 29, 11) }) });
    const { el } = testbed.render({ type: 'timeBar', props: { title: 'Requests', x: { kind: 'expr', alias: 'time', xBucketSizeMs: 900000 }, y: { kind: 'count', alias: 'cnt' } }, dataUrl: '/p/shop/api/1' });
    testbed.resize(640);
    testbed.scrollIntoView();
    await settle();
    expect(el.querySelector('.dashica-widget-error')?.textContent).toBeUndefined();
    expect(el.querySelectorAll('.dashica-chart__body svg rect').length).toBeGreaterThan(0);
    // the time selection: an area to drag across
    expect(el.querySelector('.dashica-chart__body svg .overlay')).not.toBeNull();
  });
});
