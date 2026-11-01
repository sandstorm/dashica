import { html } from 'htl';
import { EllipsisVertical, createElement } from 'lucide';
import type { Disposable } from '../../core/disposable/disposable';
import type { QueryResult, WidgetContext, WidgetDecoration } from '../../hosts/widgets/widgets';
import { formatTime } from '../time-library/format-time';
import { TIME, customRange } from '../time-library/time-state';
import './chart-frame.css';

/**
 * A chart in `widgetContainer` inside the frame every chart has: its title while it loads, a spinner while it queries,
 * the error of a failed query, its menu button (`widget/context`), and the widget's decorations (`ctx.decorations`,
 * whatever extension made them): a badge each in its title row with its tooltip, the chart drawn muted
 * (`d-chart-frame--muted`) while one of them says so, until the pointer, the focus or being the active widget brings it
 * back. An answer without a table (a 204) draws nothing; its decorations say why. It queries once the chart scrolls
 * into view, and again on each `onDidRequestRefresh` from then on; an answer to an older query is dropped. A chart's
 * renderer returns it.
 */
export class ChartFrame {
  readonly #ctx: WidgetContext;
  readonly #options: ChartFrameOptions;
  readonly #frameElement: HTMLElement;
  readonly #spinnerElement: HTMLElement;
  readonly #shimmerElement: HTMLElement;
  readonly #bodyContainer: HTMLElement;
  readonly #titleElement: HTMLElement;
  readonly #badgeContainer: HTMLElement;
  readonly #darkScheme: MediaQueryList;
  readonly #intersection: IntersectionObserver;
  readonly #resize: ResizeObserver;
  readonly #onDidRequestRefresh: Disposable;
  readonly #onDidChangeDecorations: Disposable;
  #visible = false;
  #width = 0;
  #result: QueryResult | undefined;
  #running: AbortController | undefined;
  /** Counts the draws; a draw that finishes after a later one began is dropped. */
  #drawn = 0;

