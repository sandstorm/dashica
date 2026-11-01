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
    const { widgetContainer } = testbed.render({ type: 'markdown', props: { title: 'About', html: '<h1 id="shop">Shop</h1>' } });
    expect(widgetContainer.querySelector('h2')!.textContent).toBe('About');
    expect(widgetContainer.querySelector('.d-markdown__body')!.innerHTML).toBe('<h1 id="shop">Shop</h1>');
  });
});
