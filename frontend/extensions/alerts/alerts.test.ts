// @vitest-environment jsdom
// Tests for alerts.ts: an alert group’s statuses and one alert’s history drawn from the widget’s data.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settle, widgetTestbed } from '../../hosts/widgets/widgets-testing';
import { alerts } from './alerts';

let testbed: ReturnType<typeof widgetTestbed>;

beforeEach(() => {
  testbed = widgetTestbed();
  testbed.activate(alerts);
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

describe('alerts', () => {
  it('draws the statuses of the group’s alerts once it is in view', async () => {
    testbed.serve('/p/shop/api/1/query', { alert_id_key: ['login_events'], start: [T0], end: [T0 + QUARTER], status: ['error'] });
    const { el } = testbed.render({ type: 'alertOverview', props: { alertGroupPattern: 'shop%' }, dataUrl: '/p/shop/api/1' });
    await inView();
    expect(error(el)).toBeUndefined();
    expect(el.querySelector('.dashica-chart__body svg')).not.toBeNull();
  });

  it('draws an alert’s history with its threshold', async () => {
    testbed.serve('/p/shop/api/2/query', { time: [T0, T0 + QUARTER], value: [3, 0] }, { 'X-Dashica-Alert-If': '{"value_lt":1}' });
    const { el } = testbed.render({ type: 'alertDetail', props: { alertGroup: 'shop', alertKey: 'login_events', title: 'shop#login_events' }, dataUrl: '/p/shop/api/2' });
    await inView();
    expect(error(el)).toBeUndefined();
    expect(el.querySelectorAll('.dashica-chart__body svg rect').length).toBeGreaterThan(0);
  });
});
