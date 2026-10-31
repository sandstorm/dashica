// See PageApi in ../../page/page.ts.

/**
 * The tab bar in the top bar: a tab per open page (a dashboard, a chart's Explore view), the shown one selected, each
 * with × to close it while there are several, then "+" for a new tab. Choosing another tab asks for it
 * (`onDidChoose`); its × or a middle click on it asks to close it (`onDidClose`); "+" asks for a new one (`onDidAdd`).
 * The bar shows with a single tab too.
 */
export class TabBar {
  readonly #tabs: HTMLElement;
  readonly #add: HTMLButtonElement;

  /** Appends the bar's tab list to `container` (the workbench's tab bar region). */
  constructor(container: HTMLElement, options: TabBarOptions) {
    const doc = container.ownerDocument;
    this.#tabs = doc.createElement('div');
    this.#tabs.className = 'd-workbench__tab-list';
    this.#tabs.setAttribute('role', 'tablist');
    this.#tabs.setAttribute('aria-label', 'Open pages');
    this.#add = doc.createElement('button');
    this.#add.type = 'button';
    this.#add.className = 'd-workbench__tab-add';
    this.#add.setAttribute('aria-label', 'New tab');
    this.#add.title = 'New tab';
    this.#add.dataset.testid = 'wb-tab-add';
    this.#add.textContent = '+';
    this.#add.addEventListener('click', () => options.onDidAdd());
    container.append(this.#tabs, this.#add);
    this.#tabs.addEventListener('click', (event) => {
      const close = (event.target as HTMLElement).closest<HTMLElement>('[data-close]');
      if (close?.dataset.close) {
        options.onDidClose(close.dataset.close);
        return;
      }
      const tab = (event.target as HTMLElement).closest<HTMLElement>('[role=tab]');
      if (tab?.dataset.tabId && tab.getAttribute('aria-selected') !== 'true') options.onDidChoose(tab.dataset.tabId);
    });
    // a middle click closes the tab
    this.#tabs.addEventListener('auxclick', (event) => {
      const tab = (event.target as HTMLElement).closest<HTMLElement>('[data-tab-id]');
      if (event.button === 1 && tab?.dataset.tabId && this.#tabs.querySelectorAll('[role=tab]').length > 1) {
        event.preventDefault();
        options.onDidClose(tab.dataset.tabId);
      }
    });
    // keeps a middle press from starting to scroll
    this.#tabs.addEventListener('mousedown', (event) => {
      if (event.button === 1) event.preventDefault();
    });
  }

  /** Shows a tab per entry of `tabs`, `shown` selected; × only while there are several. */
  update(tabs: readonly TabBarTab[], shown: string): void {
    const doc = this.#tabs.ownerDocument;
    this.#tabs.replaceChildren(
      ...tabs.map(({ id, title }) => {
        const item = doc.createElement('div');
        item.className = id === shown ? 'd-workbench__tab d-workbench__tab--active' : 'd-workbench__tab';
        item.dataset.tabId = id;
        const tab = doc.createElement('button');
        tab.type = 'button';
        tab.className = 'd-workbench__tab-title';
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(id === shown));
        tab.dataset.tabId = id;
        tab.dataset.testid = 'wb-tab';
        tab.title = title;
        tab.textContent = title;
        item.append(tab);
        if (tabs.length > 1) {
          const close = doc.createElement('button');
          close.type = 'button';
          close.className = 'd-workbench__tab-close';
          close.setAttribute('aria-label', `Close ${title}`);
          close.title = 'Close';
          close.dataset.close = id;
          close.textContent = '×';
          item.append(close);
        }
        return item;
      }),
    );
  }

  dispose(): void {
    this.#tabs.remove();
    this.#add.remove();
  }
}

export interface TabBarOptions {
  /** The viewer chose another tab (its id). */
  onDidChoose(id: string): void;
  /** The viewer closed a tab (its id): its ×, a middle click. */
  onDidClose(id: string): void;
  /** The viewer asked for a new tab ("+"). */
  onDidAdd(): void;
}

/** A tab of the bar: an open page. */
export interface TabBarTab {
  readonly id: string;
  readonly title: string;
}
