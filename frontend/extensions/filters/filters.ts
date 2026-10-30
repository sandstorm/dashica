import { html } from 'htl';
import { Filter, createElement } from 'lucide';
import type { Disposable } from '../../core/disposable/disposable';
import type { FilterButton } from '../../generated/zz_generated.dashica';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { QueryApi } from '../../hosts/query/query';
import './filters.css';

/**
 * The filters of a page that has them (`page.json`'s `filterBar`): a funnel button in the title bar, marked while there
 * is a SQL filter, opens the SQL filter every query of the page adds to its WHERE (open by itself while there is one).
 * The filter bar shows while the page has filter buttons, each adding its condition to the SQL filter (`status >= 500`;
 * a `...` in it is asked for), or while the SQL filter is open; else the page has no bar for nothing.
 */
export const filters: Extension = {
  id: 'filters',
  activate({ ui, page, query, subscriptions }) {
    let button: Disposable | undefined;
    let bar: Disposable | undefined;
    const showBar = () => {
      const wanted = page.current?.filterBar === true && filterBar.wanted;
      if (wanted && !bar) bar = ui.registerBarItem('filter', filterBar.el, { alignment: 'left' });
      if (!wanted && bar) {
        bar.dispose();
        bar = undefined;
      }
    };
    const filterBar = new FilterBar(query, showBar);
    const showForPage = () => {
      button?.dispose();
      button = undefined;
      if (page.current?.filterBar) {
        filterBar.showButtons(page.current.filterButtons);
        button = ui.registerBarItem('title', filterBar.toggle, { alignment: 'right', priority: 40 });
      }
      showBar();
    };
    subscriptions.push(page.onDidChangePage(showForPage));
    subscriptions.push(
      query.filters.onDidChange(() => {
        filterBar.showSql();
        showBar();
      }),
    );
    subscriptions.push({ dispose: () => button?.dispose() });
    subscriptions.push({ dispose: () => bar?.dispose() });
  },
};

/**
 * The funnel button (`toggle`) and the filter bar's content (`el`); `showButtons` takes the page's buttons, `showSql`
 * the SQL filter of `query`. `onDidChangeWanted` is called when the SQL filter opens or closes.
 */
class FilterBar {
  readonly #buttons: HTMLElement = html`<div class="d-filter-bar__buttons"></div>`;
  readonly #active: HTMLElement = html`<span class="d-badge d-badge--dot d-filter-bar__dot" aria-hidden="true"></span>`;
  readonly toggle: HTMLButtonElement = html`<button
    type="button"
    class="d-button d-button--ghost d-button--icon d-filter-bar__toggle"
    title="Filters"
    aria-label="Filters"
    aria-expanded="false">${createElement(Filter, { width: 16, height: 16 })}${this.#active}</button>`;
  readonly #sql: HTMLTextAreaElement = html`<textarea
    class="d-field d-field--full d-field--mono"
    placeholder="e.g., status = 'active' AND region IN ('us-east', 'eu-west')"
    rows="2"
    hidden></textarea>`;
  readonly el: HTMLElement = html`<div class="d-filter-bar">${this.#buttons}${this.#sql}</div>`;
  #hasButtons = false;

  constructor(
    private readonly query: QueryApi,
    private readonly onDidChangeWanted: () => void,
  ) {
    this.toggle.addEventListener('click', () => {
      this.#setOpen(this.#sql.hidden);
      if (!this.#sql.hidden) this.#sql.focus();
    });
    this.#sql.addEventListener('input', () => query.filters.setSql(this.#sql.value));
    this.showSql();
  }

  /** Whether the filter bar has something to show: the page's buttons, or the open SQL filter. */
  get wanted(): boolean {
    return this.#hasButtons || !this.#sql.hidden;
  }

  showButtons(buttons: readonly FilterButton[]): void {
    this.#hasButtons = buttons.length > 0;
    this.#buttons.hidden = !this.#hasButtons;
    this.#buttons.replaceChildren(
      ...buttons.map((button) => {
        const el: HTMLButtonElement = html`<button type="button" class="d-button">${button.title}</button>`;
        el.addEventListener('click', () => this.#add(button.queryPart));
        return el;
      }),
    );
  }

  showSql(): void {
    const sql = this.query.filters.sql;
    // while typing, the field has it already; setting it would move the cursor to the end
    if (this.#sql.value !== sql) this.#sql.value = sql;
    this.#active.hidden = sql === '';
    if (sql !== '' && this.#sql.hidden) this.#setOpen(true);
  }

  #setOpen(open: boolean): void {
    this.#sql.hidden = !open;
    this.toggle.setAttribute('aria-expanded', String(open));
    this.onDidChangeWanted();
  }

  /** Adds `condition`; a `...` in it (`path LIKE '...%'`) is the value the viewer is asked for. */
  #add(condition: string): void {
    if (!condition.includes('...')) {
      this.query.filters.add(condition);
      return;
    }
    const value = prompt('Parameter value');
    if (value) this.query.filters.add(condition.replaceAll('...', value));
  }
}
