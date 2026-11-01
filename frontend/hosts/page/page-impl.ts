// See PageApi in page.ts.
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { PageJson, WorkbenchJson } from '../../generated/zz_generated.dashica';
import type { Memento } from '../extension-host/extension-host';
import { QueryHost, QueryKeys } from '../query/query';
import type { PageApi, PageContext, PageRenderer, PoppedView } from './page';
import { closeTab, openTab, restoreTabs, showTab, storedTabs, titleOf, updateTab, type Tab, type TabList } from './tabs';

/**
 * The workbench's `PageApi` in `browserWindow`, a tab's page in an element of its own in `contentContainer` (`hidden`
 * while the tab is in the background). The open tabs come back from `state` (sessionStorage, key `tabs`) after a
 * reload; those in the background stay unloaded until shown. `start` loads the active tab's page. A popped-out view is
 * the page kind `view` (`#view=<tab id>`), which only names a kind while its view is in memory.
 */
export class PageHost implements PageApi {
  readonly #onDidChangePage = new EventEmitter<PageJson | undefined>();
  readonly onDidChangePage = this.#onDidChangePage.event;
  readonly #onDidChangeTabs = new EventEmitter<void>();
  readonly onDidChangeTabs = this.#onDidChangeTabs.event;
  readonly #renderers = new Map<string, PageRenderer>();
  /** The views popped out (`popOut`), by the id of their tab. */
  readonly #popped = new Map<string, PoppedView>();
  #list: TabList;
  /** What each open tab shows, by its id. */
  readonly #open = new Map<string, OpenTab>();
  readonly #listeners: Disposable;
  /** The query keys used so far, the same in every tab. */
  readonly #keys = new QueryKeys();

