// See flameGraph in flame-graph.ts.
import { html } from 'htl';
import { Maximize2, Minimize2, ZoomIn, ZoomOut, createElement } from 'lucide';
import type { QueryResult } from '../../hosts/widgets/widgets';
import { SchemaAnalyzer } from '../chart-library/schema';
import { callTreeOf, functionCostsOf, heightOf, matchedValueOf, nodeAt, pathOf, type CallNode, type FunctionCost } from './call-tree';

const ROW_HEIGHT = 18;
/** Frames narrower than this (in px) are not drawn, and neither are their children. */
const MIN_FRAME_WIDTH = 0.5;
/** Frames narrower than this (in px) are drawn without their name. */
const MIN_LABEL_WIDTH = 24;
const LABEL_PADDING = 3;
const TOP_FUNCTIONS = 50;
/** The smallest part of the zoomed frame the viewport shows: a millionth, a sample of a million fills the width. */
const MIN_SPAN = 1e-6;
/** How far a pointer moves (in px) before a press is a drag, not a click. */
const DRAG_THRESHOLD = 3;
/** A scroll of this many px (Ctrl/⌘ or a pinch) zooms by e: about 2× per notch of a mouse wheel. */
const WHEEL_ZOOM_PX = 140;
/** A wheel's line, for a scroll in lines (`deltaMode` 1) rather than pixels. */
const WHEEL_LINE_PX = 16;

/** A frame as drawn: its node, its row from the top and its horizontal extent in px. */
interface FrameBox {
  readonly node: CallNode;
  readonly row: number;
  readonly x: number;
  readonly width: number;
  /** Whether it is an ancestor of the zoomed frame, drawn full width above it. */
  readonly ancestor: boolean;
}

/** A press on the graph: where it began and the viewport then, and whether it moved enough to pan. */
interface Drag {
  readonly x: number;
  readonly viewStart: number;
  moved: boolean;
}

type SortKey = 'self' | 'total';

/** The menu a right click on a frame shows (`WidgetContext.showMenu`), the `flameGraph` extension's entries in it. */
export const FRAME_MENU = 'flameGraph/frame';

/** What the menu `flameGraph/frame` is shown for: a frame, by its function's name and its stack, and what to do in its graph. */
export interface FrameMenuContext {
  readonly name: string;
  /** The frames from the root's first child down to this one, separated by ";", as the query's `stack` has them. */
  readonly stack: string;
  /** Zooms the graph to the frame. */
  zoom(): void;
  /** Searches the graph for the frame's function. */
  search(): void;
}

/** Shows the menu `flameGraph/frame` at a point (a right click's `clientX` / `clientY`). */
export type ShowFrameMenu = (anchor: { readonly x: number; readonly y: number }, context: FrameMenuContext) => void;

/**
 * The flame graph of a query result's `stack` and `value` columns with its search box, zoom and top functions table.
 * `draw` returns the same element for every result, so the zoom and the search stay while the page refreshes: the
 * zoom moves to the frame at the same names in the new tree.
 */
export class FlameGraphView {
  readonly #rootElement: HTMLElement;
  readonly #searchElement: HTMLInputElement;
  readonly #resetElement: HTMLButtonElement;
  readonly #zoomInElement: HTMLButtonElement;
  readonly #zoomOutElement: HTMLButtonElement;
  readonly #pathContainer: HTMLElement;
  readonly #statusElement: HTMLElement;
  readonly #fullscreenElement: HTMLButtonElement;
  readonly #graphContainer: HTMLElement;
  readonly #canvasElement: HTMLCanvasElement;
  readonly #tooltipElement: HTMLElement;
  readonly #sortElements: Record<SortKey, HTMLButtonElement>;
  readonly #rowContainer: HTMLElement;
  #result: QueryResult | undefined;
  #tree: CallNode = callTreeOf([]);
  #costs: FunctionCost[] = [];
  #zoomed: CallNode = this.#tree;
  /** The part of the zoomed frame the graph shows, as fractions of its samples: 0 to 1 shows all of it. */
  #viewStart = 0;
  #viewEnd = 1;
  #drag: Drag | undefined;
  /** Whether the press that ends in the next click was a drag, so the click zooms to nothing. */
  #dragged = false;
  #matches: ((name: string) => boolean) | undefined;
  #sortKey: SortKey = 'self';
  readonly #height: number;
  /** The width the chart frame gives; the graph's own while it is full screen. */
  #frameWidth = 0;
  #width = 0;
  /** Follows the graph's width while it is full screen. */
  #fullscreenResize: ResizeObserver | undefined;
  #colorSchemeDark = false;
  #boxes: FrameBox[] = [];
  /** The drawn frames by row, for the one under the pointer. */
  #boxesByRow: FrameBox[][] = [];
  /** The frame the tooltip shows. */
  #tooltipNode: CallNode | undefined;

