import { html } from 'htl';
import type { Disposable } from '../../core/disposable/disposable';
import type { FilterButton } from '../../generated/zz_generated.dashica';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { QueryApi } from '../../hosts/query/query';

/**
 * The filter bar of a page that has one (`page.json`'s `filterBar`): the page's filter buttons, each adding its
 * condition to the SQL filter (`status >= 500`; a `...` in it is asked for), and "filters", which opens the SQL
 * filter every query of the page adds to its WHERE; "active" while there is one.
 */
export const filters: Extension = {
  id: 'filters',
  activate({ ui, page, query, subscriptions }) {
    const bar = new FilterBar(query);
    let shown: Disposable | undefined;
    const showForPage = () => {
      shown?.dispose();
      shown = undefined;
      if (!page.current?.filterBar) return;
      bar.showButtons(page.current.filterButtons);
      shown = ui.registerBarItem('filter', bar.el, { alignment: 'left' });
    };
    subscriptions.push(page.onDidChangePage(showForPage));
    subscriptions.push(query.filters.onDidChange(() => bar.showSql()));
    subscriptions.push({ dispose: () => shown?.dispose() });
  },
};

/** The filter bar's content; `showButtons` takes the page's buttons, `showSql` the SQL filter of `query`. */
class FilterBar {
  readonly #buttons: HTMLElement = html`<div class="flex flex-wrap items-center gap-2"></div>`;
  readonly #active: HTMLElement = html`<span class="badge badge-primary badge-xs">active</span>`;
  readonly #sql: HTMLTextAreaElement = html`<textarea
    class="textarea textarea-bordered textarea-xs w-full font-mono"
    placeholder="e.g., status = 'active' AND region IN ('us-east', 'eu-west')"
    rows="2"></textarea>`;
  readonly el: HTMLElement;

  constructor(private readonly query: QueryApi) {
    const toggle: HTMLButtonElement = html`<button type="button" class="btn btn-xs" aria-expanded="false">filters</button>`;
    toggle.addEventListener('click', () => {
      this.#sql.hidden = !this.#sql.hidden;
      toggle.classList.toggle('btn-active', !this.#sql.hidden);
      toggle.setAttribute('aria-expanded', String(!this.#sql.hidden));
      if (!this.#sql.hidden) this.#sql.focus();
    });
    this.#sql.hidden = true;
    this.#sql.addEventListener('input', () => query.filters.setSql(this.#sql.value));
    this.el = html`<div class="flex-1 min-w-0 flex flex-col gap-1 px-4 py-2">
      <div class="flex items-center gap-2">
        ${this.#buttons}
        <div class="flex-1"></div>
        ${toggle}
        ${this.#active}
      </div>
      ${this.#sql}
    </div>`;
    this.showSql();
  }

  showButtons(buttons: readonly FilterButton[]): void {
    this.#buttons.replaceChildren(
      ...buttons.map((button) => {
        const el: HTMLButtonElement = html`<button type="button" class="btn btn-sm">${button.title}</button>`;
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
