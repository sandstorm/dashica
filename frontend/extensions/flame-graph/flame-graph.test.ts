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

  it('shows the frame menu on a right click: zoom, search, copy the name or the stack', async () => {
    const widgetContainer = await renderProfile();
    const contextMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 1, clientY: 3 * ROW_HEIGHT + 2 });
    canvasOf(widgetContainer).dispatchEvent(contextMenu);
    expect(contextMenu.defaultPrevented).toBe(true);
    expect(testbed.menus.map(({ menuId }) => menuId)).toEqual(['flameGraph/frame']);
    const frame = testbed.menus[0].options.args![0] as { name: string; stack: string };
    expect([frame.name, frame.stack]).toEqual(['PDO::query', 'index.php;Foo::bar;PDO::query']);
    expect(testbed.ui.getMenuItems('flameGraph/frame', frame).map((item) => item.title)).toEqual([
      'Zoom to frame',
      'Search for this function',
      'Copy function name',
      'Copy stack (root first)',
    ]);

    const written: string[] = [];
    vi.stubGlobal('navigator', { clipboard: { writeText: async (text: string) => void written.push(text) } });
    await testbed.commands.executeCommand('flameGraph.copyStack', frame);
    await testbed.commands.executeCommand('flameGraph.copyName', frame);
    expect(written).toEqual(['index.php;Foo::bar;PDO::query', 'PDO::query']);
    await testbed.commands.executeCommand('flameGraph.zoomToFrame', frame);
    expect(statusOf(widgetContainer)).toBe('6 samples · 60.0% of all in PDO::query');
    await testbed.commands.executeCommand('flameGraph.searchFunction', frame);
    expect(widgetContainer.querySelector<HTMLInputElement>('.d-flame-graph__search')!.value).toBe('^PDO::query$');

    // the root is no frame of the profile: the browser's menu
    const onRoot = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 1, clientY: 2 });
    canvasOf(widgetContainer).dispatchEvent(onRoot);
    expect(onRoot.defaultPrevented).toBe(false);
  });

  it('shows a tooltip for the frame under the pointer', async () => {
    const widgetContainer = await renderProfile();
    canvasOf(widgetContainer).dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 1, clientY: 3 * ROW_HEIGHT + 2 }));
    const tooltipElement = widgetContainer.querySelector<HTMLElement>('.d-flame-graph__tooltip')!;
    expect(tooltipElement.hidden).toBe(false);
    expect(tooltipElement.textContent).toBe('PDO::query6 samples (60.0%), self 6 (60.0%)right click for more');
    canvasOf(widgetContainer).dispatchEvent(new MouseEvent('mouseleave'));
    expect(tooltipElement.hidden).toBe(true);
  });

  it('goes full screen and back, the graph as wide as the screen meanwhile', async () => {
    const widgetContainer = await renderProfile();
    const rootElement = widgetContainer.querySelector<HTMLElement>('.d-flame-graph')!;
    // jsdom has no Fullscreen API; one that switches at once, as a browser does after its animation
    const switchTo = (element: Element | null) => {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => element });
      rootElement.dispatchEvent(new Event('fullscreenchange'));
    };
    rootElement.requestFullscreen = async () => switchTo(rootElement);
    document.exitFullscreen = async () => switchTo(null);
    const buttonElement = widgetContainer.querySelector<HTMLButtonElement>('.d-flame-graph__fullscreen')!;
    expect(buttonElement.title).toBe('Full screen');

    buttonElement.click();
    await settle();
    expect(rootElement.classList.contains('d-flame-graph--fullscreen')).toBe(true);
    expect(buttonElement.title).toBe('Exit full screen');
    expect(widgetContainer.querySelector<HTMLElement>('.d-flame-graph__graph')!.style.maxHeight).toBe('');
    testbed.resize(1600);
    expect(canvasOf(widgetContainer).style.width).toBe('1600px');

    buttonElement.click();
    await settle();
    expect(rootElement.classList.contains('d-flame-graph--fullscreen')).toBe(false);
    expect(buttonElement.title).toBe('Full screen');
    expect(widgetContainer.querySelector<HTMLElement>('.d-flame-graph__graph')!.style.maxHeight).toBe('800px');
    delete (document as { fullscreenElement?: unknown }).fullscreenElement;
  });

  it('zooms with Ctrl/⌘ + scroll around the pointer; a plain scroll is the page’s', async () => {
    const widgetContainer = await renderProfile();
    const plain = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -140, clientX: 0 });
    canvasOf(widgetContainer).dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    expect(statusOf(widgetContainer)).toBe('10 samples');

    const zoom = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -140, ctrlKey: true, clientX: 0 });
    canvasOf(widgetContainer).dispatchEvent(zoom);
    expect(zoom.defaultPrevented).toBe(true);
    expect(statusOf(widgetContainer)).toBe('10 samples · 2.7× zoom');
    // the left edge stays: the frames there still show, render at the right end no longer
    expect(labels).toEqual(['all', 'index.php', 'Foo::bar', 'PDO::query']);
  });

  it('pans by a drag, which zooms to no frame', async () => {
    const widgetContainer = await renderProfile();
    widgetContainer.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click();
    expect(statusOf(widgetContainer)).toBe('10 samples · 2.0× zoom');
    expect(labels).not.toContain('render');

    const canvasElement = canvasOf(widgetContainer);
    canvasElement.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 600, clientY: 2 }));
    canvasElement.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 0, clientY: 2 }));
    canvasElement.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 0, clientY: 2 }));
    clickFrame(widgetContainer, 2);
    expect(labels).toContain('render');
    expect(statusOf(widgetContainer)).toBe('10 samples · 2.0× zoom');
  });

  it('zooms and pans with keys, Esc a step back', async () => {
    const widgetContainer = await renderProfile();
    const press = (key: string) => canvasOf(widgetContainer).dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key }));
    press('+');
    press('+');
    expect(statusOf(widgetContainer)).toBe('10 samples · 4.0× zoom');
    press('-');
    expect(statusOf(widgetContainer)).toBe('10 samples · 2.0× zoom');
    press('0');
    expect(statusOf(widgetContainer)).toBe('10 samples');

    clickFrame(widgetContainer, 2);
    press('+');
    press('Escape');
    expect(statusOf(widgetContainer)).toBe('9 samples · 90.0% of all in Foo::bar');
    press('Escape');
    expect(statusOf(widgetContainer)).toBe('10 samples · 100.0% of all in index.php');
  });

  it('shows the path of the zoomed frame, its ancestors zooming to them', async () => {
    const widgetContainer = await renderProfile();
    const crumbs = () => [...widgetContainer.querySelectorAll('.d-flame-graph__crumb')].map((crumbElement) => [crumbElement.tagName, crumbElement.textContent]);
    expect(crumbs()).toEqual([['SPAN', 'all']]);

    clickFrame(widgetContainer, 3);
    expect(crumbs()).toEqual([
      ['BUTTON', 'all'],
      ['BUTTON', 'index.php'],
      ['BUTTON', 'Foo::bar'],
      ['SPAN', 'PDO::query'],
    ]);
    widgetContainer.querySelector<HTMLButtonElement>('button.d-flame-graph__crumb[title="Zoom to index.php"]')!.click();
    expect(statusOf(widgetContainer)).toBe('10 samples · 100.0% of all in index.php');
  });

  it('names a missing column in the chart’s error', async () => {
    const widgetContainer = await renderProfile({ trace: ['main'], cnt: [1] });
    expect(widgetContainer.querySelector('.d-widget-error')!.textContent).toContain('the configured column stack does not exist in the data');
  });
});