  /** `height`: the most the graph takes in px before it scrolls. */
  constructor(height: number, showFrameMenu: ShowFrameMenu) {
    this.#height = height;
    this.#searchElement = html`<input type="search" class="d-field d-field--mono d-flame-graph__search" placeholder="Search (regex)" aria-label="Search frames" oninput=${() => this.#search()} />`;
    this.#resetElement = html`<button type="button" class="d-button" disabled onclick=${() => this.#zoom(this.#tree)}>Reset zoom</button>`;
    this.#zoomOutElement = html`<button type="button" class="d-button d-button--icon" title="Zoom out (−)" aria-label="Zoom out" onclick=${() => this.#zoomOut()}>${createElement(ZoomOut, { width: 16, height: 16 })}</button>`;
    this.#zoomInElement = html`<button type="button" class="d-button d-button--icon" title="Zoom in (+)" aria-label="Zoom in" onclick=${() => this.#zoomBy(0.5, this.#width / 2)}>${createElement(ZoomIn, { width: 16, height: 16 })}</button>`;
    this.#pathContainer = html`<span class="d-flame-graph__path"></span>`;
    this.#statusElement = html`<span class="d-flame-graph__status"></span>`;
    this.#fullscreenElement = html`<button type="button" class="d-button d-button--icon d-flame-graph__fullscreen" onclick=${() => this.#toggleFullscreen()}></button>`;
    this.#canvasElement = html`<canvas class="d-flame-graph__canvas" tabindex="0" aria-label="Flame graph" onmousemove=${(event: MouseEvent) => this.#hover(event)} onmouseleave=${() => this.#hover(undefined)} onclick=${(event: MouseEvent) => this.#click(event)}></canvas>`;
    this.#tooltipElement = html`<div class="d-flame-graph__tooltip" hidden></div>`;
    this.#sortElements = {
      self: html`<button type="button" class="d-flame-graph__sort" onclick=${() => this.#sort('self')}>Self</button>`,
      total: html`<button type="button" class="d-flame-graph__sort" onclick=${() => this.#sort('total')}>Total</button>`,
    };
    this.#rowContainer = html`<tbody></tbody>`;
    this.#graphContainer = html`<div class="d-flame-graph__graph" style=${{ 'max-height': `${height}px` }}>${this.#canvasElement}${this.#tooltipElement}</div>`;
    this.#rootElement = html`<div class="d-flame-graph">
      <div class="d-flame-graph__toolbar">${this.#searchElement}${this.#zoomOutElement}${this.#zoomInElement}${this.#resetElement}${this.#statusElement}${this.#fullscreenElement}</div>
      <nav class="d-flame-graph__trail" aria-label="Zoomed frames">${this.#pathContainer}<span class="d-flame-graph__hint">Click a frame to zoom to it · Ctrl/⌘ + scroll or pinch to zoom · drag to pan · keys + − 0 ← → Esc</span></nav>
      ${this.#graphContainer}
      <div class="d-flame-graph__functions">
        <table class="d-flame-graph__table">
          <thead><tr><th>Function</th><th>${this.#sortElements.self}</th><th>${this.#sortElements.total}</th></tr></thead>
          ${this.#rowContainer}
        </table>
      </div>
    </div>`;
    // listened to, not an `on…` attribute: htl wires those only where the element has the property, which jsdom lacks
    this.#rootElement.addEventListener('fullscreenchange', () => this.#fullscreenChanged());
    // not passive: a zoom or a pan keeps the page from scrolling
    this.#canvasElement.addEventListener('wheel', (event) => this.#wheel(event), { passive: false });
    this.#canvasElement.addEventListener('pointerdown', (event) => this.#pressed(event));
    this.#canvasElement.addEventListener('pointermove', (event) => this.#dragTo(event));
    this.#canvasElement.addEventListener('pointerup', () => this.#released());
    this.#canvasElement.addEventListener('pointercancel', () => this.#released());
    this.#canvasElement.addEventListener('keydown', (event) => this.#key(event));
    this.#canvasElement.addEventListener('contextmenu', (event) => {
      const box = this.#boxAt(event);
      if (!box?.node.parent) return;
      event.preventDefault();
      const { node } = box;
      showFrameMenu(
        { x: event.clientX, y: event.clientY },
        {
          name: node.name,
          stack: pathOf(node)
            .slice(1)
            .map((frame) => frame.name)
            .join(';'),
          zoom: () => this.#zoom(node),
          search: () => this.#searchFor(node.name),
        },
      );
    });
    this.#drawFullscreenButton(false);
  }

  /** The flame graph of `result`, `width` px wide; the same element each time. */
  draw(result: QueryResult, width: number, colorSchemeDark: boolean): HTMLElement {
    if (result !== this.#result) this.#load(result);
    this.#frameWidth = width;
    if (!this.#fullscreenResize) this.#width = width;
    this.#colorSchemeDark = colorSchemeDark;
    this.#layout();
    return this.#rootElement;
  }

  dispose(): void {
    this.#fullscreenResize?.disconnect();
  }

  #toggleFullscreen(): void {
    const doc = this.#rootElement.ownerDocument;
    const change = doc.fullscreenElement === this.#rootElement ? doc.exitFullscreen() : this.#rootElement.requestFullscreen();
    change.catch((error: unknown) => {
      this.#statusElement.textContent = `Full screen: ${error instanceof Error ? error.message : String(error)}`;
    });
  }

  /** Entered or left full screen: the graph takes the screen's width and height, or the chart frame's again. */
  #fullscreenChanged(): void {
    const fullscreen = this.#rootElement.ownerDocument.fullscreenElement === this.#rootElement;
    this.#rootElement.classList.toggle('d-flame-graph--fullscreen', fullscreen);
    this.#graphContainer.style.maxHeight = fullscreen ? '' : `${this.#height}px`;
    this.#drawFullscreenButton(fullscreen);
    this.#fullscreenResize?.disconnect();
    this.#fullscreenResize = undefined;
    if (fullscreen) {
      const browserWindow = this.#rootElement.ownerDocument.defaultView!;
      this.#fullscreenResize = new browserWindow.ResizeObserver((entries) => {
        const width = Math.round(entries[entries.length - 1].contentRect.width);
        if (width === 0 || width === this.#width) return;
        this.#width = width;
        this.#layout();
      });
      this.#fullscreenResize.observe(this.#graphContainer);
    } else {
      this.#width = this.#frameWidth;
      this.#layout();
    }
  }

  #drawFullscreenButton(fullscreen: boolean): void {
    const label = fullscreen ? 'Exit full screen' : 'Full screen';
    this.#fullscreenElement.title = label;
    this.#fullscreenElement.setAttribute('aria-label', label);
    this.#fullscreenElement.replaceChildren(createElement(fullscreen ? Minimize2 : Maximize2, { width: 16, height: 16 }));
  }

  #load(result: QueryResult): void {
    const schema = new SchemaAnalyzer(result);
    schema.requiredColumn('stack');
    schema.requiredColumn('value');
    const stackColumn = result.getChild('stack')!;
    const valueColumn = result.getChild('value')!;
    const stacks = Array.from({ length: result.numRows }, (_, i) => ({ stack: String(stackColumn.get(i) ?? ''), value: Number(valueColumn.get(i)) }));
    const zoomedPath = pathOf(this.#zoomed).map((node) => node.name);
    this.#result = result;
    this.#tree = callTreeOf(stacks);
    this.#costs = functionCostsOf(this.#tree);
    this.#zoomed = nodeAt(this.#tree, zoomedPath);
    this.#tooltipNode = undefined;
    this.#drawFunctions();
  }

  /** Zooms to `node`, all of it shown. */
  #zoom(node: CallNode): void {
    this.#zoomed = node;
    this.#viewStart = 0;
    this.#viewEnd = 1;
    this.#layout();
  }

  /** Shows `start` to `end` of the zoomed frame, kept inside it and no narrower than MIN_SPAN. */
  #view(start: number, end: number): void {
    const span = Math.min(Math.max(end - start, MIN_SPAN), 1);
    this.#viewStart = Math.min(Math.max(start, 0), 1 - span);
    this.#viewEnd = this.#viewStart + span;
    this.#layout();
  }

  /** Zooms the viewport by `factor` (below 1: in), the point `anchorX` px from the left staying where it is. */
  #zoomBy(factor: number, anchorX: number): void {
    const span = this.#viewEnd - this.#viewStart;
    const anchor = this.#width > 0 ? anchorX / this.#width : 0.5;
    const at = this.#viewStart + anchor * span;
    const next = Math.min(Math.max(span * factor, MIN_SPAN), 1);
    this.#view(at - anchor * next, at - anchor * next + next);
  }

