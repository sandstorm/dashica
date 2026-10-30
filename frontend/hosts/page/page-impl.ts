// See PageApi in page.ts.
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { PageJson, WorkbenchJson } from '../../generated/zz_generated.dashica';
import type { QueryHost } from '../query/query';
import type { PageApi, PageRenderer } from './page';

/** The workbench's `PageApi` in `browserWindow`, rendering into `content`. `start` shows the page of the URL. */
export class PageHost implements PageApi {
  current: PageJson | undefined;
  readonly #onDidChangePage = new EventEmitter<PageJson>();
  readonly onDidChangePage = this.#onDidChangePage.event;
  readonly #renderers = new Map<string, PageRenderer>();
  /** The path of the page shown (`/p/shop`). */
  #path: string | undefined;
  #rendered: { dispose(): unknown } | undefined;
  /** Aborts the loading of the page asked for before. */
  #loading: AbortController | undefined;
  readonly #listeners: Disposable;

  constructor(
    private readonly browserWindow: Window,
    readonly workbench: WorkbenchJson,
    private readonly query: QueryHost,
    private readonly content: HTMLElement,
  ) {
    const onPopState = () => void this.#open(this.browserWindow.location.href, 'history');
    const onClick = (event: MouseEvent) => this.#followLink(event);
    browserWindow.addEventListener('popstate', onPopState);
    browserWindow.document.addEventListener('click', onClick);
    this.#listeners = new Disposable(() => {
      browserWindow.removeEventListener('popstate', onPopState);
      browserWindow.document.removeEventListener('click', onClick);
    });
  }

  /** Shows the page of the browser's URL. */
  start(): Promise<void> {
    return this.#open(this.browserWindow.location.href, 'start');
  }

  navigate(url: string): Promise<void> {
    return this.#open(url, 'navigate');
  }

  registerPageRenderer(kind: string, renderer: PageRenderer): Disposable {
    if (this.#renderers.has(kind)) throw new Error(`There is a renderer for the page kind ${kind} already`);
    this.#renderers.set(kind, renderer);
    return new Disposable(() => this.#renderers.delete(kind));
  }

  dispose(): void {
    this.#loading?.abort();
    this.#listeners.dispose();
    this.#unrender();
    this.#onDidChangePage.dispose();
  }

  /**
   * Shows the page at `url`. `navigate`: as a new history entry, or by the browser when it has no `page.json`;
   * `history`: the browser's back or forward went there, the URL is set already, and on the same page only its query
   * state changed; `start`: the first page.
   */
  async #open(url: string, how: 'navigate' | 'history' | 'start'): Promise<void> {
    const target = new URL(url, this.browserWindow.location.href);
    if (how === 'history' && target.pathname === this.#path && this.current) {
      this.query.load({ defaultTime: this.current.defaultTime });
      return;
    }
    this.#loading?.abort();
    const loading = new AbortController();
    this.#loading = loading;
    let page: PageJson;
    try {
      const response = await fetch(`${target.pathname.replace(/\/$/, '')}/page.json`, { signal: loading.signal });
      if (response.status === 404 && how === 'navigate') {
        this.browserWindow.location.assign(target.href);
        return;
      }
      if (!response.ok) throw new Error(`${target.pathname}: ${response.status} ${await response.text()}`);
      page = await response.json();
    } catch (error) {
      if (loading.signal.aborted) return;
      if (how === 'navigate') this.#pushState(target);
      this.#showError(target.pathname, error);
      return;
    }
    if (loading.signal.aborted) return;
    if (how === 'navigate') this.#pushState(target);
    this.#show(target.pathname, page);
  }

  #pushState(target: URL): void {
    this.browserWindow.history.pushState(null, '', target.pathname + target.search + target.hash);
  }

  /** Takes down the page shown, then renders `page` with the query state of the URL. */
  #show(path: string, page: PageJson): void {
    this.#unrender();
    this.#path = path;
    this.current = page;
    this.browserWindow.document.title = page.title ? `${page.title} · Dashica` : 'Dashica';
    this.query.load({ defaultTime: page.defaultTime });
    const renderer = this.#renderers.get(page.kind);
    if (!renderer) {
      this.#showError(path, new Error(`no renderer for the page kind ${page.kind}`));
      return;
    }
    const el = this.content.appendChild(this.browserWindow.document.createElement('div'));
    try {
      this.#rendered = renderer(el, page);
    } catch (error) {
      this.#showError(path, error);
      return;
    }
    this.#onDidChangePage.fire(page);
  }

  #showError(path: string, error: unknown): void {
    this.#unrender();
    this.#path = path;
    this.current = undefined;
    const shown = this.browserWindow.document.createElement('div');
    shown.className = 'd-notice d-notice--error';
    shown.textContent = error instanceof Error ? error.message : String(error);
    this.content.replaceChildren(shown);
  }

  #unrender(): void {
    this.#rendered?.dispose();
    this.#rendered = undefined;
    this.content.replaceChildren();
  }

  /**
   * Opens a link to another page of this Dashica in the content area: a plain click on a link of the same origin to
   * another path or query. A new tab (a modifier key, `target`), a download or a jump on the same page stay the
   * browser's.
   */
  #followLink(event: MouseEvent): void {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element | null)?.closest?.('a[href]');
    if (!(link instanceof HTMLAnchorElement) || (link.target && link.target !== '_self') || link.hasAttribute('download')) return;
    const target = new URL(link.href);
    const location = this.browserWindow.location;
    if (target.origin !== location.origin) return;
    if (target.pathname === location.pathname && target.search === location.search) return;
    event.preventDefault();
    void this.navigate(target.href);
  }
}
