import type { Disposable } from '../../core/disposable/disposable';
import type { Event } from '../../core/event-emitter/event-emitter';
import type { PageJson, WorkbenchJson } from '../../generated/zz_generated.dashica';

/**
 * The page the content area shows (`/p/shop`), as its `page.json` describes it, and the way to another one without
 * loading the browser page again: `navigate`, a click on a link, the browser's back and forward. A page opens with
 * the time range it declares and is rendered by the renderer of its `kind` (`dashboard`), which an extension
 * registers. `workbench` is what `/workbench.json` says about all pages (the dashboards menu).
 */
export interface PageApi {
  readonly workbench: WorkbenchJson;
  /** The page shown; `undefined` before the first one, and while one could not be loaded. */
  readonly current: PageJson | undefined;
  /** Fires once a page is shown, after it was rendered. */
  readonly onDidChangePage: Event<PageJson>;
  /**
   * Shows the page at `url` (`/p/shop?time=1h`) as a new history entry; a URL without `page.json` (`/public/…`) is
   * loaded by the browser. Resolves when it is shown.
   */
  navigate(url: string): Promise<void>;
  /** Renders the pages of `kind` until disposed; one renderer per kind. */
  registerPageRenderer(kind: string, renderer: PageRenderer): Disposable;
}

/** Fills `el` with `page`; disposing the result stops what it started. `el` is emptied after. */
export type PageRenderer = (el: HTMLElement, page: PageJson) => { dispose(): unknown };

export { PageHost } from './page-impl';
