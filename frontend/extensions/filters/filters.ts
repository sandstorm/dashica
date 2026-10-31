import { html } from 'htl';
import { ListFilterPlus, X, createElement } from 'lucide';
import type { Disposable } from '../../core/disposable/disposable';
import type { FilterButton } from '../../generated/zz_generated.dashica';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { QueryApi } from '../../hosts/query/query';
import { InputBoxValidationSeverity, type MenuAnchor, type UiApi } from '../../hosts/ui/ui';
import type { FilterCandidate, PillSource } from '../../hosts/widgets/widgets';
import { FILTERS, addChip, removeChips, replaceChip, type FilterChip, type Pill, type PillFilter, type SqlFilter } from './chips';
import { SQL_PLACEHOLDER, SQL_PROMPT, addFilter, askValue, fetchType, fetchValues, fieldSource, filterableTables, type AskSql, type FilterableTable } from './add-filter';
import { fetchPill, offerFilters } from './offer';
import { OP_ICONS, OP_SIGNS, opsOf } from './ops';
import { pillButton, pillField, pillLabel, type PillField } from './pill-key';
import { Schemas } from '../sql-library/schemas';
import { completionOf, loadSqlEditors, showSqlInputBox, type SqlCompletion } from '../sql-library/sql-editor';
import './filters.css';

/**
 * The filters of a page, kept in its tab's query state (`FILTERS`: `?f=<key>&sql=…`), and the filter
 * bar of a page that has one (`page.json`'s `filterBar`): it shows one chip per filter, a pill
 * ("host = a", made and signed by the server) or SQL ("SQL: duration > 2000"), each removed with its ×; a click on a
 * SQL chip's text asks a new one below the chip. A field's pill is edited as Grafana's ad hoc filter chips are: a click on its operator
 * offers the ops of its type (`opsOf`: `=` / `≠`, for a number or a time also `<` `≤` `>` `≥`), one on its value asks
 * a new one (as "Add filter" does); each edit asks a chart of the page on the pill's table with that field, for a
 * column's pill any chart on it (`fieldSource`), for the pill again and puts it in the chip's place. A pill no chart
 * of the page makes, and a
 * button's pill outside its page, can only be removed. "Add filter"'s advanced entry "SQL condition…" adds a SQL chip
 * (§3.15 D26). Both ask in the input box with sql-library's SQL editor (D12: ClickHouse's words, and with Explore on
 * the names of the page's first table's connection, `conditionCompletion`). Both only while the server takes SQL
 * chips (`workbench.json`'s `sqlEnabled`, filters.sqlEnabled); else a SQL chip of a link can only be removed (the server answers it with 400). The page's filter buttons are toggles in
 * their place, each a signed pill, so they work without SQL chips: pressed while there is a pill of their condition
 * (`status >= 500`; a `...` in it is asked for and written in by the server, its value shown beside the button, a
 * click on it asks a new one), which then has no chip of its own. "Add filter" after the chips adds a pill on a column
 * or a computed field of one of the tables the page's charts read (`addFilter`), shown while there is one or SQL chips
 * are taken. The bar shows while it has a chip, a button or
 * "Add filter", else the page has no bar for nothing. A click on a chart, a table's cell or an Explore view's group row
 * runs the command `filters.offer` (`(at, candidates, { dataUrl, filterable })`): its quick pick adds the pill chosen to
 * the tab shown (`offerFilters`). A table cell's SQL filters run `filters.addSql` (`(condition)`), which adds the
 * condition as a SQL chip.
 */
