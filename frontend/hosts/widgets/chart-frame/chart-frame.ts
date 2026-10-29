// See WidgetsApi in ../widgets.ts.
import { html } from 'htl';
import { EllipsisVertical, createElement } from 'lucide';
import { Disposable } from '../../../core/disposable/disposable';
import type { QueryResult, ViewOptions, WidgetContext } from '../widgets';
import './chart-frame.css';

export interface ChartFrameOptions {
  /** Shown until the chart is drawn, which brings its own title. */
  readonly title?: string;
  /** The chart's height in pixels, kept while it loads. */
  readonly height?: number;
  /** The chart for the queried data (an SVG, a table); asked again when the width, the color scheme or the view options change. */
  draw(result: QueryResult, options: DrawOptions): Element | Promise<Element>;
}

export interface DrawOptions {
  /** The frame's width in pixels. */
  readonly width: number;
  readonly colorSchemeDark: boolean;
  readonly viewOptions: ViewOptions;
}

/**
 * Puts a chart into `el` inside the frame every chart has: its title while it loads, a spinner while it queries, the
 * error of a failed query, and its menu button (`widget/context`). It queries once the chart scrolls into view, and
 * again on each `onDidRequestRefresh` from then on; an answer to an older query is dropped.
 */
export function chartFrame(el: HTMLElement, ctx: WidgetContext, options: ChartFrameOptions): Disposable {
  const doc = el.ownerDocument;
  const browserWindow = doc.defaultView!;
  const menuIcon = createElement(EllipsisVertical);
  menuIcon.classList.add('w-4', 'h-4');
  const spinner: HTMLElement = html`<div class="dashica-chart__spinner" title="Refreshing…" hidden><span class="loading loading-spinner loading-xs opacity-70"></span></div>`;
  const shimmer: HTMLElement = html`<div class="chart-shimmer absolute inset-0 rounded pointer-events-none"></div>`;
  const body: HTMLElement = html`<div class="dashica-chart__body" style=${options.height ? { 'min-height': `${options.height}px` } : {}}></div>`;
  const frame: HTMLElement = html`<div class="dashica-chart not-prose relative group">
    ${spinner}
    <div class="dashica-chart__menu">
      <button type="button" class="btn btn-sm btn-circle" title="More" aria-label="More" aria-haspopup="menu" onclick=${(event: MouseEvent) => ctx.showMenu(event.currentTarget as HTMLElement)}>${menuIcon}</button>
    </div>
    <div class="relative">${shimmer}${body}</div>
  </div>`;
  if (options.title) body.append(html`<h2 class="dashica-chart__title">${options.title}</h2>`);
  el.replaceChildren(frame);

  const darkScheme = browserWindow.matchMedia('(prefers-color-scheme: dark)');
  let visible = false;
  let width = 0;
  let result: QueryResult | undefined;
  let running: AbortController | undefined;
  let drawn = 0;

  const showError = (error: unknown) => {
    const shown = doc.createElement('div');
    shown.className = 'dashica-widget-error';
    shown.textContent = error instanceof Error ? error.message : String(error);
    body.replaceChildren(shown);
    shimmer.hidden = true;
  };

  const draw = async () => {
    if (!result) return;
    const turn = ++drawn;
    const viewOptions: ViewOptions = ctx.viewOptions.logScale ? ['VIEW_LOGARITHMIC'] : [];
    try {
      const chart = await options.draw(result, { width, colorSchemeDark: darkScheme.matches, viewOptions });
      if (turn !== drawn) return;
      body.replaceChildren(chart);
      shimmer.hidden = true;
    } catch (error) {
      if (turn === drawn) showError(error);
    }
  };

  const query = async () => {
    running?.abort();
    const controller = (running = new AbortController());
    spinner.hidden = false;
    try {
      result = await ctx.query(controller.signal);
      await draw();
    } catch (error) {
      if (!controller.signal.aborted) showError(error);
    } finally {
      if (running === controller) spinner.hidden = true;
    }
  };

  const intersection = new browserWindow.IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    intersection.disconnect();
    visible = true;
    void query();
  });
  intersection.observe(frame);

  const resize = new browserWindow.ResizeObserver((entries) => {
    const next = Math.round(entries[entries.length - 1].contentRect.width);
    if (next === width) return;
    width = next;
    void draw();
  });
  resize.observe(frame);

  const onSchemeChange = () => void draw();
  darkScheme.addEventListener('change', onSchemeChange);

  return Disposable.from(
    new Disposable(() => intersection.disconnect()),
    new Disposable(() => resize.disconnect()),
    new Disposable(() => darkScheme.removeEventListener('change', onSchemeChange)),
    ctx.onDidRequestRefresh(() => {
      if (visible) void query();
    }),
    ctx.viewOptions.onDidChange(() => void draw()),
    new Disposable(() => {
      running?.abort();
      drawn++;
    }),
  );
}
