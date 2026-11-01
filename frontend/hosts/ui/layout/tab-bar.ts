// See PageApi in ../../page/page.ts.

/**
 * The tab bar in the top bar: a tab per open page (a dashboard, a chart's Explore view), the shown one selected, each
 * with × to close it while there are several, then "+" for a new tab. Choosing another tab asks for it
 * (`onDidChoose`); its × or a middle click on it asks to close it (`onDidClose`); "+" asks for a new one (`onDidAdd`).
 * The bar shows with a single tab too.
 */
export class TabBar {
  readonly #tabsContainer: HTMLElement;
  readonly #addButtonElement: HTMLButtonElement;

  /** Appends the bar's tab list to `tabBarContainer` (the workbench's tab bar region). */
  constructor(tabBarContainer: HTMLElement, options: TabBarOptions) {
    const doc = tabBarContainer.ownerDocument;
    this.#tabsContainer = doc.createElement('div');
    this.#tabsContainer.className = 'd-workbench__tab-list';
    this.#tabsContainer.setAttribute('role', 'tablist');
    this.#tabsContainer.setAttribute('aria-label', 'Open pages');
    this.#addButtonElement = doc.createElement('button');
    this.#addButtonElement.type = 'button';
    this.#addButtonElement.className = 'd-workbench__tab-add';
    this.#addButtonElement.setAttribute('aria-label', 'New tab');
    this.#addButtonElement.title = 'New tab';
    this.#addButtonElement.dataset.testid = 'wb-tab-add';
    this.#addButtonElement.textContent = '+';
    this.#addButtonElement.addEventListener('click', () => options.onDidAdd());
    tabBarContainer.append(this.#tabsContainer, this.#addButtonElement);
    this.#tabsContainer.addEventListener('click', (event) => {
      const closeButtonElement = (event.target as HTMLElement).closest<HTMLElement>('[data-close]');
      if (closeButtonElement?.dataset.close) {
        options.onDidClose(closeButtonElement.dataset.close);
        return;
      }
      const tabElement = (event.target as HTMLElement).closest<HTMLElement>('[role=tab]');
      if (tabElement?.dataset.tabId && tabElement.getAttribute('aria-selected') !== 'true') options.onDidChoose(tabElement.dataset.tabId);
    });
    // a middle click closes the tab
    this.#tabsContainer.addEventListener('auxclick', (event) => {
      const tabElement = (event.target as HTMLElement).closest<HTMLElement>('[data-tab-id]');
      if (event.button === 1 && tabElement?.dataset.tabId && this.#tabsContainer.querySelectorAll('[role=tab]').length > 1) {
        event.preventDefault();
        options.onDidClose(tabElement.dataset.tabId);
      }
    });
    // keeps a middle press from starting to scroll
    this.#tabsContainer.addEventListener('mousedown', (event) => {
      if (event.button === 1) event.preventDefault();
    });
  }

  /** Shows a tab per entry of `tabs`, `shown` selected; × only while there are several. */
  update(tabs: readonly TabBarTab[], shown: string): void {
    const doc = this.#tabsContainer.ownerDocument;
    this.#tabsContainer.replaceChildren(
      ...tabs.map(({ id, title }) => {
        const itemContainer = doc.createElement('div');
        itemContainer.className = id === shown ? 'd-workbench__tab d-workbench__tab--active' : 'd-workbench__tab';
        itemContainer.dataset.tabId = id;
        const tabElement = doc.createElement('button');
        tabElement.type = 'button';
        tabElement.className = 'd-workbench__tab-title';
        tabElement.setAttribute('role', 'tab');
        tabElement.setAttribute('aria-selected', String(id === shown));
        tabElement.dataset.tabId = id;
        tabElement.dataset.testid = 'wb-tab';
        tabElement.title = title;
        tabElement.textContent = title;
        itemContainer.append(tabElement);
        if (tabs.length > 1) {
          const closeButtonElement = doc.createElement('button');
          closeButtonElement.type = 'button';
          closeButtonElement.className = 'd-workbench__tab-close';
          closeButtonElement.setAttribute('aria-label', `Close ${title}`);
          closeButtonElement.title = 'Close';
          closeButtonElement.dataset.close = id;
          closeButtonElement.textContent = '×';
          itemContainer.append(closeButtonElement);
        }
        return itemContainer;
      }),
    );
  }

  dispose(): void {
    this.#tabsContainer.remove();
    this.#addButtonElement.remove();
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
