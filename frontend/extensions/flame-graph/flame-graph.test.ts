// @vitest-environment jsdom
// Tests for flame-graph.ts: the frames of a profile drawn root first, zoomed by a click, dimmed by a search, its functions in a table.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settle, widgetTestbed } from '../../hosts/widgets/widgets-testing';
import { TIME, presetRange } from '../time-library/time-state';
import { flameGraph } from './flame-graph';

const ROW_HEIGHT = 18;
const WIDTH = 640;
const PROFILE = {
  stack: ['index.php;Foo::bar;PDO::query', 'index.php;Foo::bar', 'index.php;render'],
  value: [6, 3, 1],
};

/** The labels the canvas got since it was last cleared: what the graph shows now. */
let labels: string[] = [];

let testbed: ReturnType<typeof widgetTestbed>;

beforeEach(() => {
  labels = [];
  // jsdom has no canvas; one that measures 6px a character and records the labels
  const context = {
    setTransform() {},
    clearRect: () => (labels = []),
    fillRect() {},
    strokeRect() {},
    fillText: (text: string) => labels.push(text),
    measureText: (text: string) => ({ width: text.length * 6 }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  testbed = widgetTestbed({ keys: [TIME] });
  testbed.activate(flameGraph);
});

afterEach(() => {
  testbed.dispose();
  vi.restoreAllMocks();
});

async function renderProfile(columns: Record<string, readonly unknown[]> = PROFILE) {
  testbed.serve('/p/shop/api/7/query', columns);
  const { widgetContainer } = testbed.render({ type: 'flameGraph', props: { title: 'Profile' }, dataUrl: '/p/shop/api/7' });
  testbed.resize(WIDTH);
  testbed.scrollIntoView();
  await settle();
  return widgetContainer;
}

const statusOf = (widgetContainer: HTMLElement) => widgetContainer.querySelector('.d-flame-graph__status')!.textContent;
const functionsOf = (widgetContainer: HTMLElement) =>
  [...widgetContainer.querySelectorAll('.d-flame-graph__function')].map((rowElement) => [...rowElement.querySelectorAll('td')].map((cell) => cell.textContent));
const canvasOf = (widgetContainer: HTMLElement) => widgetContainer.querySelector('canvas')!;
/** A click on the frame at `row` (0: the root), `x` px from the left. */
const clickFrame = (widgetContainer: HTMLElement, row: number, x = 1) =>
  canvasOf(widgetContainer).dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: row * ROW_HEIGHT + 2 }));
const search = (widgetContainer: HTMLElement, term: string) => {
  const searchElement = widgetContainer.querySelector<HTMLInputElement>('.d-flame-graph__search')!;
  searchElement.value = term;
  searchElement.dispatchEvent(new Event('input'));
};

describe('flameGraph', () => {
  it('draws the frames of the stacks root first, its functions by self samples below', async () => {
    const widgetContainer = await renderProfile();
    expect(widgetContainer.querySelector('.d-chart-frame__title')!.textContent).toBe('Profile');
    expect(labels).toEqual(['all', 'index.php', 'Foo::bar', 'PDO::query', 'render']);
    expect(canvasOf(widgetContainer).style.height).toBe(`${4 * ROW_HEIGHT}px`);
    expect(statusOf(widgetContainer)).toBe('10 samples');
    expect(functionsOf(widgetContainer)).toEqual([
      ['PDO::query', '6 (60.0%)', '6 (60.0%)'],
      ['Foo::bar', '3 (30.0%)', '9 (90.0%)'],
      ['render', '1 (10.0%)', '1 (10.0%)'],
      ['index.php', '0 (0.0%)', '10 (100.0%)'],
    ]);
  });

  it('takes Int64 samples as ClickHouse sums them', async () => {
    const widgetContainer = await renderProfile({ stack: ['main;a'], value: BigInt64Array.from([12n]) as unknown as readonly unknown[] });
    expect(statusOf(widgetContainer)).toBe('12 samples');
  });

  it('zooms to a clicked frame, its ancestors above it, until Reset zoom', async () => {
    const widgetContainer = await renderProfile();
    const resetElement = [...widgetContainer.querySelectorAll('button')].find((buttonElement) => buttonElement.textContent === 'Reset zoom')!;
    expect(resetElement.disabled).toBe(true);

    clickFrame(widgetContainer, 2);
    expect(labels).toEqual(['all', 'index.php', 'Foo::bar', 'PDO::query']);
    expect(statusOf(widgetContainer)).toBe('9 samples · 90.0% of all in Foo::bar');
    expect(resetElement.disabled).toBe(false);

    resetElement.click();
    expect(labels).toEqual(['all', 'index.php', 'Foo::bar', 'PDO::query', 'render']);
    expect(resetElement.disabled).toBe(true);
  });

  it('keeps the zoom on the frame of the same names when the page queries again', async () => {
    const widgetContainer = await renderProfile();
    clickFrame(widgetContainer, 2);
    testbed.serve('/p/shop/api/7/query', { stack: ['index.php;Foo::bar;Cache::get', 'index.php;render'], value: [4, 4] });
    testbed.query.set(TIME, presetRange('1h'));
    await settle();
    expect(labels).toEqual(['all', 'index.php', 'Foo::bar', 'Cache::get']);
    expect(statusOf(widgetContainer)).toBe('4 samples · 50.0% of all in Foo::bar');
  });

  it('tells the share of the frames a search matches; a click on a function searches for it', async () => {
    const widgetContainer = await renderProfile();
    search(widgetContainer, 'pdo|render');
    expect(statusOf(widgetContainer)).toBe('10 samples · search matches 70.0%');
    // an invalid regular expression searches for the text
    search(widgetContainer, 'Foo::bar(');
    expect(statusOf(widgetContainer)).toBe('10 samples · search matches 0.0%');

    widgetContainer.querySelector<HTMLElement>('.d-flame-graph__function')!.click();
    expect(widgetContainer.querySelector<HTMLInputElement>('.d-flame-graph__search')!.value).toBe('^PDO::query$');
    expect(statusOf(widgetContainer)).toBe('10 samples · search matches 60.0%');
  });

  it('sorts its functions by total samples', async () => {
    const widgetContainer = await renderProfile();
    [...widgetContainer.querySelectorAll<HTMLButtonElement>('.d-flame-graph__sort')].find((buttonElement) => buttonElement.textContent === 'Total')!.click();
    expect(functionsOf(widgetContainer).map(([name]) => name)).toEqual(['index.php', 'Foo::bar', 'PDO::query', 'render']);
  });

  it('shows a tooltip for the frame under the pointer', async () => {
    const widgetContainer = await renderProfile();
    canvasOf(widgetContainer).dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 1, clientY: 3 * ROW_HEIGHT + 2 }));
    const tooltipElement = widgetContainer.querySelector<HTMLElement>('.d-flame-graph__tooltip')!;
    expect(tooltipElement.hidden).toBe(false);
    expect(tooltipElement.textContent).toBe('PDO::query6 samples (60.0%), self 6 (60.0%)');
    canvasOf(widgetContainer).dispatchEvent(new MouseEvent('mouseleave'));
    expect(tooltipElement.hidden).toBe(true);
  });

  it('names a missing column in the chart’s error', async () => {
    const widgetContainer = await renderProfile({ trace: ['main'], cnt: [1] });
    expect(widgetContainer.querySelector('.d-widget-error')!.textContent).toContain('the configured column stack does not exist in the data');
  });
});
