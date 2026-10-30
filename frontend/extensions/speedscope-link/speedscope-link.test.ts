// @vitest-environment jsdom
// Tests for speedscope-link.ts: the viewer's link on the profile with the page's state.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { widgetTestbed } from '../../hosts/widgets/widgets-testing';
import { speedscopeLink } from './speedscope-link';

let testbed: ReturnType<typeof widgetTestbed>;

beforeEach(() => {
  testbed = widgetTestbed();
  testbed.activate(speedscopeLink);
});

afterEach(() => testbed.dispose());

/** The profile URL the link hands to the viewer. */
function profileUrl(link: HTMLAnchorElement): URL {
  const href = new URL(link.href);
  expect(href.pathname).toBe('/p/shop/api/4/viewer/');
  return new URL(decodeURIComponent(href.hash.replace('#profileURL=', '')));
}

describe('speedscopeLink', () => {
  it('links the viewer to its query with the page’s time range and params', () => {
    testbed.query.params.set('path', '^/api/');
    const { el } = testbed.render({ type: 'speedscopeLink', props: {}, dataUrl: '/p/shop/api/4' });
    const link = el.querySelector('a')!;
    expect(link.textContent).toBe('Open Speedscope');
    const profile = profileUrl(link);
    expect(profile.pathname).toBe('/p/shop/api/4/speedscope-query');
    expect(JSON.parse(profile.searchParams.get('filters')!).timeRange).toBe('24h');
    expect(JSON.parse(profile.searchParams.get('params')!)).toEqual({ path: '^/api/' });
  });

  it('follows a change of the time range', () => {
    const { el } = testbed.render({ type: 'speedscopeLink', props: { title: 'Flame graph' }, dataUrl: '/p/shop/api/4' });
    testbed.query.time.setRange('1h');
    const link = el.querySelector('a')!;
    expect(link.textContent).toBe('Flame graph');
    expect(JSON.parse(profileUrl(link).searchParams.get('filters')!).timeRange).toBe('1h');
  });
});