  /** Zooms the viewport out; at all of the zoomed frame, to its parent. */
  #zoomOut(): void {
    if (this.#viewEnd - this.#viewStart < 1) this.#zoomBy(2, this.#width / 2);
    else if (this.#zoomed.parent) this.#zoom(this.#zoomed.parent);
  }

  /** Moves the viewport by `dx` px, to the right for a positive one. */
  #panBy(dx: number): void {
    const shift = this.#width > 0 ? (dx / this.#width) * (this.#viewEnd - this.#viewStart) : 0;
    this.#view(this.#viewStart + shift, this.#viewEnd + shift);
  }

  #wheel(event: WheelEvent): void {
    const scale = event.deltaMode === 1 ? WHEEL_LINE_PX : 1;
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      this.#zoomBy(Math.exp((event.deltaY * scale) / WHEEL_ZOOM_PX), event.clientX - this.#canvasElement.getBoundingClientRect().left);
      return;
    }
    const sideways = event.shiftKey ? event.deltaX || event.deltaY : Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : 0;
    // a sideways scroll at all of the frame has nothing to pan: the page takes it
    if (sideways === 0 || this.#viewEnd - this.#viewStart >= 1) return;
    event.preventDefault();
    this.#panBy(sideways * scale);
  }

  #pressed(event: PointerEvent): void {
    if (event.button !== 0) return;
    // a drag released outside the graph gets no click to clear it
    this.#dragged = false;
    this.#drag = { x: event.clientX, viewStart: this.#viewStart, moved: false };
    if (event.pointerId !== undefined) this.#canvasElement.setPointerCapture?.(event.pointerId);
  }

  #dragTo(event: PointerEvent): void {
    const drag = this.#drag;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
    drag.moved = true;
    const span = this.#viewEnd - this.#viewStart;
    const start = drag.viewStart - (this.#width > 0 ? (dx / this.#width) * span : 0);
    this.#view(start, start + span);
  }

  #released(): void {
    this.#dragged = this.#drag?.moved ?? false;
    this.#drag = undefined;
  }

  #key(event: KeyboardEvent): void {
    const center = this.#width / 2;
    const step = this.#width / 10;
    switch (event.key) {
      case '+':
      case '=':
        this.#zoomBy(0.5, center);
        break;
      case '-':
      case '_':
        this.#zoomOut();
        break;
      case '0':
        this.#view(0, 1);
        break;
      case 'ArrowLeft':
        this.#panBy(-step);
        break;
      case 'ArrowRight':
        this.#panBy(step);
        break;
      case 'Escape':
        if (this.#viewEnd - this.#viewStart >= 1 && !this.#zoomed.parent) return;
        this.#zoomOut();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  #search(): void {
    this.#matches = matcherOf(this.#searchElement.value);
    this.#paint();
    this.#drawStatus();
  }

  #sort(key: SortKey): void {
    this.#sortKey = key;
    this.#drawFunctions();
  }

  /** Where each frame goes for the zoomed frame, the viewport and the width, then draws them. */
  #layout(): void {
    const ancestors = pathOf(this.#zoomed).slice(0, -1);
    const boxes: FrameBox[] = ancestors.map((node, row) => ({ node, row, x: 0, width: this.#width, ancestor: true }));
    const pxPerFraction = this.#width / (this.#viewEnd - this.#viewStart);
    // `start` and `span`: the frame's part of the zoomed frame's samples; drawn cut to what the viewport shows
    const place = (node: CallNode, row: number, start: number, span: number) => {
      const left = (start - this.#viewStart) * pxPerFraction;
      const right = left + span * pxPerFraction;
      if (right - left < MIN_FRAME_WIDTH || right <= 0 || left >= this.#width) return;
      const x = Math.max(left, 0);
      boxes.push({ node, row, x, width: Math.min(right, this.#width) - x, ancestor: false });
      let childStart = start;
      for (const child of node.children) {
        const childSpan = node.value > 0 ? (span * child.value) / node.value : 0;
        place(child, row + 1, childStart, childSpan);
        childStart += childSpan;
      }
    };
    if (this.#zoomed.value > 0) place(this.#zoomed, ancestors.length, 0, 1);
    this.#boxes = boxes;
    this.#boxesByRow = [];
    for (const box of boxes) (this.#boxesByRow[box.row] ??= []).push(box);
    this.#tooltipNode = undefined;
    this.#tooltipElement.hidden = true;

    const rows = this.#zoomed.value > 0 ? ancestors.length + 1 + heightOf(this.#zoomed) : 0;
    const pixelRatio = this.#canvasElement.ownerDocument.defaultView?.devicePixelRatio ?? 1;
    this.#canvasElement.width = Math.round(this.#width * pixelRatio);
    this.#canvasElement.height = Math.round(rows * ROW_HEIGHT * pixelRatio);
    this.#canvasElement.style.width = `${this.#width}px`;
    this.#canvasElement.style.height = `${rows * ROW_HEIGHT}px`;
    const unzoomed = this.#zoomed === this.#tree && this.#viewEnd - this.#viewStart >= 1;
    this.#resetElement.disabled = unzoomed;
    this.#zoomOutElement.disabled = unzoomed;
    this.#zoomInElement.disabled = this.#viewEnd - this.#viewStart <= MIN_SPAN;
    this.#paint();
    this.#drawStatus();
    this.#drawPath();
  }

  /** The zoomed frame's path from the root, each ancestor a button that zooms to it. */
  #drawPath(): void {
    const path = pathOf(this.#zoomed);
    this.#pathContainer.replaceChildren(
      ...path.flatMap((node, i) => {
        const separator = i > 0 ? [html`<span class="d-flame-graph__separator" aria-hidden="true">›</span>`] : [];
        const crumb =
          i === path.length - 1
            ? html`<span class="d-flame-graph__crumb" aria-current="location">${node.name}</span>`
            : html`<button type="button" class="d-flame-graph__crumb" title="Zoom to ${node.name}" onclick=${() => this.#zoom(node)}>${node.name}</button>`;
        return [...separator, crumb];
      }),
    );
  }

  #paint(): void {
    const context = this.#canvasElement.getContext('2d');
    if (!context) return;
    const style = getComputedStyle(this.#rootElement);
    const token = (name: string) => style.getPropertyValue(name).trim();
    const pixelRatio = this.#canvasElement.width / Math.max(this.#width, 1);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, this.#width, this.#canvasElement.height / pixelRatio);
    context.font = `${token('--text-xs') || '11px'} ${token('--font-mono') || 'monospace'}`;
    context.textBaseline = 'middle';
    for (const box of this.#boxes) {
      const matched = !this.#matches || this.#matches(box.node.name);
      const y = box.row * ROW_HEIGHT;
      context.globalAlpha = box.ancestor ? 0.6 : 1;
      context.fillStyle = matched ? frameColorOf(box.node.name, this.#colorSchemeDark) : token('--color-surface-subtle');
      context.fillRect(box.x, y, Math.max(box.width - 1, MIN_FRAME_WIDTH), ROW_HEIGHT - 1);
      if (box.width >= MIN_LABEL_WIDTH) {
        context.fillStyle = matched ? token('--color-text') : token('--color-text-muted');
        context.fillText(fittedLabelOf(context, box.node.name, box.width - 2 * LABEL_PADDING), box.x + LABEL_PADDING, y + ROW_HEIGHT / 2);
      }
    }
    context.globalAlpha = 1;
  }

  #drawStatus(): void {
    const zoomed = this.#zoomed;
    if (this.#tree.value === 0) {
      this.#statusElement.textContent = 'No samples';
      return;
    }
    const parts = [`${countOf(zoomed.value)} samples`];
    if (zoomed !== this.#tree) parts.push(`${percentOf(zoomed.value, this.#tree.value)} of all in ${zoomed.name}`);
    const span = this.#viewEnd - this.#viewStart;
    if (span < 1) parts.push(`${(1 / span).toFixed(1)}× zoom`);
    if (this.#matches) parts.push(`search matches ${percentOf(matchedValueOf(zoomed, this.#matches), zoomed.value)}`);
    this.#statusElement.textContent = parts.join(' · ');
  }

  #drawFunctions(): void {
    const total = this.#tree.value;
    const costs = [...this.#costs].sort((a, b) => b[this.#sortKey] - a[this.#sortKey]).slice(0, TOP_FUNCTIONS);
    for (const key of ['self', 'total'] as const) {
      this.#sortElements[key].setAttribute('aria-pressed', String(key === this.#sortKey));
    }
    this.#rowContainer.replaceChildren(
      ...costs.map(
        (cost) => html`<tr class="d-flame-graph__function" title="Search for this function" onclick=${() => this.#searchFor(cost.name)}>
          <td class="d-flame-graph__name">${cost.name}</td>
          <td class="d-flame-graph__number">${countOf(cost.self)} (${percentOf(cost.self, total)})</td>
          <td class="d-flame-graph__number">${countOf(cost.total)} (${percentOf(cost.total, total)})</td>
        </tr>`,
      ),
    );
  }

  #searchFor(name: string): void {
    this.#searchElement.value = `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
    this.#search();
  }

  #hover(event: MouseEvent | undefined): void {
    const box = event && this.#boxAt(event);
    if (!box || !event) {
      this.#tooltipElement.hidden = true;
      this.#tooltipNode = undefined;
      return;
    }
    const { node } = box;
    if (node !== this.#tooltipNode) {
      this.#tooltipNode = node;
      const total = this.#tree.value;
      this.#tooltipElement.replaceChildren(
        html`<div class="d-flame-graph__tooltip-name">${node.name}</div>`,
        html`<div>${countOf(node.value)} samples (${percentOf(node.value, total)}), self ${countOf(node.self)} (${percentOf(node.self, total)})</div>`,
        html`<div class="d-flame-graph__tooltip-hint">right click for more</div>`,
      );
    }
    this.#tooltipElement.hidden = false;
    const rect = this.#canvasElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    this.#tooltipElement.style.left = `${Math.max(0, Math.min(x + 12, this.#width - this.#tooltipElement.offsetWidth))}px`;
    this.#tooltipElement.style.top = `${(box.row + 1) * ROW_HEIGHT + 4}px`;
  }

  #click(event: MouseEvent): void {
    if (this.#dragged) {
      this.#dragged = false;
      return;
    }
    const box = this.#boxAt(event);
    // the zoomed frame itself: all of it again
    if (box) this.#zoom(box.node);
  }

  #boxAt(event: MouseEvent): FrameBox | undefined {
    const rect = this.#canvasElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const row = Math.floor((event.clientY - rect.top) / ROW_HEIGHT);
    return this.#boxesByRow[row]?.find((box) => x >= box.x && x < box.x + box.width);
  }
}

/** What a search for `term` matches: a frame name the regular expression finds (case-insensitive), or one containing `term` when it is none; `undefined` for an empty term. */
function matcherOf(term: string): ((name: string) => boolean) | undefined {
  if (term === '') return undefined;
  try {
    const expression = new RegExp(term, 'i');
    return (name) => expression.test(name);
  } catch {
    const lower = term.toLowerCase();
    return (name) => name.toLowerCase().includes(lower);
  }
}

/** A warm color for `name`, the same on every draw, darker on the dark scheme so the token text reads on it. */
function frameColorOf(name: string, colorSchemeDark: boolean): string {
  let hash = 2166136261;
  for (let i = 0; i < name.length; i++) hash = Math.imul(hash ^ name.charCodeAt(i), 16777619) >>> 0;
  const hue = 8 + (hash % 44);
  const saturation = 70 + ((hash >>> 8) % 20);
  const lightness = colorSchemeDark ? 34 + ((hash >>> 16) % 10) : 62 + ((hash >>> 16) % 12);
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

/** `name`, cut with "…" to fit `maxWidth` px; '' when not even one character does. */
function fittedLabelOf(context: CanvasRenderingContext2D, name: string, maxWidth: number): string {
  if (context.measureText(name).width <= maxWidth) return name;
  let low = 0;
  let high = name.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (context.measureText(name.slice(0, middle) + '…').width <= maxWidth) low = middle;
    else high = middle - 1;
  }
  return low === 0 ? '' : name.slice(0, low) + '…';
}

function countOf(value: number): string {
  return value.toLocaleString('en-US');
}

function percentOf(value: number, total: number): string {
  return `${total > 0 ? ((value * 100) / total).toFixed(1) : '0.0'}%`;
}