  constructor(
    private readonly browserWindow: Window,
    readonly workbench: WorkbenchJson,
    private readonly contentContainer: HTMLElement,
    private readonly state: Memento,
  ) {
    this.#renderers.set(POPPED, (pageContainer, _page, context) => {
      const view = this.#popped.get(new URLSearchParams(context.hash.slice(1)).get(POPPED)!)!;
      const rendered = view.render(pageContainer);
      return { dispose: () => rendered.dispose(), title: view.title };
    });
    const { history } = browserWindow;
    this.#list = restoreTabs(state.get<unknown>('tabs'), this.#addressBar(), entryTab(history.state), newTabId());
    for (const tab of this.#list.tabs) this.#open.set(tab.id, this.#createTab(tab.id));
    // the entry shown names the active tab
    this.#writeAddressBar('replace');
    this.#save();
    const onPopState = (event: PopStateEvent) => this.#followHistory(event.state);
    const onClick = (event: MouseEvent) => this.#followLink(event);
    browserWindow.addEventListener('popstate', onPopState);
    browserWindow.document.addEventListener('click', onClick);
    this.#listeners = new Disposable(() => {
      browserWindow.removeEventListener('popstate', onPopState);
      browserWindow.document.removeEventListener('click', onClick);
    });
  }

  get tabs(): readonly Tab[] {
    return this.#list.tabs;
  }

  get activeTab(): Tab {
    return this.#tab(this.#list.active);
  }

  get current(): PageJson | undefined {
    return this.#active().page;
  }

  /** The active tab shows a view popped out (`popOut`): it shows what its view was given, whatever its query state. */
  get showsPoppedView(): boolean {
    return this.#popped.has(this.#list.active);
  }

  /** The active tab's query state (`activeQuery`). */
  get activeQuery(): QueryHost {
    return this.#active().query;
  }

  /** Loads the active tab's page. */
  start(): Promise<void> {
    return this.#load(this.#active(), this.activeTab.url);
  }

  async navigate(url: string, options: { readonly newTab?: boolean } = {}): Promise<void> {
    const target = new URL(url, this.browserWindow.location.href);
    if (options.newTab) {
      const href = relative(target);
      const opened = openTab(this.#list, { id: newTabId(), url: href, title: titleOf(href) });
      const isNew = !this.#open.has(opened.active);
      this.#change(opened, isNew ? 'push' : 'replace');
      return this.#active().loading?.promise;
    }
    const open = this.#active();
    const shown = new URL(this.activeTab.url, target);
    open.loading?.abort.abort();
    const samePage = target.pathname === shown.pathname && (target.search === '' || target.search === shown.search);
    if (samePage && open.page && target.hash) {
      const jumped = shown.pathname + shown.search + target.hash;
      if (jumped !== this.activeTab.url) this.#setUrl(open, jumped, 'push');
      this.#hashChanged(open);
      return;
    }
    return this.#load(open, relative(target), 'navigate');
  }

  popOut(view: PoppedView): Promise<void> {
    const source = this.#active();
    const shown = new URL(this.activeTab.url, 'http://dashica');
    const id = newTabId();
    this.#popped.set(id, view);
    // the page shown already: the new tab takes its `page.json`
    const open = this.#createTab(id);
    open.loaded = source.page !== undefined;
    this.#open.set(id, open);
    this.#change(openTab(this.#list, { id, url: `${shown.pathname}${shown.search}#${POPPED}=${id}`, title: view.title }), 'push');
    if (source.page) this.#show(open, shown, source.page);
    return open.loading?.promise ?? Promise.resolve();
  }

  showTab(id: string): void {
    this.#change(showTab(this.#list, id), 'replace');
  }

  closeTab(id: string): void {
    this.#change(closeTab(this.#list, id), 'replace');
  }

  registerPageRenderer(kind: string, renderer: PageRenderer): Disposable {
    if (this.#renderers.has(kind)) throw new Error(`There is a renderer for the page kind ${kind} already`);
    this.#renderers.set(kind, renderer);
    return new Disposable(() => this.#renderers.delete(kind));
  }

  dispose(): void {
    this.#listeners.dispose();
    for (const open of this.#open.values()) this.#disposeTab(open);
    this.#open.clear();
    this.#onDidChangePage.dispose();
    this.#onDidChangeTabs.dispose();
  }

  #tab(id: string): Tab {
    return this.#list.tabs.find((tab) => tab.id === id)!;
  }

  #active(): OpenTab {
    return this.#open.get(this.#list.active)!;
  }

  /** The address bar's URL without the origin (`/p/shop?time=1h#w=3`). */
  #addressBar(): string {
    return relative(new URL(this.browserWindow.location.href));
  }

  #createTab(id: string): OpenTab {
    const tabContainer = this.contentContainer.appendChild(this.browserWindow.document.createElement('div'));
    tabContainer.className = 'd-workbench__tab-page';
    tabContainer.hidden = id !== this.#list.active;
    const query = new QueryHost(this.#keys);
    const hashChanged = new EventEmitter<void>();
    const context: PageContext = {
      query,
      get hash() {
        return hashOf(tabOf());
      },
      onDidChangeHash: hashChanged.event,
      close: () => this.closeTab(id),
    };
    const tabOf = () => this.#tab(id);
    const open: OpenTab = { id, tabContainer, query, context, hashChanged, listening: Disposable.from(), page: undefined, rendered: undefined, renderedAs: undefined, loading: undefined, loaded: false, scrollTop: 0 };
    open.listening = query.onDidChangeSearch((search) => {
      const shown = new URL(tabOf().url, 'http://dashica');
      this.#setUrl(open, shown.pathname + search + shown.hash, id === this.#list.active ? 'push' : 'none');
    });
    return open;
  }

  #disposeTab(open: OpenTab): void {
    this.#popped.delete(open.id);
    open.loading?.abort.abort();
    this.#unrender(open);
    open.listening.dispose();
    open.hashChanged.dispose();
    open.query.dispose();
    open.tabContainer.remove();
  }

  /**
   * Makes the tabs follow `list`: closed ones disposed, new ones created, the active one shown (loaded when it was not
   * yet) and the one before hidden; then the address bar shows the active tab's URL (`history`: as a new entry, in
   * place of the entry shown, or as it is already).
   */
  #change(list: TabList, history: 'push' | 'replace' | 'none'): void {
    const before = this.#list.active;
    this.#list = list;
    for (const [id, open] of this.#open) {
      if (list.tabs.some((tab) => tab.id === id)) continue;
      this.#disposeTab(open);
      this.#open.delete(id);
    }
    for (const tab of list.tabs) if (!this.#open.has(tab.id)) this.#open.set(tab.id, this.#createTab(tab.id));
    const switched = before !== list.active;
    const hidden = this.#open.get(before);
    if (switched && hidden) {
      hidden.scrollTop = hidden.tabContainer.scrollTop;
      hidden.tabContainer.hidden = true;
    }
    const shown = this.#active();
    if (switched) {
      shown.tabContainer.hidden = false;
      shown.tabContainer.scrollTop = shown.scrollTop;
    }
    this.#writeAddressBar(history);
    this.#save();
    this.#onDidChangeTabs.fire();
    if (!switched) return;
    if (!shown.loaded) void this.#load(shown, this.activeTab.url);
    this.#onDidChangePage.fire(shown.page);
  }

  /** The tab `open` shows `url` now; for the active one the address bar too (`history`). */
  #setUrl(open: OpenTab, url: string, history: 'push' | 'replace' | 'none'): void {
    this.#list = updateTab(this.#list, open.id, { url });
    if (open.id === this.#list.active) this.#writeAddressBar(history);
    this.#save();
    this.#onDidChangeTabs.fire();
  }

  #setTitle(open: OpenTab, title: string): void {
    if (this.#tab(open.id).title !== title) {
      this.#list = updateTab(this.#list, open.id, { title });
      this.#save();
      this.#onDidChangeTabs.fire();
    }
    if (open.id === this.#list.active) this.#writeAddressBar('none');
  }

  /** The address bar and the document's title as the active tab says; each history entry names its tab (`{ tab }`). */
  #writeAddressBar(how: 'push' | 'replace' | 'none'): void {
    const { history, document } = this.browserWindow;
    const tab = this.activeTab;
    if (how === 'push') history.pushState({ tab: tab.id }, '', tab.url);
    else if (how === 'replace') history.replaceState({ tab: tab.id }, '', tab.url);
    const page = this.#active().page;
    document.title = page ? `${tab.title} · Dashica` : 'Dashica';
  }

  #save(): void {
    void this.state.update('tabs', storedTabs(this.#list, (tab) => !this.#popped.has(tab.id)));
  }

  /**
   * The browser's back or forward, or a link to a hash it followed, went to the entry `state`: its tab is shown (opened
   * again with its id when it was closed; an entry without a tab is the active tab's) and takes the address bar's URL.
   * Only its hash changed: the renderer is told; its query: the query state is loaded; else the page loads.
   */
  #followHistory(state: unknown): void {
    const url = this.#addressBar();
    const id = entryTab(state) ?? this.#list.active;
    const open = this.#open.get(id);
    if (!open) {
      this.#change(openTab(this.#list, { id, url, title: titleOf(url) }), 'replace');
      return;
    }
    const before = new URL(this.#tab(id).url, 'http://dashica');
    const wasLoaded = open.loaded;
    this.#list = updateTab(this.#list, id, { url });
    // replaced: an entry the browser made gets the tab's id; a tab not loaded yet loads `url` as it is shown
    this.#change(showTab(this.#list, id), 'replace');
    if (!wasLoaded || relative(before) === url) return;
    open.loading?.abort.abort();
    const after = new URL(url, 'http://dashica');
    if (after.pathname === before.pathname && open.page) {
      if (after.search !== before.search) open.query.load({ search: after.search, page: open.page });
      if (after.hash !== before.hash) this.#hashChanged(open);
      return;
    }
    void this.#load(open, url, 'history');
  }

  /**
   * Loads the page at `url` into the tab `open` and shows it. `navigate`: as a new history entry, or by the browser
   * when it has no `page.json`; `history`: the address bar is there already; else (a tab shown first) the tab has
   * `url` already.
   */
  #load(open: OpenTab, url: string, how?: 'navigate' | 'history'): Promise<void> {
    open.loading?.abort.abort();
    open.loaded = true;
    const abort = new AbortController();
    const target = new URL(url, 'http://dashica');
    const promise = (async () => {
      let page: PageJson;
      try {
        const response = await fetch(`${target.pathname.replace(/\/$/, '')}/page.json`, { signal: abort.signal });
        // the browser leaves the workbench for it only while the tab is the one shown
        if (response.status === 404 && how === 'navigate' && open.id === this.#list.active) {
          this.browserWindow.location.assign(url);
          return;
        }
        if (!response.ok) throw new Error(`${target.pathname}: ${response.status} ${await response.text()}`);
        page = await response.json();
      } catch (error) {
        if (abort.signal.aborted) return;
        this.#arrive(open, url, how);
        this.#showError(open, error);
        return;
      }
      if (abort.signal.aborted) return;
      this.#arrive(open, url, how);
      this.#show(open, target, page);
    })();
    open.loading = { abort, promise };
    return promise;
  }

  /** The tab `open` is at `url` now, after its page was fetched. */
  #arrive(open: OpenTab, url: string, how: 'navigate' | 'history' | undefined): void {
    open.loading = undefined;
    if (this.#tab(open.id).url !== url || how === 'navigate') this.#setUrl(open, url, how === 'navigate' ? 'push' : 'none');
  }

  /** Takes down the page the tab showed, then renders `page` with the query state of `target`. */
  #show(open: OpenTab, target: URL, page: PageJson): void {
    this.#unrender(open);
    open.page = page;
    open.query.load({ search: target.search, page });
    this.#render(open);
  }

  /** Renders the tab's page by the renderer of the kind its hash names (`#explore=3`), else of the page's kind. */
  #render(open: OpenTab): void {
    const page = open.page!;
    const named = this.#namedKind(open);
    const kind = named ? named[0] : page.kind;
    open.renderedAs = named ? `${named[0]}=${named[1]}` : page.kind;
    const renderer = this.#renderers.get(kind);
    if (!renderer) {
      this.#showError(open, new Error(`no renderer for the page kind ${kind}`));
      return;
    }
    const pageContainer = open.tabContainer.appendChild(this.browserWindow.document.createElement('div'));
    pageContainer.className = 'd-workbench__page';
    try {
      open.rendered = renderer(pageContainer, page, open.context);
    } catch (error) {
      this.#showError(open, error);
      return;
    }
    this.#setTitle(open, open.rendered.title || page.title || titleOf(this.#tab(open.id).url));
    if (open.id === this.#list.active) this.#onDidChangePage.fire(page);
  }

  /** Only the tab's hash changed: renders it anew when the hash names another kind (or another one of it), else tells the renderer. */
  #hashChanged(open: OpenTab): void {
    const page = open.page;
    if (!page) return;
    const named = this.#namedKind(open);
    if ((named ? `${named[0]}=${named[1]}` : page.kind) === open.renderedAs) {
      open.hashChanged.fire();
      return;
    }
    this.#unrender(open);
    open.page = page;
    this.#render(open);
  }

  /** The kind the tab's hash names, with its value (`['explore', '3']`): a registered one, `view` only while its view is in memory. */
  #namedKind(open: OpenTab): [string, string] | undefined {
    return [...new URLSearchParams(hashOf(this.#tab(open.id)).slice(1))].find(([key, value]) => this.#renderers.has(key) && (key !== POPPED || this.#popped.has(value)));
  }

  #showError(open: OpenTab, error: unknown): void {
    this.#unrender(open);
    const errorElement = this.browserWindow.document.createElement('div');
    errorElement.className = 'd-notice d-notice--error';
    errorElement.textContent = error instanceof Error ? error.message : String(error);
    open.tabContainer.replaceChildren(errorElement);
    this.#setTitle(open, titleOf(this.#tab(open.id).url));
    if (open.id === this.#list.active) this.#onDidChangePage.fire(undefined);
  }

  #unrender(open: OpenTab): void {
    open.rendered?.dispose();
    open.rendered = undefined;
    open.renderedAs = undefined;
    open.page = undefined;
    open.tabContainer.replaceChildren();
  }

  /**
   * Opens a link to another page of this Dashica in the active tab: a plain click on a link of the same origin to
   * another path or query. A new browser tab (a modifier key, `target`), a download or a jump on the same page stay the
   * browser's.
   */
  #followLink(event: MouseEvent): void {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const linkElement = (event.target as Element | null)?.closest?.('a[href]');
    if (!(linkElement instanceof HTMLAnchorElement) || (linkElement.target && linkElement.target !== '_self') || linkElement.hasAttribute('download')) return;
    const target = new URL(linkElement.href);
    const location = this.browserWindow.location;
    if (target.origin !== location.origin) return;
    if (target.pathname === location.pathname && target.search === location.search) return;
    event.preventDefault();
    void this.navigate(target.href);
  }
}

