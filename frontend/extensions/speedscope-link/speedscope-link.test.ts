// @vitest-environment jsdom
// Tests for speedscope-link.ts: the viewer's link on the profile with the page's state; a click opens it in a tab.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { widgetTestbed } from '../../hosts/widgets/widgets-testing';
import { TIME, presetRange, type TimeRange } from '../time-library/time-state';
import { PARAMS, withParam } from '../widget-library/params-state';
import { speedscopeLink } from './speedscope-link';

let testbed: ReturnType<typeof widgetTestbed>;

beforeEach(() => {
  // sent along, declared as by the time-range extension and the dashboard page
  testbed = widgetTestbed({ keys: [TIME, PARAMS] });
  testbed.activate(speedscopeLink);
});

afterEach(() => testbed.dispose());

/** The page params, as the dashboardPage extension keeps them. */
const param = (name: string) => testbed.query.get(PARAMS)[name];
const setParam = (name: string, value: string) => testbed.query.set(PARAMS, withParam(testbed.query.get(PARAMS), name, value));

/** The profile URL the link hands to the viewer. */
function profileUrl(link: HTMLAnchorElement): URL {
  const href = new URL(link.href);
  expect(href.pathname).toBe('/p/shop/api/4/viewer/');
  return new URL(decodeURIComponent(href.hash.replace('#profileURL=', '')));
}

describe('speedscopeLink', () => {
  it('links the viewer to its query with the page’s time range and params', () => {
    testbed.query.set(TIME, presetRange('1h'));
    setParam('path', '^/api/');
    const { el } = testbed.render({ type: 'speedscopeLink', props: {}, dataUrl: '/p/shop/api/4' });
    const link = el.querySelector('a')!;
    expect(link.textContent).toBe('Open Speedscope');
    const profile = profileUrl(link);
    expect(profile.pathname).toBe('/p/shop/api/4/speedscope-query');
    expect(profile.searchParams.get('time')).toBe('1h');
    expect(JSON.parse(profile.searchParams.get('wp')!)).toEqual({ path: '^/api/' });
  });

  it('opens the viewer in a tab of the workbench on a click, in an iframe; a click with a modifier key stays the browser’s', () => {
    const { el } = testbed.render({ type: 'speedscopeLink', props: {}, dataUrl: '/p/shop/api/4' });
    const link = el.querySelector('a')!;
    const withCtrl = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    link.dispatchEvent(withCtrl);
    expect(testbed.popped).toEqual([]);
    expect(withCtrl.defaultPrevented).toBe(false);

    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(testbed.popped.map((view) => view.title)).toEqual(['Speedscope']);
    const tab = document.createElement('div');
    testbed.popped[0].render(tab);
    expect(tab.querySelector('iframe')!.src).toBe(link.href);
  });

  it('follows a change of the time range', () => {
    const { el } = testbed.render({ type: 'speedscopeLink', props: { title: 'Flame graph' }, dataUrl: '/p/shop/api/4' });
    testbed.query.set(TIME, presetRange('1h'));
    const link = el.querySelector('a')!;
    expect(link.textContent).toBe('Flame graph');
    expect(profileUrl(link).searchParams.get('time')).toBe('1h');
  });
});
