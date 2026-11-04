// See flameGraph in flame-graph.ts.
import { html } from 'htl';
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

/** A frame as drawn: its node, its row from the top and its horizontal extent in px. */
interface FrameBox {
  readonly node: CallNode;
  readonly row: number;
  readonly x: number;
  readonly width: number;
  /** Whether it is an ancestor of the zoomed frame, drawn full width above it. */
  readonly ancestor: boolean;
}

type SortKey = 'self' | 'total';

/**
 * The flame graph of a query result's `stack` and `value` columns with its search box, zoom and top functions table.
 * `draw` returns the same element for every result, so the zoom and the search stay while the page refreshes: the
 * zoom moves to the frame at the same names in the new tree.
 */
export class FlameGraphView {
  readonly #rootElement: HTMLElement;
  readonly #searchElement: HTMLInputElement;
  readonly #resetElement: HTMLButtonElement;
  readonly #statusElement: HTMLElement;
  readonly #canvasElement: HTMLCanvasElement;
  readonly #tooltipElement: HTMLElement;
  readonly #sortElements: Record<SortKey, HTMLButtonElement>;
  readonly #rowContainer: HTMLElement;
  #result: QueryResult | undefined;
  #tree: CallNode = callTreeOf([]);
  #costs: FunctionCost[] = [];
  #zoomed: CallNode = this.#tree;
  #matches: ((name: string) => boolean) | undefined;
  #sortKey: SortKey = 'self';
  #width = 0;
  #colorSchemeDark = false;
  #boxes: FrameBox[] = [];
  #hovered: CallNode | undefined;

  /** `height`: the most the graph takes in px before it scrolls. */
  constructor(height: number) {
    this.#searchElement = html`<input type="search" class="d-field d-field--mono d-flame-graph__search" placeholder="Search (regex)" aria-label="Search frames" oninput=${() => this.#search()} />`;
    this.#resetElement = html`<button type="button" class="d-button" disabled onclick=${() => this.#zoom(this.#tree)}>Reset zoom</button>`;
    this.#statusElement = html`<span class="d-flame-graph__status"></span>`;
    this.#canvasElement = html`<canvas class="d-flame-graph__canvas" onmousemove=${(event: MouseEvent) => this.#hover(event)} onmouseleave=${() => this.#hover(undefined)} onclick=${(event: MouseEvent) => this.#click(event)}></canvas>`;
    this.#tooltipElement = html`<div class="d-flame-graph__tooltip" hidden></div>`;
    this.#sortElements = {
      self: html`<button type="button" class="d-flame-graph__sort" onclick=${() => this.#sort('self')}>Self</button>`,
      total: html`<button type="button" class="d-flame-graph__sort" onclick=${() => this.#sort('total')}>Total</button>`,
    };
    this.#rowContainer = html`<tbody></tbody>`;
    this.#rootElement = html`<div class="d-flame-graph">
      <div class="d-flame-graph__toolbar">${this.#searchElement}${this.#resetElement}${this.#statusElement}</div>
      <div class="d-flame-graph__graph" style=${{ 'max-height': `${height}px` }}>${this.#canvasElement}${this.#tooltipElement}</div>
      <div class="d-flame-graph__functions">
        <table class="d-flame-graph__table">
          <thead><tr><th>Function</th><th>${this.#sortElements.self}</th><th>${this.#sortElements.total}</th></tr></thead>
          ${this.#rowContainer}
        </table>
      </div>
    </div>`;
  }

  /** The flame graph of `result`, `width` px wide; the same element each time. */
  draw(result: QueryResult, width: number, colorSchemeDark: boolean): HTMLElement {
    if (result !== this.#result) this.#load(result);
    this.#width = width;
    this.#colorSchemeDark = colorSchemeDark;
    this.#layout();
    return this.#rootElement;
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
    this.#hovered = undefined;
    this.#drawFunctions();
  }

  #zoom(node: CallNode): void {
    this.#zoomed = node;
    this.#layout();
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

  /** Where each frame goes for the zoomed frame and the width, then draws them. */
  #layout(): void {
    const ancestors = pathOf(this.#zoomed).slice(0, -1);
    const boxes: FrameBox[] = ancestors.map((node, row) => ({ node, row, x: 0, width: this.#width, ancestor: true }));
    const place = (node: CallNode, row: number, x: number, width: number) => {
      boxes.push({ node, row, x, width, ancestor: false });
      let childX = x;
      for (const child of node.children) {
        const childWidth = node.value > 0 ? (width * child.value) / node.value : 0;
        if (childWidth >= MIN_FRAME_WIDTH) place(child, row + 1, childX, childWidth);
        childX += childWidth;
      }
    };
    if (this.#zoomed.value > 0) place(this.#zoomed, ancestors.length, 0, this.#width);
    this.#boxes = boxes;

    const rows = this.#zoomed.value > 0 ? ancestors.length + 1 + heightOf(this.#zoomed) : 0;
    const pixelRatio = this.#canvasElement.ownerDocument.defaultView?.devicePixelRatio ?? 1;
    this.#canvasElement.width = Math.round(this.#width * pixelRatio);
    this.#canvasElement.height = Math.round(rows * ROW_HEIGHT * pixelRatio);
    this.#canvasElement.style.width = `${this.#width}px`;
    this.#canvasElement.style.height = `${rows * ROW_HEIGHT}px`;
    this.#resetElement.disabled = this.#zoomed === this.#tree;
    this.#paint();
    this.#drawStatus();
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
      if (box.node === this.#hovered) {
        context.strokeStyle = token('--color-text');
        context.strokeRect(box.x + 0.5, y + 0.5, Math.max(box.width - 2, 0), ROW_HEIGHT - 2);
      }
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
    if (box?.node !== this.#hovered) {
      this.#hovered = box?.node;
      this.#paint();
    }
    if (!box || !event) {
      this.#tooltipElement.hidden = true;
      return;
    }
    const { node } = box;
    const total = this.#tree.value;
    this.#tooltipElement.replaceChildren(
      html`<div class="d-flame-graph__tooltip-name">${node.name}</div>`,
      html`<div>${countOf(node.value)} samples (${percentOf(node.value, total)}), self ${countOf(node.self)} (${percentOf(node.self, total)})</div>`,
    );
    this.#tooltipElement.hidden = false;
    const rect = this.#canvasElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    this.#tooltipElement.style.left = `${Math.max(0, Math.min(x + 12, this.#width - this.#tooltipElement.offsetWidth))}px`;
    this.#tooltipElement.style.top = `${(box.row + 1) * ROW_HEIGHT + 4}px`;
  }

  #click(event: MouseEvent): void {
    const box = this.#boxAt(event);
    if (box && box.node !== this.#zoomed) this.#zoom(box.node);
  }

  #boxAt(event: MouseEvent): FrameBox | undefined {
    const rect = this.#canvasElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const row = Math.floor((event.clientY - rect.top) / ROW_HEIGHT);
    return this.#boxes.find((box) => box.row === row && x >= box.x && x < box.x + box.width);
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
