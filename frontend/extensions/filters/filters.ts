import { html } from 'htl';
import { Filter, ListFilterPlus, X, createElement } from 'lucide';
import type { Disposable } from '../../core/disposable/disposable';
import type { FilterButton } from '../../generated/zz_generated.dashica';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { FilterChip, QueryApi, SqlFilter } from '../../hosts/query/query';
import type { UiApi } from '../../hosts/ui/ui';
import { addFilter, filterableTables, type FilterableTable } from './add-filter';
import './filters.css';

/**
 * The filters of a page that has them (`page.json`'s `filterBar`): the filter bar shows one chip per filter, a pill
 * ("host = a", made and signed by the server) or SQL ("SQL: duration > 2000"), each removed with its ×; a click on a
 * SQL chip's text edits it, a pill is not edited (its condition is the server's). The funnel
 * button in the top bar adds a SQL chip. The page's filter buttons are toggles in their place: pressed while a SQL
 * filter has their condition (`status >= 500`; a `...` in it is asked for, its value shown on the button), which then
 * has no chip of its own. "Add filter" after the chips adds a pill on one of the tables the page's charts filter
 * (`addFilter`), while there is one. The bar shows while it has a chip, a button or "Add filter", else the page has no
 * bar for nothing. A click on a chart adds its pills (`WidgetsApi.offerFilters`).
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
      filterBar.focusEditor();
    };
    const filterBar = new FilterBar(query, ui, showBar);
    const showForPage = () => {
      button?.dispose();
      button = undefined;
      filterBar.setButtons(page.current?.filterBar ? page.current.filterButtons : [], page.current?.filterBar ? filterableTables(page.current.widgets) : []);
      if (page.current?.filterBar) button = ui.registerBarItem('top', filterBar.toggle, { alignment: 'right', priority: 40 });
      showBar();
    };
    subscriptions.push(page.onDidChangePage(showForPage));
    subscriptions.push(
      query.filters.onDidChange(() => {
        filterBar.show();
        showBar();
      }),
    );
    subscriptions.push({ dispose: () => button?.dispose() });
    subscriptions.push({ dispose: () => bar?.dispose() });
  },
};

/**
 * The button among `buttons` whose condition the SQL chip `sql` is, and the text in place of its `...`s (`values`, as
 * the viewer typed them, `literalOf` undone): `sql` equals its `queryPart`, or a `queryPart` with `...` with a non-empty
 * text in place of each.
 */
export function buttonOf(sql: string, buttons: readonly FilterButton[]): { button: FilterButton; values: string[] } | undefined {
  for (const button of buttons) {
    if (button.queryPart === sql) return { button, values: [] };
    if (!button.queryPart.includes('...')) continue;
    const pattern = button.queryPart.split('...').map(escapeRegExp).join('([\\s\\S]+)');
    const match = new RegExp(`^${pattern}$`).exec(sql);
    if (match) return { button, values: match.slice(1).map((text) => text.replace(/\\([\s\S])/g, '$1')) };
  }
  return undefined;
}

/**
 * `value` as the text inside a ClickHouse string literal, `\` and `'` backslash-escaped (as Go's `sql.Quote`): a
 * button's `...` mostly sits in quotes (`path LIKE '...%'`), so `O'Brien` stays one value.
 */
