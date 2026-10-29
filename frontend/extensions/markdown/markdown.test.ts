// @vitest-environment jsdom
// Tests for markdown.ts: the server's HTML below the title.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { widgetTestbed } from '../../hosts/widgets/widgets-testing';
import { markdown } from './markdown';

let testbed: ReturnType<typeof widgetTestbed>;

beforeEach(() => {
  testbed = widgetTestbed();
  testbed.activate(markdown);
});

afterEach(() => testbed.dispose());

describe('markdown', () => {
  it('shows the HTML the server rendered below its title', () => {
    const { el } = testbed.render({ type: 'markdown', props: { title: 'About', html: '<h1 id="wetell">Wetell</h1>' } });
    expect(el.querySelector('h2')!.textContent).toBe('About');
    expect(el.querySelector('.prose')!.innerHTML).toBe('<h1 id="wetell">Wetell</h1>');
  });
});