export const filters: Extension = {
  id: 'filters',
  activate({ ui, page, query, commands, subscriptions }) {
    const { sqlEnabled, explore } = page.workbench;
    // the names a SQL condition completes: the schema is part of Explore (/schema.json only with explore.enabled)
    const schemas = explore ? new Schemas() : undefined;
    const askSql: AskSql | undefined = sqlEnabled
      ? (options) =>
          showSqlInputBox(ui, loadSqlEditors, { ...options, completion: conditionCompletion(schemas, filterableTables(page.current?.widgets ?? [])) })
      : undefined;
    subscriptions.push(
      commands.registerCommand('filters.offer', (at: MenuAnchor, candidates: readonly FilterCandidate[], source: PillSource) =>
        offerFilters(ui, query, at, candidates, source),
      ),
      // a table cell's SQL filters ("Filter: Contains this value")
      commands.registerCommand('filters.addSql', (condition: string) => query.set(FILTERS, addChip(query.get(FILTERS), { kind: 'sql', sql: condition }))),
    );
    let bar: Disposable | undefined;
    const showBar = () => {
      const wanted = page.current?.filterBar === true && filterBar.wanted;
      if (wanted && !bar) bar = ui.registerBarItem('filter', filterBar.el, { alignment: 'left' });
      if (!wanted && bar) {
        bar.dispose();
        bar = undefined;
      }
    };
    const filterBar = new FilterBar(query, ui, askSql);
    const showForPage = () => {
      filterBar.setButtons(page.current?.filterBar ? page.current.filterButtons : [], page.current?.filterBar ? filterableTables(page.current.widgets) : []);
      showBar();
    };
    subscriptions.push(page.onDidChangePage(showForPage));
    subscriptions.push(
      query.onDidChange(FILTERS, () => {
        filterBar.show();
        showBar();
      }),
    );
    subscriptions.push({ dispose: () => bar?.dispose() });
  },
};

/**
 * The button among `buttons` that the pill `chip` was made for (`pillButton`: the button's `queryPart`), and the value
 * written in for its `...` ('' for a button without); `undefined` for a SQL chip and the pill of a field.
 */
export function buttonOf(chip: FilterChip, buttons: readonly FilterButton[]): { button: FilterButton; value: string } | undefined {
  const made = chip.kind === 'pill' ? pillButton(chip.key) : undefined;
  const button = made && buttons.find(({ queryPart }) => queryPart === made.button);
  return button && { button, value: made.value };
}

/**
 * The condition of the filter button with `queryPart` for `value`, as its page makes it (lib/dashboard/filter,
 * `NewButton`): each `...` replaced by `value` as a ClickHouse string literal, `\` and `'` escaped with a backslash
 * (sql.Quote). Only what the input box shows while the value is typed; the pill is the page's.
 */
export function buttonCondition(queryPart: string, value: string): string {
  return queryPart.replaceAll('...', `'${value.replace(/[\\']/g, '\\$&')}'`);
}

/**
 * What a SQL condition on the page with `tables` completes: the schema of its first table's connection, that table's
 * columns also alone (a condition goes into the WHERE of every query, most read that table); `undefined` without
 * `schemas` (Explore off) or a table, and while the schema does not answer.
 */
export function conditionCompletion(schemas: Pick<Schemas, 'get'> | undefined, tables: readonly FilterableTable[]): Promise<SqlCompletion | undefined> | undefined {
  const first = tables[0];
  if (!schemas || !first) return undefined;
  return schemas.get(first.connection).then(
    (schema) => completionOf(schema, first.table),
    () => undefined,
  );
}

/**
 * The pill of the filter button with `...` whose page answers at `url` (`page.json`'s `url`, `<page>/button?i=<index>`)
 * for `value`: the server writes the value in as a string literal and signs it.
 */
async function fetchButtonPill(url: string, value: string): Promise<Pill> {
  const response = await fetch(`${url}&${new URLSearchParams({ value })}`);
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  const { key } = (await response.json()) as Pill;
  return { key };
}

/**
 * The filter bar's content (`el`): `chips`, "Add filter" for the page's filterable tables (and, with `askSql`, a SQL
 * condition) and the page's buttons (`setButtons`); `show` draws them again. A SQL chip is edited only with `askSql`.
 */