function literalOf(value: string): string {
  return value.replace(/[\\']/g, '\\$&');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Which SQL chip is edited: its index in the chips, or `new` for the one the funnel adds. */
type Editing = number | 'new' | undefined;

/**
 * The funnel button (`toggle`) and the filter bar's content (`el`): the chips of `query`, "Add filter" for the page's
 * filterable tables and the page's buttons (`setButtons`); `show` draws them again. `onDidChangeWanted` is called when an edit starts (the funnel's new SQL chip
 * among them) or ends without a change of the chips.
 */
class FilterBar {
  readonly #chips: HTMLElement = html`<div class="d-filter-bar__chips" hidden></div>`;
  readonly #buttons: HTMLElement = html`<div class="d-filter-bar__buttons" hidden></div>`;
  readonly toggle: HTMLButtonElement = html`<button
    type="button"
    class="d-button d-button--ghost d-button--icon"
    title="Add a SQL filter"
    aria-label="Filters">${createElement(Filter, { width: 16, height: 16 })}</button>`;
  readonly #add: HTMLButtonElement = html`<button
    type="button"
    class="d-button d-button--ghost"
    title="Add a filter on a field of the page's charts">${createElement(ListFilterPlus, { width: 16, height: 16 })}Add filter</button>`;
  readonly el: HTMLElement = html`<div class="d-filter-bar">${this.#chips}${this.#buttons}</div>`;
  #pageButtons: readonly FilterButton[] = [];
  #tables: readonly FilterableTable[] = [];
  #editing: Editing;
  /** The field of the chip being edited, focused once it is in the document. */
  #editor: HTMLElement | undefined;

  constructor(
    private readonly query: QueryApi,
    /** Asks for the value of a button's `...`, and "Add filter"'s table, field, operator and value. */
    private readonly ui: Pick<UiApi, 'showInputBox' | 'showQuickPick' | 'createQuickPick'>,
    private readonly onDidChangeWanted: () => void,
  ) {
    this.toggle.addEventListener('click', () => this.#edit('new'));
    this.#add.addEventListener('click', () => void addFilter(this.ui, this.query, this.#tables, this.#add));
  }

  /** Whether the filter bar has something to show: a chip, the page's buttons, "Add filter", or the SQL chip being added. */
  get wanted(): boolean {
    return this.query.filters.chips.length > 0 || this.#pageButtons.length > 0 || this.#tables.length > 0 || this.#editing === 'new';
  }

  /** The page's filter buttons, and the tables its charts filter ("Add filter"). */
  setButtons(buttons: readonly FilterButton[], tables: readonly FilterableTable[]): void {
    this.#pageButtons = buttons;
    this.#tables = tables;
    this.#editing = undefined;
    this.show();
  }

  /** Draws the chips and the buttons; an edit of a chip ends, the model changed under it. */
  show(): void {
    if (this.#editing !== 'new') this.#editing = undefined;
    this.#draw();
  }

  /** Focuses the field of the chip being edited, once the bar is in the document. */
  focusEditor(): void {
    if (this.#editor?.isConnected) this.#editor.focus();
    this.#editor = undefined;
  }

  #draw(): void {
    const chips = this.query.filters.chips;
    this.#editor = undefined;
    // a button's condition shows as the button pressed, not as a chip
    const ofButton = chips.map((chip) => (chip.kind === 'sql' ? buttonOf(chip.sql, this.#pageButtons) : undefined));
    const shown = chips.flatMap((chip, index) =>
      ofButton[index] ? [] : [this.#editing === index && chip.kind === 'sql' ? this.#editorOf(chip, index) : this.#chipOf(chip, index)],
    );
    if (this.#editing === 'new') shown.push(this.#editorOf({ kind: 'sql', sql: '' }, 'new'));
    if (this.#tables.length > 0) shown.push(this.#add);
    this.#chips.hidden = shown.length === 0;
    this.#chips.replaceChildren(...shown);
    this.#buttons.hidden = this.#pageButtons.length === 0;
    this.#buttons.replaceChildren(
      ...this.#pageButtons.map((button) => {
        const matches = ofButton.filter((match) => match?.button === button);
        const pressed = matches.length > 0;
        const values = matches.flatMap((match) => match!.values).join(', ');
        const el: HTMLButtonElement = html`<button
          type="button"
          class="d-button"
          title=${button.queryPart}
          aria-pressed=${String(pressed)}>${button.title}${values ? `: ${values}` : ''}</button>`;
        el.addEventListener('click', () => (pressed ? this.#release(button) : void this.#press(button, el)));
        return el;
      }),
    );
  }

  #chipOf(chip: FilterChip, index: number): HTMLElement {
    const edit = chip.kind === 'sql' ? () => this.#edit(index) : undefined;
    const label = chip.kind === 'sql' ? 'SQL:' : '';
    const value = chip.kind === 'sql' ? chip.sql.replace(/\s+/g, ' ') : chip.label;
    const whole = chip.kind === 'sql' ? chip.sql : chip.label;
    return html`<span class=${chip.kind === 'pill' ? 'd-filter-chip d-filter-chip--pill' : 'd-filter-chip'} data-testid="filter-chip" title=${whole}>
      ${label ? html`<span class="d-filter-chip__label" onclick=${edit}>${label}</span>` : ''}
      <span class="d-filter-chip__value" onclick=${edit}>${value}</span>
      <button
        type="button"
        class="d-filter-chip__remove"
        title=${`Remove ${whole}`}
        aria-label=${`Remove ${whole}`}
        onclick=${() => this.query.filters.remove(index)}>${createElement(X, { width: 12, height: 12 })}</button>
    </span>`;
  }

  /**
   * The SQL chip `chip` at `index` (or the funnel's `new` one) in edit mode: its text in a textarea (Shift+Enter a new
   * line). Enter or leaving the field applies, Escape cancels.
   */
  #editorOf(chip: SqlFilter, index: number | 'new'): HTMLElement {
    const field: HTMLTextAreaElement = html`<textarea
      class="d-field d-field--full d-field--mono"
      placeholder="e.g., status = 'active' AND region IN ('us-east', 'eu-west')"
      aria-label="SQL filter"
      rows="2"></textarea>`;
    field.value = chip.sql;
    const done = (apply: boolean) => {
      if (this.#editing !== index) return;
      this.#editing = undefined;
      const before = this.query.filters.chips;
      if (apply && index === 'new') this.query.filters.add(field.value);
      else if (apply && typeof index === 'number') this.query.filters.replace(index, { kind: 'sql', sql: field.value });
      // the chips did not change (cancelled, empty, the same again), so no `onDidChange` draws them
      if (this.query.filters.chips === before) {
        this.#draw();
        this.onDidChangeWanted();
      }
    };
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') done(false);
      else if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        done(true);
      }
    });
    field.addEventListener('blur', () => done(true));
    this.#editor = field;
    return html`<span class="d-filter-chip d-filter-chip--editing" data-testid="filter-chip-editor">${field}</span>`;
  }

  #edit(editing: Editing): void {
    this.#editing = editing;
    this.#draw();
    this.onDidChangeWanted();
  }

  /**
   * Adds `button`'s condition; a `...` in it (`path LIKE '...%'`) is the value the viewer is asked for, in an input box
   * below the button (`el`), written in as `literalOf` it.
   */
  async #press(button: FilterButton, el: HTMLElement): Promise<void> {
    if (!button.queryPart.includes('...')) {
      this.query.filters.add(button.queryPart);
      return;
    }
    const value = await this.ui.showInputBox({ title: 'Parameter value', prompt: `${button.title}: ${button.queryPart}`, anchor: el });
    if (value) this.query.filters.add(button.queryPart.replaceAll('...', () => literalOf(value)));
  }

  /** Removes every chip that has `button`'s condition, in one change. */
  #release(button: FilterButton): void {
    this.query.filters.remove((chip) => chip.kind === 'sql' && buttonOf(chip.sql, [button]) !== undefined);
  }
}