  constructor(widgetContainer: HTMLElement, ctx: WidgetContext, options: ChartFrameOptions) {
    this.#ctx = ctx;
    this.#options = options;
    const browserWindow = widgetContainer.ownerDocument.defaultView!;
    // its three dots thicker than lucide's: at 16px they are ~2.7px wide and barely show on the dark raised surface
    const menuIconElement = createElement(EllipsisVertical, { width: 16, height: 16, 'stroke-width': 3 });
    this.#spinnerElement = html`<div class="d-chart-frame__spinner" title="Refreshing…" hidden><span class="d-spinner"></span></div>`;
    this.#shimmerElement = html`<div class="d-chart-frame__shimmer"></div>`;
    this.#bodyContainer = html`<div class="d-chart-frame__body" style=${options.height ? { 'min-height': `${options.height}px` } : {}}></div>`;
    this.#badgeContainer = html`<span class="d-chart-frame__decorations"></span>`;
    const frameElement: HTMLElement = (this.#frameElement = html`<div class="d-chart-frame">
      ${this.#spinnerElement}
      <div class="d-chart-frame__menu">
        <button type="button" class="d-button d-button--icon" title="More" aria-label="More" aria-haspopup="dialog" onclick=${(event: MouseEvent) => ctx.showMenu('widget/context', event.currentTarget as HTMLElement)}>${menuIconElement}</button>
      </div>
      ${(this.#titleElement = html`<h2 class="d-chart-frame__title" hidden=${!options.title}>${options.title ?? ''}${this.#badgeContainer}</h2>`)}
      <div class="d-chart-frame__stage">${this.#shimmerElement}${this.#bodyContainer}</div>
    </div>`);
    widgetContainer.replaceChildren(frameElement);

    this.#darkScheme = browserWindow.matchMedia('(prefers-color-scheme: dark)');
    this.#darkScheme.addEventListener('change', this.#onSchemeChange);
    this.#intersection = new browserWindow.IntersectionObserver(this.#onIntersection);
    this.#intersection.observe(frameElement);
    this.#resize = new browserWindow.ResizeObserver(this.#onResize);
    this.#resize.observe(frameElement);
    this.#onDidRequestRefresh = ctx.query.onDidRequestRefresh(() => {
      if (this.#visible) void this.#query();
    });
    this.#onDidChangeDecorations = ctx.onDidChangeDecorations(() => this.#drawDecorations(ctx.decorations));
    this.#drawDecorations(ctx.decorations);
  }

  dispose(): void {
    this.#intersection.disconnect();
    this.#resize.disconnect();
    this.#darkScheme.removeEventListener('change', this.#onSchemeChange);
    this.#onDidRequestRefresh.dispose();
    this.#onDidChangeDecorations.dispose();
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
    // a chart in a tab in the background measures 0; it keeps what it drew until the tab is shown
    if (width === 0 || width === this.#width) return;
    this.#width = width;
    void this.#draw();
  };

  readonly #onSchemeChange = () => void this.#draw();

  readonly #onTimeSelect = (from: Date, to: Date) => this.#ctx.query.set(TIME, customRange(formatTime(from), formatTime(to)));

  async #query(): Promise<void> {
    this.#running?.abort();
    const controller = (this.#running = new AbortController());
    this.#spinnerElement.hidden = false;
    try {
      this.#result = await this.#ctx.runQuery(controller.signal);
      await this.#draw();
    } catch (error) {
      if (controller.signal.aborted) return;
      this.#drawError(error);
    } finally {
      if (this.#running === controller) this.#spinnerElement.hidden = true;
    }
  }

  async #draw(): Promise<void> {
    if (!this.#result) return;
    const turn = ++this.#drawn;
    if (this.#result.numCols === 0) {
      this.#bodyContainer.replaceChildren();
      this.#shimmerElement.hidden = true;
      return;
    }
    try {
      const chartElement = await this.#options.draw(this.#result, {
        width: this.#width,
        colorSchemeDark: this.#darkScheme.matches,
        onTimeSelect: this.#onTimeSelect,
      });
      if (turn !== this.#drawn) return;
      if (this.#bodyContainer.firstElementChild !== chartElement) this.#bodyContainer.replaceChildren(chartElement);
      this.#shimmerElement.hidden = true;
    } catch (error) {
      if (turn === this.#drawn) this.#drawError(error);
    }
  }

  #drawDecorations(decorations: readonly WidgetDecoration[]): void {
    this.#badgeContainer.replaceChildren(
      ...decorations.map(({ badge, tooltip }) => html`<span class="d-badge d-chart-frame__decoration" data-testid="chart-decoration" title=${tooltip ?? null}>${badge}</span>`),
    );
    this.#frameElement.classList.toggle('d-chart-frame--muted', decorations.some(({ muted }) => muted));
    // a chart without a title has its row only for the badges
    this.#titleElement.hidden = !this.#options.title && decorations.length === 0;
  }

  #drawError(error: unknown): void {
    this.#drawMessage('d-widget-error', error instanceof Error ? error.message : String(error));
  }

  #drawMessage(className: string, message: string): void {
    const noticeElement = this.#bodyContainer.ownerDocument.createElement('div');
    noticeElement.className = className;
    noticeElement.textContent = message;
    this.#bodyContainer.replaceChildren(noticeElement);
    this.#shimmerElement.hidden = true;
  }
}

export interface ChartFrameOptions {
  /** The chart's title, above it; the frame draws it, the chart draws none. */
  readonly title?: string;
  /** The chart's height in pixels, kept while it loads. */
  readonly height?: number;
  /**
   * The chart for the queried data (an SVG, a table); asked again when the width or the color scheme change. The
   * element it drew last, returned again, stays as it is (its scroll position, what is ticked in it).
   */
  draw(result: QueryResult, options: DrawOptions): Element | Promise<Element>;
}

export interface DrawOptions {
  /** The frame's width in pixels. */
  readonly width: number;
  readonly colorSchemeDark: boolean;
  /** Sets the page's time range to the range the viewer dragged across a time chart. */
  readonly onTimeSelect: (from: Date, to: Date) => void;
}