class FilterBar {
  readonly #chips: HTMLElement = html`<div class="d-filter-bar__chips" hidden></div>`;
  readonly #buttons: HTMLElement = html`<div class="d-filter-bar__buttons" hidden></div>`;
  readonly #add: HTMLButtonElement = html`<button
    type="button"
    class="d-button d-button--ghost"
    title="Add a filter on a column or field of the page's tables">${createElement(ListFilterPlus, { width: 16, height: 16 })}Add filter</button>`;
  readonly el: HTMLElement = html`<div class="d-filter-bar">${this.#chips}${this.#buttons}</div>`;
  #pageButtons: readonly FilterButton[] = [];
  #tables: readonly FilterableTable[] = [];

  constructor(
    /** The state the values of "Add filter" and of a pill's edit are asked for in. */
    private readonly query: Pick<QueryApi, 'get' | 'set' | 'requestParams'>,
    /** Asks for the value of a button's `...`, and "Add filter"'s table, field, operator and value. */
    private readonly ui: Pick<UiApi, 'showInputBox' | 'showQuickPick' | 'createQuickPick'>,
    /** Asks for a SQL condition, while the server takes SQL chips (filters.sqlEnabled). */
    private readonly askSql: AskSql | undefined,
  ) {
    if (askSql) this.#add.title = "Add a filter on a column or field of the page's tables, or a SQL condition";
    this.#add.addEventListener('click', () => void addFilter(this.ui, this.query, this.#tables, this.#add, this.askSql));
  }

  /** Whether "Add filter" has something to offer: a table the page's charts read, or a SQL condition. */
  get #adds(): boolean {
    return this.#tables.length > 0 || this.askSql !== undefined;
  }

  /** Whether the filter bar has something to show: a chip, the page's buttons, or "Add filter". */
  get wanted(): boolean {
    return this.query.get(FILTERS).length > 0 || this.#pageButtons.length > 0 || this.#adds;
  }

  /** The page's filter buttons, and the tables its charts filter ("Add filter"). */
  setButtons(buttons: readonly FilterButton[], tables: readonly FilterableTable[]): void {
    this.#pageButtons = buttons;
    this.#tables = tables;
    this.show();
  }

