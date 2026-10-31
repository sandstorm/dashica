// See ChartFrame in chart-frame.ts.
import { html } from 'htl';
import { EllipsisVertical, createElement } from 'lucide';
import type { Disposable } from '../../core/disposable/disposable';
import type { Diagnostics, QueryResult, WidgetContext } from '../../hosts/widgets/widgets';
import { formatTime } from '../time-library/format-time';
import { TIME, customRange } from '../time-library/time-state';
import './chart-frame.css';

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

/**
 * A chart in `el` inside the frame every chart has: its title while it loads, a spinner while it queries, the error of
 * a failed query, its menu button (`widget/context`), and what the server says the chart did with the page's filters:
 * "ignores host, path" in its title row, with the chart drawn muted (`d-chart-frame--muted`) until the pointer, the
 * focus or being the active widget brings it back, "skipped: …" in place of it. It queries once the chart scrolls into view, and again on
 * each `onDidRequestRefresh` from then on; an answer to an older query is dropped. A chart's renderer returns it.
 */
export class ChartFrame {
  readonly #ctx: WidgetContext;
  readonly #options: ChartFrameOptions;
  readonly #frame: HTMLElement;
  readonly #spinner: HTMLElement;
  readonly #shimmer: HTMLElement;
  readonly #body: HTMLElement;
  readonly #title: HTMLElement;
  readonly #ignored: HTMLElement;
  /** Why the chart did not run, from its last answer; '' while it ran. */
  #skipped = '';
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
    // its three dots thicker than lucide's: at 16px they are ~2.7px wide and barely show on the dark raised surface
    const menuIcon = createElement(EllipsisVertical, { width: 16, height: 16, 'stroke-width': 3 });
    this.#spinner = html`<div class="d-chart-frame__spinner" title="Refreshing…" hidden><span class="d-spinner"></span></div>`;
    this.#shimmer = html`<div class="d-chart-frame__shimmer"></div>`;
    this.#body = html`<div class="d-chart-frame__body" style=${options.height ? { 'min-height': `${options.height}px` } : {}}></div>`;
    this.#ignored = html`<span class="d-badge d-chart-frame__ignored" data-testid="chart-ignored-filters" title="Filters of the page this chart does not interpret" hidden></span>`;
    const frame: HTMLElement = (this.#frame = html`<div class="d-chart-frame">
      ${this.#spinner}
      <div class="d-chart-frame__menu">
        <button type="button" class="d-button d-button--icon" title="More" aria-label="More" aria-haspopup="dialog" onclick=${(event: MouseEvent) => ctx.showMenu('widget/context', event.currentTarget as HTMLElement)}>${menuIcon}</button>
      </div>
      ${(this.#title = html`<h2 class="d-chart-frame__title" hidden=${!options.title}>${options.title ?? ''}${this.#ignored}</h2>`)}
      <div class="d-chart-frame__stage">${this.#shimmer}${this.#body}</div>
    </div>`);
    el.replaceChildren(frame);

    this.#darkScheme = browserWindow.matchMedia('(prefers-color-scheme: dark)');
    this.#darkScheme.addEventListener('change', this.#onSchemeChange);
    this.#intersection = new browserWindow.IntersectionObserver(this.#onIntersection);
    this.#intersection.observe(frame);
    this.#resize = new browserWindow.ResizeObserver(this.#onResize);
    this.#resize.observe(frame);
    this.#onDidRequestRefresh = ctx.query.onDidRequestRefresh(() => {
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
    // a chart in a tab in the background measures 0; it keeps what it drew until the tab is shown
    if (width === 0 || width === this.#width) return;
    this.#width = width;
    void this.#draw();
  };

  readonly #onSchemeChange = () => void this.#draw();

  /** A range dragged across a time chart becomes its tab's time range. */
  readonly #onTimeSelect = (from: Date, to: Date) => this.#ctx.query.set(TIME, customRange(formatTime(from), formatTime(to)));

  async #query(): Promise<void> {
    this.#running?.abort();
    const controller = (this.#running = new AbortController());
    this.#spinner.hidden = false;
    try {
      this.#result = await this.#ctx.runQuery(controller.signal);
      this.#showDiagnostics(this.#result.dashicaDiagnostics ?? {});
      await this.#draw();
    } catch (error) {
      if (controller.signal.aborted) return;
      this.#showDiagnostics({});
      this.#showError(error);
    } finally {
      if (this.#running === controller) this.#spinner.hidden = true;
    }
  }

  async #draw(): Promise<void> {
    if (!this.#result) return;
    const turn = ++this.#drawn;
    if (this.#skipped) {
      this.#showMessage('d-chart-frame__skipped', `skipped: ${this.#skipped}`);
      return;
    }
    try {
      const chart = await this.#options.draw(this.#result, {
        width: this.#width,
        colorSchemeDark: this.#darkScheme.matches,
        onTimeSelect: this.#onTimeSelect,
      });
      if (turn !== this.#drawn) return;
      if (this.#body.firstElementChild !== chart) this.#body.replaceChildren(chart);
      this.#shimmer.hidden = true;
    } catch (error) {
      if (turn === this.#drawn) this.#showError(error);
    }
  }

  #showDiagnostics({ ignored = [], skipped = '' }: Diagnostics): void {
    this.#skipped = skipped;
    this.#ignored.hidden = ignored.length === 0 || skipped !== '';
    // part of the heading's text only while shown
    this.#ignored.textContent = this.#ignored.hidden ? '' : `ignores ${ignored.join(', ')}`;
    // what it draws holds only part of what the page filters
    this.#frame.classList.toggle('d-chart-frame--muted', !this.#ignored.hidden);
    // a chart without a title has its row only for the badge
    this.#title.hidden = !this.#options.title && this.#ignored.hidden;
  }

  #showError(error: unknown): void {
    this.#showMessage('d-widget-error', error instanceof Error ? error.message : String(error));
  }

  #showMessage(className: string, message: string): void {
    const shown = this.#body.ownerDocument.createElement('div');
    shown.className = className;
    shown.textContent = message;
    this.#body.replaceChildren(shown);
    this.#shimmer.hidden = true;
  }
}
