// Test helper for the Plot charts: points Plot's pointer at a mark and clicks it, as a viewer's mouse does.

// Plot's tip measures its text once it shows (getBBox); jsdom lays out nothing, so every box is empty
if (!('getBBox' in SVGElement.prototype)) {
  Object.defineProperty(SVGElement.prototype, 'getBBox', { configurable: true, value: () => ({ x: 0, y: 0, width: 0, height: 0 }) });
}

/**
 * Moves the pointer onto `mark` (a bar's `rect`, a line's `path`), so Plot points at its row (`plot.value`): a
 * `pointermove` at the rect's centre, at a path's first point, then an animation frame, in which Plot picks the closest
 * facet. jsdom lays out nothing, so an element's client coordinates are its SVG coordinates, with the `translate` of
 * the groups around it.
 */
export async function pointAt(mark: Element): Promise<[number, number]> {
  const at = anchor(mark);
  await moveTo(mark, at);
  return at;
}

/** Clicks `target` (by default `mark`) with a mouse once Plot points at `mark`'s row, see pointAt. */
export async function clickMark(mark: Element, target: Element = mark): Promise<void> {
  clickAt(target, await pointAt(mark));
}

/** Moves the pointer onto `target` at the client point `at`, then clicks it there with a mouse, see pointAt. */
export async function clickAtPoint(target: Element, at: [number, number]): Promise<void> {
  await moveTo(target, at);
  clickAt(target, at);
}

/** A `pointermove` on `target` at the client point `[x, y]`, then an animation frame, see pointAt. */
async function moveTo(target: Element, [x, y]: [number, number]): Promise<void> {
  target.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));
  await new Promise((resolve) => requestAnimationFrame(resolve));
}

/** A mouse's pointerdown (Plot pins its tip on one), then the click, on `target` at `[x, y]`. */
function clickAt(target: Element, [x, y]: [number, number]): void {
  const down = new MouseEvent('pointerdown', { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(down, 'pointerType', { value: 'mouse' });
  target.dispatchEvent(down);
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
}

/** Where pointAt points at `mark`, as client coordinates: a rect's centre, a path's first point. */
export function anchor(mark: Element): [number, number] {
  const number = (name: string) => Number(mark.getAttribute(name) ?? 0);
  let [x, y] =
    mark.tagName === 'path'
      ? (mark.getAttribute('d') ?? '').slice(1).split(/[,LHVZ ]/).map(Number)
      : [number('x') + number('width') / 2, number('y') + number('height') / 2];
  for (let el: Element | null = mark; el && el.tagName !== 'svg'; el = el.parentElement) {
    const translate = /translate\(([-\d.]+)(?:[, ]([-\d.]+))?\)/.exec(el.getAttribute('transform') ?? '');
    if (translate) (x += Number(translate[1])), (y += Number(translate[2] ?? 0));
  }
  return [x, y];
}