  /** Draws the chips and the buttons. */
  show(): void {
    const chips = this.query.get(FILTERS);
    // a button's pill shows as the button pressed, not as a chip
    const ofButton = chips.map((chip) => buttonOf(chip, this.#pageButtons));
    const shown = chips.flatMap((chip, index) =>
      ofButton[index] ? [] : [this.#chipOf(chip, index)],
    );
    if (this.#adds) shown.push(this.#add);
    this.#chips.hidden = shown.length === 0;
    this.#chips.replaceChildren(...shown);
    this.#buttons.hidden = this.#pageButtons.length === 0;
    this.#buttons.replaceChildren(
      ...this.#pageButtons.map((button) => {
        const indices = chips.flatMap((_, index) => (ofButton[index]?.button === button ? [index] : []));
        const pressed = indices.length > 0;
        const el: HTMLButtonElement = html`<button
          type="button"
          class="d-button"
          title=${button.queryPart}
          aria-pressed=${String(pressed)}>${button.title}</button>`;
        el.addEventListener('click', () => (pressed ? this.#release(button) : void this.#press(button, el)));
        if (!button.queryPart.includes('...') || !pressed) return el;
        // a pressed `...` button: its title releases it, each value beside it asks a new one in its chip's place
        const values = indices.map((index) => {
          const value: HTMLButtonElement = html`<button
            type="button"
            class="d-button d-filter-button__value"
            title=${`Change the value of ${button.title}`}>${ofButton[index]!.value}</button>`;
          value.addEventListener('click', () => void this.#press(button, value, index));
          return value;
        });
        return html`<span class="d-filter-button" role="group" aria-label=${button.title}>${el}${values}</span>`;
      }),
    );
  }

  #chipOf(chip: FilterChip, index: number): HTMLElement {
    const made = chip.kind === 'pill' ? pillField(chip.key) : undefined;
    const source = made && fieldSource(this.#tables, made);
    if (chip.kind === 'pill' && made && source) return this.#pillOf(chip, index, made, source);
    const edit = chip.kind === 'sql' && this.askSql ? (event: MouseEvent) => void this.#editSql(chip, index, event.currentTarget as HTMLElement) : undefined;
    const label = chip.kind === 'sql' ? 'SQL:' : '';
    const value = chip.kind === 'sql' ? chip.sql.replace(/\s+/g, ' ') : pillLabel(chip.key);
    const whole = chip.kind === 'sql' ? chip.sql : value;
    const title =
      chip.kind === 'sql' && !this.askSql
        ? `${whole}\nSQL filters are not enabled (filters.sqlEnabled)`
        : made
          ? `${whole}\n${made.column ? `No chart of this page reads ${made.table}` : `No chart of this page filters ${made.table} by ${made.field}`}, so it can only be removed`
          : whole;
    return html`<span class=${chip.kind === 'pill' ? 'd-filter-chip d-filter-chip--pill' : 'd-filter-chip'} data-testid="filter-chip" title=${title}>
      ${label ? html`<span class="d-filter-chip__label" onclick=${edit}>${label}</span>` : ''}
      <span class="d-filter-chip__value" onclick=${edit}>${value}</span>
      <button
        type="button"
        class="d-filter-chip__remove"
        title=${`Remove ${whole}`}
        aria-label=${`Remove ${whole}`}
        onclick=${() => this.#remove(index)}>${createElement(X, { width: 12, height: 12 })}</button>
    </span>`;
  }

  /**
   * The field's pill `chip` at `index` (`made`, its field), editable: its field, its operator (a click offers the ops
   * of its type) and its value (a click asks a new one), each edit made by `source`.
   */
  #pillOf(chip: PillFilter, index: number, made: PillField, source: PillSource): HTMLElement {
    const op: HTMLButtonElement = html`<button
      type="button"
      class="d-filter-chip__op"
      title=${`Change the operator of ${made.field}`}>${OP_SIGNS[made.op]}</button>`;
    op.addEventListener('click', () => void this.#changeOp(chip, index, made, source, op));
    const value: HTMLButtonElement = html`<button
      type="button"
      class="d-filter-chip__value"
      title=${`Change the value of ${made.field}`}>${made.value === '' ? '(empty)' : made.value}</button>`;
    value.addEventListener('click', () => void this.#changeValue(chip, index, made, source, value));
    const label = pillLabel(chip.key);
    return html`<span class="d-filter-chip d-filter-chip--pill" data-testid="filter-chip" title=${label}>
      <span class="d-filter-chip__field">${made.field}</span>
      ${op}
      ${value}
      <button
        type="button"
        class="d-filter-chip__remove"
        title=${`Remove ${label}`}
        aria-label=${`Remove ${label}`}
        onclick=${() => this.#remove(index)}>${createElement(X, { width: 12, height: 12 })}</button>
    </span>`;
  }

  /**
   * Asks a new op for the field's pill `chip` in a quick pick below `el` (a menu), the ops of its type (`opsOf`, the type from
   * `source`'s `/type`, the key carries none; the one it has checked), and makes the pill again with it.
   */
  async #changeOp(chip: PillFilter, index: number, made: PillField, source: PillSource, el: HTMLElement): Promise<void> {
    const known = await this.#typeOf(made, source);
    const items = opsOf(known?.type).map((op) => ({ label: `${made.field} ${OP_SIGNS[op]} ${made.value}`, icon: OP_ICONS[op], checked: op === made.op, op }));
    const picked = await this.ui.showQuickPick(items, { anchor: el, title: `Operator of ${made.field}`, menu: true });
    if (picked && picked.op !== made.op) await this.#remake(chip, index, source, { ...made, op: picked.op });
  }

  /**
   * Asks a new value for the field's pill `chip` below `el` as "Add filter" does (`askValue`: a time in an input box,
   * its value filled in; anything else in the quick pick of the chart's values; the type from `source`'s `/type`),
   * and makes the pill again.
   */
  async #changeValue(chip: PillFilter, index: number, made: PillField, source: PillSource, el: HTMLElement): Promise<void> {
    const value = await askValue(
      this.ui,
      el,
      `${made.field} ${OP_SIGNS[made.op]}`,
      made.op,
      await this.#typeOf(made, source),
      (search, signal) => fetchValues(source.dataUrl, made, search, this.query.requestParams(), signal),
      made.value,
    );
    if (value !== undefined) await this.#remake(chip, index, source, { ...made, value });
  }

  /** The type of the pill's field as `source` answers it (`fetchType`); `undefined` when it fails (= and ≠). */
  #typeOf(made: PillField, source: PillSource): Promise<Awaited<ReturnType<typeof fetchType>> | undefined> {
    return fetchType(source.dataUrl, made, this.query.requestParams()).catch(() => undefined);
  }

  /**
   * Asks `source` (`<dataUrl>/pill`) for the pill of `field` and puts it in the place of `chip` at `index`, unless
   * another chip is there meanwhile; a refused one is logged, the chip kept.
   */
  async #remake(chip: PillFilter, index: number, source: PillSource, { field, column, op, value }: PillField): Promise<void> {
    try {
      const pill = await fetchPill(source.dataUrl, { fieldId: field, column, op, value });
      if (this.query.get(FILTERS)[index] === chip) this.#replace(index, { kind: 'pill', ...pill });
    } catch (error) {
      console.error(`Filter ${field} ${OP_SIGNS[op]} ${value} failed:`, error);
    }
  }

  /**
   * Asks a new text for the SQL chip `chip` at `index` in the SQL input box below `el` (the chip), its text filled in
   * and selected, and puts it in the chip's place unless another chip is there meanwhile; an empty text removes the
   * chip, Escape or a press elsewhere keeps it.
   */
  async #editSql(chip: SqlFilter, index: number, el: HTMLElement): Promise<void> {
    const anchor = el.closest<HTMLElement>('.d-filter-chip') ?? el;
    const sql = await this.askSql?.({ title: 'SQL filter', prompt: SQL_PROMPT, placeholder: SQL_PLACEHOLDER, value: chip.sql, anchor });
    if (sql !== undefined && this.query.get(FILTERS)[index] === chip) this.#replace(index, { kind: 'sql', sql });
  }