/** The page kind of a popped-out view, named in its tab's hash with the tab's id (`#view=<id>`). */
const POPPED = 'view';

/** What the page host keeps for one open tab. */
interface OpenTab {
  readonly id: string;
  /** Its element in the content region; `hidden` in the background. */
  readonly tabContainer: HTMLElement;
  readonly query: QueryHost;
  readonly context: PageContext;
  readonly hashChanged: EventEmitter<void>;
  listening: Disposable;
  /** The page rendered; `undefined` before and while it could not be shown. */
  page: PageJson | undefined;
  rendered: ReturnType<PageRenderer> | undefined;
  /** The kind it is rendered by, with the value its hash gave it (`explore=3`). */
  renderedAs: string | undefined;
  loading: { abort: AbortController; promise: Promise<void> } | undefined;
  /** Its page was asked for: a tab restored after a reload asks when it is shown first. */
  loaded: boolean;
  /** Where its element was scrolled when it went to the background (a hidden element forgets it). */
  scrollTop: number;
}

/** The tab a history entry names (`history.state.tab`); `undefined` for an entry the browser made. */
function entryTab(state: unknown): string | undefined {
  const tab = (state as { tab?: unknown } | null)?.tab;
  return typeof tab === 'string' ? tab : undefined;
}

function newTabId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** `url` without its origin (`/p/shop?time=1h#w=3`). */
function relative(url: URL): string {
  return url.pathname + url.search + url.hash;
}

function hashOf(tab: Tab): string {
  return new URL(tab.url, 'http://dashica').hash;
}
