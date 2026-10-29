// @vitest-environment jsdom
// Tests for markdown.ts: the server's HTML below the title, the server's error in its place.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settle, widgetTestbed } from '../../hosts/widgets/widgets-testing';
import { markdown } from './markdown';

let testbed: ReturnType<typeof widgetTestbed>;

beforeEach(() => {
  testbed = widgetTestbed();
  testbed.activate(markdown());
});

afterEach(() => testbed.dispose());

describe('markdown', () => {
  it('shows the HTML the server renders below its title', async () => {
    testbed.serveText('/p/wetell/api/1/html', '<h1 id="wetell">Wetell</h1>');
    const { el } = testbed.render({ type: 'markdown', props: { title: 'About', file: 'wetell/about.md' }, dataUrl: '/p/wetell/api/1' });
    await settle();
    expect(el.querySelector('h2')!.textContent).toBe('About');
    expect(el.querySelector('.prose')!.innerHTML).toBe('<h1 id="wetell">Wetell</h1>');
  });

  it('shows the server’s error in its place', async () => {
    testbed.serveText('/p/wetell/api/1/html', 'reading markdown file wetell/about.md: file does not exist', 500);
    const { el } = testbed.render({ type: 'markdown', props: { file: 'wetell/about.md' }, dataUrl: '/p/wetell/api/1' });
    await settle();
    expect(el.textContent).toBe('reading markdown file wetell/about.md: file does not exist (markdown)');
  });
});