  /**
   * Adds `button`'s pill: the one `page.json` signed, or for a button with `...` (`path ILIKE concat(..., '%')`) the
   * one its page makes of the value the viewer is asked for, in an input box below `el` named after the button, the
   * condition it makes shown below the field as it is typed (`buttonCondition`), an empty one refused; with `index`,
   * that pill replaces the chip there (a new value for a pressed button), the value shown first and selected.
   */
  async #press(button: FilterButton, el: HTMLElement, index?: number): Promise<void> {
    if (!button.url) {
      if (button.key) this.query.set(FILTERS, addChip(this.query.get(FILTERS), { kind: 'pill', key: button.key }));
      return;
    }
    const shown = index === undefined ? undefined : this.query.get(FILTERS)[index];
    const value = await this.ui.showInputBox({
      title: button.title,
      placeholder: button.queryPart,
      value: shown && buttonOf(shown, [button])?.value,
      validateInput: (typed) =>
        typed === '' ? 'Enter a value.' : { message: buttonCondition(button.queryPart, typed), severity: InputBoxValidationSeverity.Info },
      anchor: el,
    });
    if (!value) return;
    try {
      const pill = await fetchButtonPill(button.url, value);
      if (index === undefined) this.query.set(FILTERS, addChip(this.query.get(FILTERS), { kind: 'pill', ...pill }));
      else if (this.query.get(FILTERS)[index] === shown) this.#replace(index, { kind: 'pill', ...pill });
    } catch (error) {
      console.error(`Filter button ${button.title} failed:`, error);
    }
  }

  /** Removes every pill of `button`, in one change. */
  #release(button: FilterButton): void {
    this.#remove((chip) => buttonOf(chip, [button]) !== undefined);
  }

  #replace(index: number, chip: FilterChip): void {
    this.query.set(FILTERS, replaceChip(this.query.get(FILTERS), index, chip));
  }

  #remove(which: number | ((chip: FilterChip) => boolean)): void {
    this.query.set(FILTERS, removeChips(this.query.get(FILTERS), which));
  }
}
