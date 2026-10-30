// See WidgetsApi in ../widgets.ts.
import { html } from 'htl';
import { EllipsisVertical, createElement } from 'lucide';
import type { Disposable } from '../../../core/disposable/disposable';
import { formatTime } from '../../query/query';
import type { QueryResult, WidgetContext } from '../widgets';
import './chart-frame.css';

export interface ChartFrameOptions {
  /** Shown until the chart is drawn, which brings its own title. */
  readonly title?: string;
  /** The chart's height in pixels, kept while it loads. */
  readonly height?: number;
  /** The chart for the queried data (an SVG, a table); asked again when the width or the color scheme change. */
  draw(result: QueryResult, options: DrawOptions): Element | Promise<Element>;
}

export interface DrawOptions {
  /** The frame's width in pixels. */
  readonly width: number;
  readonly colorSchemeDark: boolean;
  /** Sets the page's time range to the range the viewer dragged across a time chart. */
  readonly onTimeSelect: (from: Date, to: Date) => void;
}

/**
 * A chart in `el` inside the frame every chart has: its title while it loads, a spinner while it queries, the error of
 * a failed query, and its menu button (`widget/context`). It queries once the chart scrolls into view, and again on
 * each `onDidRequestRefresh` from then on; an answer to an older query is dropped. A chart's renderer returns it.
 */
export class ChartFrame {
  readonly #ctx: WidgetContext;
  readonly #options: ChartFrameOptions;
  readonly #spinner: HTMLElement;
  readonly #shimmer: HTMLElement;
  readonly #body: HTMLElement;
  readonly #darkScheme: MediaQueryList;
  readonly #intersection: IntersectionObserver;
  readonly #resize: ResizeObserver;
  readonly #onDidRequestRefresh: Disposable;
  #visible = false;
  #width = 0;
  #result: QueryResult | undefined;
  #running: AbortController | undefined;
  /** Counts the draws; a draw that finishes after a later one began is dropped. */
  #drawn = 0;

  constructor(el: HTMLElement, ctx: WidgetContext, options: ChartFrameOptions) {
    this.#ctx = ctx;
    this.#options = options;
    const browserWindow = el.ownerDocument.defaultView!;
    const menuIcon = createElement(EllipsisVertical);
    menuIcon.classList.add('w-4', 'h-4');
    this.#spinner = html`<div class="dashica-chart__spinner" title="Refreshing…" hidden><span class="loading loading-spinner loading-xs opacity-70"></span></div>`;
    this.#shimmer = html`<div class="chart-shimmer absolute inset-0 rounded pointer-events-none"></div>`;
    this.#body = html`<div class="dashica-chart__body" style=${options.height ? { 'min-height': `${options.height}px` } : {}}></div>`;
    const frame: HTMLElement = html`<div class="dashica-chart not-prose relative group">
      ${this.#spinner}
      <div class="dashica-chart__menu">
        <button type="button" class="btn btn-sm btn-circle" title="More" aria-label="More" aria-haspopup="menu" onclick=${(event: MouseEvent) => ctx.showMenu(event.currentTarget as HTMLElement)}>${menuIcon}</button>
      </div>
      <div class="relative">${this.#shimmer}${this.#body}</div>
    </div>`;
    if (options.title) this.#body.append(html`<h2 class="dashica-chart__title">${options.title}</h2>`);
    el.replaceChildren(frame);

    this.#darkScheme = browserWindow.matchMedia('(prefers-color-scheme: dark)');
    this.#darkScheme.addEventListener('change', this.#onSchemeChange);
    this.#intersection = new browserWindow.IntersectionObserver(this.#onIntersection);
    this.#intersection.observe(frame);
    this.#resize = new browserWindow.ResizeObserver(this.#onResize);
    this.#resize.observe(frame);
    this.#onDidRequestRefresh = ctx.state.onDidRequestRefresh(() => {
      if (this.#visible) void this.#query();
    });
  }

  dispose(): void {
    this.#intersection.disconnect();
    this.#resize.disconnect();
    this.#darkScheme.removeEventListener('change', this.#onSchemeChange);
    this.#onDidRequestRefresh.dispose();
    this.#running?.abort();
    this.#drawn++;
  }

  readonly #onIntersection = (entries: IntersectionObserverEntry[]) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    this.#intersection.disconnect();
    this.#visible = true;
    void this.#query();
  };

  readonly #onResize = (entries: ResizeObserverEntry[]) => {
    const width = Math.round(entries[entries.length - 1].contentRect.width);
    if (width === this.#width) return;
    this.#width = width;
    void this.#draw();
  };

  readonly #onSchemeChange = () => void this.#draw();

  readonly #onTimeSelect = (from: Date, to: Date) => this.#ctx.state.time.setCustom(formatTime(from), formatTime(to));

  async #query(): Promise<void> {
    this.#running?.abort();
    const controller = (this.#running = new AbortController());
    this.#spinner.hidden = false;
    try {
      this.#result = await this.#ctx.query(controller.signal);
      await this.#draw();
    } catch (error) {
      if (!controller.signal.aborted) this.#showError(error);
    } finally {
      if (this.#running === controller) this.#spinner.hidden = true;
    }
  }

  async #draw(): Promise<void> {
    if (!this.#result) return;
    const turn = ++this.#drawn;
    try {
      const chart = await this.#options.draw(this.#result, {
        width: this.#width,
        colorSchemeDark: this.#darkScheme.matches,
        onTimeSelect: this.#onTimeSelect,
      });
      if (turn !== this.#drawn) return;
      this.#body.replaceChildren(chart);
      this.#shimmer.hidden = true;
    } catch (error) {
      if (turn === this.#drawn) this.#showError(error);
    }
  }

  #showError(error: unknown): void {
    const shown = this.#body.ownerDocument.createElement('div');
    shown.className = 'dashica-widget-error';
    shown.textContent = error instanceof Error ? error.message : String(error);
    this.#body.replaceChildren(shown);
    this.#shimmer.hidden = true;
  }
}
