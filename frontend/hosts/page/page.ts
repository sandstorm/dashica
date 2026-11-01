import type { Disposable } from '../../core/disposable/disposable';
import type { Event } from '../../core/event-emitter/event-emitter';
import type { PageJson, WorkbenchJson } from '../../generated/zz_generated.dashica';
import type { QueryApi } from '../query/query';
import type { Tab } from './tabs';

/**
 * The open tabs, each showing one page (`/p/shop`) as its `page.json` describes it, with its own URL and query state,
 * and the way to another page without loading the browser page again: `navigate`, a click on a link, the browser's
 * back and forward. The address bar shows the active tab's URL. A page opens with the time range it declares and is
 * rendered by the renderer of its `kind` (`dashboard`), or of a kind its hash names (`#explore=3`), which an extension
 * registers. A tab in the background keeps its page; its queries and auto refresh wait until it is shown.
 * `workbench` is what `/workbench.json` says about all pages (the dashboards menu). A side panel's view pops out into a
 * tab of its own (`popOut`), kept in memory only.
 */
export interface PageApi {
  readonly workbench: WorkbenchJson;
  /** The open tabs, in the tab bar's order; always at least one. */
  readonly tabs: readonly Tab[];
  /** The tab shown; its URL is the address bar's. */
  readonly activeTab: Tab;
  /** Fires when a tab was opened, closed, shown, retitled, or its URL changed. */
  readonly onDidChangeTabs: Event<void>;
  /** The active tab's page; `undefined` before it is loaded, and while it could not be loaded. */
  readonly current: PageJson | undefined;
  /**
   * Fires with `current` when it changed: the active tab shows another page (after it was rendered) or one that could
   * not be shown (`undefined`), or another tab became active (`undefined` while its page loads).
   */
  readonly onDidChangePage: Event<PageJson | undefined>;
  /**
   * Shows the page at `url` (`/p/shop?time=1h`) in the active tab as a new history entry; a URL without `page.json`
   * (`/public/…`) is loaded by the browser. A hash on the page shown (`/p/shop#w=3`) keeps the page and its query
   * state and tells its renderer (`PageContext.onDidChangeHash`). `newTab`: in a new tab after the active one, shown;
   * a tab with the same URL that is open already is shown instead. Resolves when it is shown.
   */
  navigate(url: string, options?: { readonly newTab?: boolean }): Promise<void>;
  /** Shows the tab `id` (the tab bar); its page loads when it is shown for the first time. */
  showTab(id: string): void;
  /** Closes the tab `id`, its page and its queries; the tab shown before it becomes active. The last tab stays. */
  closeTab(id: string): void;
  /**
   * Opens `view` in a new tab after the active one, shown: Debug or Details popped out of their panel, Speedscope. The
   * tab is the active tab's page with `#view=<tab id>` and keeps `view` in memory only: a reload or a link to it shows
   * the page.
   */
  popOut(view: PoppedView): Promise<void>;
  /** Renders the pages of `kind` until disposed; one renderer per kind. */
  registerPageRenderer(kind: string, renderer: PageRenderer): Disposable;
}

/**
 * A view in a tab of its own (`popOut`): what the tab says, and how it fills the tab's element; disposing the result
 * stops what it started (the tab closed). It keeps showing what it was given when popped out (the widget then
 * active).
 */
export interface PoppedView {
  readonly title: string;
  render(viewContainer: HTMLElement): Disposable;
}

/**
 * Fills `pageContainer` with `page` for one tab; disposing the result stops what it started. `pageContainer` is emptied
 * after. `title`: what the tab says instead of the page's title (`Explore: Requests`).
 */
export type PageRenderer = (pageContainer: HTMLElement, page: PageJson, context: PageContext) => { dispose(): unknown; readonly title?: string };

/** What a page renderer gets about its tab. */
export interface PageContext {
  /** The tab's query state: what its widgets render with (`widgets.render(widgetContainer, widget, context.query)`). */
  readonly query: QueryApi;
  /** The tab's hash (`#w=3`, `#explore=3`; '' for none), as it is now. */
  readonly hash: string;
  /** Fires when only this tab's hash changed (a link to a chart, back and forward). */
  readonly onDidChangeHash: Event<void>;
  close(): void;
}

export { PageHost } from './page-impl';
export type { Tab } from './tabs';
