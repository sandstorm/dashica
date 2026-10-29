// @vitest-environment jsdom
// Tests for grid.ts: the template as CSS grid areas, each area's widget in its cell.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settle, widgetTestbed } from '../../hosts/widgets/widgets-testing';
import { markdown } from '../markdown/markdown';
import { grid } from './grid';

let testbed: ReturnType<typeof widgetTestbed>;

beforeEach(() => {
  testbed = widgetTestbed();
  testbed.activate(grid, markdown);
});

afterEach(() => testbed.dispose());

describe('grid', () => {
  it('lays out its areas as the template draws them, each area’s widget in its cell', async () => {
    const { el } = testbed.render({
      type: 'grid',
      props: { template: ['a b', 'c c'], gap: '4px' },
      children: {
        b: { type: 'markdown', props: { html: '<p>Errors</p>' } },
        a: { type: 'markdown', props: { html: '<p>Requests</p>' } },
      },
    });
    await settle();
    const layout = el.firstElementChild as HTMLElement;
    expect(layout.style.gridTemplateColumns).toBe('repeat(2, 1fr)');
    expect(layout.style.gridTemplateAreas).toBe('"a b" "c c"');
    expect(layout.style.gap).toBe('4px');
    const cells = [...layout.children].map((cell) => [(cell as HTMLElement).style.gridArea, cell.textContent?.trim()]);
    expect(cells).toEqual([
      ['a', 'Requests'],
      ['b', 'Errors'],
    ]);
  });
});
