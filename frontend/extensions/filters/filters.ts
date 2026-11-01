import { html } from 'htl';
import { ListFilterPlus, X, createElement } from 'lucide';
import type { Disposable } from '../../core/disposable/disposable';
import type { FilterButton } from '../../generated/zz_generated.dashica';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { QueryApi } from '../../hosts/query/query';
import { InputBoxValidationSeverity, type UiApi } from '../../hosts/ui/ui';
import { FILTERS, addChip, removeChips, replaceChip, type FilterChip, type FilterOp, type Pill, type PillFilter, type SqlFilter } from './chips';
import { FieldsCache, SQL_PLACEHOLDER, SQL_PROMPT, addFilter, askValue, fetchValues, fieldSource, filterableTables, typeIn, type AskSql, type FieldType, type FilterableTable } from './add-filter';
import { filterDecorationProvider } from './decorations';
import { ADD_PILL, addPill, fetchPill, filterMenuProvider, type PillSource } from './offer';
import { OP_ICONS, OP_SIGNS, opsOf } from './ops';
import { pillButton, pillField, pillLabel, type PillField } from './pill-key';
import { Schemas } from '../sql-library/schemas';
import { completionOf, loadSqlEditors, showSqlInputBox, type SqlCompletion } from '../sql-library/sql-editor';
import './filters.css';

/**
 * The filters of a page, kept in its tab's query state (`FILTERS`, declared here: `?f=<key>&sql=…`), and the filter
 * bar of a page that has one (`page.json`'s `filterBar`): a chip per filter, a pill ("host = a", made and signed by the
 * server) or SQL ("SQL: duration > 2000"), each removed with its ×. A click on a field pill's operator or value changes
 * it, made again by a chart of the page on its table (`fieldSource`), a pill no chart makes is only removed; a click
 * on a SQL chip asks a new text. "Add filter" adds a pill on a column or computed field of the tables the page's charts
 * read (`addFilter`), or a SQL condition while the server takes SQL chips (`sqlEnabled`, sql_filter_enabled). The
 * page's filter buttons are toggles in their place, pressed while their signed pill is there, without a chip of their
 * own. A click on a chart, a table's cell or an Explore view's group row offers to filter by its values in the data
 * point menu (`filterMenuProvider`, `filters.addPill`); a table cell's SQL filters run `filters.addSql`. A chart's
 * answer is decorated with what it did with the pills (`filterDecorations`).
 */
export const filters: Extension = {
  id: 'filters',
  activate({ ui, page, query, commands, widgets, subscriptions }) {
    subscriptions.push(query.declare(FILTERS));
    const { sqlEnabled, explore } = page.workbench;
    // the names a SQL condition completes: the schema is part of Explore (/schema.json only with explore_enabled)
    const schemas = explore ? new Schemas() : undefined;
    const askSql: AskSql | undefined = sqlEnabled
      ? (options) =>
          showSqlInputBox(ui, loadSqlEditors, { ...options, completion: conditionCompletion(schemas, filterableTables(page.current?.widgets ?? [])) })
      : undefined;
    subscriptions.push(
      // what a click on a chart's mark, a table's cell or an Explore view's group row offers to filter by
      widgets.registerDataPointMenuProvider(filterMenuProvider),
      commands.registerCommand(ADD_PILL, (dataUrl: string, field: string, op: FilterOp, value: string) => addPill(query, dataUrl, field, op, value)),
      // what a chart did with the pills: "ignores host = a" (muted), "skipped: …"
      widgets.registerDecorationProvider(filterDecorationProvider),
      // a table cell's SQL filters ("Filter: Contains this value")
      commands.registerCommand('filters.addSql', (condition: string) => query.set(FILTERS, addChip(query.get(FILTERS), { kind: 'sql', sql: condition }))),
    );
    let bar: Disposable | undefined;
    const showBar = () => {
      const wanted = page.current?.filterBar === true && filterBar.wanted;
      if (wanted && !bar) bar = ui.registerBarItem('filter', filterBar.filterBarContainer, { alignment: 'left' });
      if (!wanted && bar) {
        bar.dispose();
        bar = undefined;
      }
    };
    const filterBar = new FilterBar(query, ui, askSql, new FieldsCache());
    const showForPage = () => {
      filterBar.setButtons(page.current?.filterBar ? page.current.filterButtons : [], page.current?.filterBar ? filterableTables(page.current.widgets) : []);
      showBar();
    };
    subscriptions.push(page.onDidChangePage(showForPage));
    subscriptions.push(
      query.onDidChange(FILTERS, () => {
        filterBar.draw();
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
 * The filter bar's content (`filterBarContainer`): `chips`, "Add filter" for the page's filterable tables (and, with
 * `askSql`, a SQL condition) and the page's buttons (`setButtons`); `draw` draws them again. A SQL chip is edited only
 * with `askSql`.
 */
class FilterBar {
  readonly #chipsContainer: HTMLElement = html`<div class="d-filter-bar__chips" hidden></div>`;
  readonly #buttonsContainer: HTMLElement = html`<div class="d-filter-bar__buttons" hidden></div>`;
  readonly #addButtonElement: HTMLButtonElement = html`<button
    type="button"
    class="d-button d-button--ghost"
    title="Add a filter on a column or field of the page's tables">${createElement(ListFilterPlus, { width: 16, height: 16 })}Add filter</button>`;
  readonly filterBarContainer: HTMLElement = html`<div class="d-filter-bar">${this.#chipsContainer}${this.#buttonsContainer}</div>`;
  #pageButtons: readonly FilterButton[] = [];
  #tables: readonly FilterableTable[] = [];

  constructor(
    /** The state the values of "Add filter" and of a pill's edit are asked for in. */
    private readonly query: Pick<QueryApi, 'get' | 'set' | 'requestParams'>,
    /** Asks for the value of a button's `...`, and "Add filter"'s table, field, operator and value. */
    private readonly ui: Pick<UiApi, 'showInputBox' | 'showQuickPick' | 'createQuickPick'>,
    /** Asks for a SQL condition, while the server takes SQL chips (sql_filter_enabled). */
    private readonly askSql: AskSql | undefined,
    /** The charts' `/fields`, by which "Add filter" and a pill's edit know a field's type. */
    private readonly fields: FieldsCache,
  ) {
    if (askSql) this.#addButtonElement.title = "Add a filter on a column or field of the page's tables, or a SQL condition";
    this.#addButtonElement.addEventListener('click', () => void addFilter(this.ui, this.query, this.#tables, this.#addButtonElement, this.fields, this.askSql));
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
    this.draw();
  }

  /** Draws the chips and the buttons. */
  draw(): void {
    const chips = this.query.get(FILTERS);
    // a button's pill shows as the button pressed, not as a chip
    const ofButton = chips.map((chip) => buttonOf(chip, this.#pageButtons));
    const shownElements = chips.flatMap((chip, index) =>
      ofButton[index] ? [] : [this.#chipOf(chip, index)],
    );
    if (this.#adds) shownElements.push(this.#addButtonElement);
    this.#chipsContainer.hidden = shownElements.length === 0;
    this.#chipsContainer.replaceChildren(...shownElements);
    this.#buttonsContainer.hidden = this.#pageButtons.length === 0;
    this.#buttonsContainer.replaceChildren(
      ...this.#pageButtons.map((button) => {
        const indices = chips.flatMap((_, index) => (ofButton[index]?.button === button ? [index] : []));
        const pressed = indices.length > 0;
        const buttonElement: HTMLButtonElement = html`<button
          type="button"
          class="d-button"
          title=${button.queryPart}
          aria-pressed=${String(pressed)}>${button.title}</button>`;
        buttonElement.addEventListener('click', () => (pressed ? this.#release(button) : void this.#press(button, buttonElement)));
        if (!button.queryPart.includes('...') || !pressed) return buttonElement;
        // a pressed `...` button: its title releases it, each value beside it asks a new one in its chip's place
        const valueElements = indices.map((index) => {
          const valueElement: HTMLButtonElement = html`<button
            type="button"
            class="d-button d-filter-button__value"
            title=${`Change the value of ${button.title}`}>${ofButton[index]!.value}</button>`;
          valueElement.addEventListener('click', () => void this.#press(button, valueElement, index));
          return valueElement;
        });
        return html`<span class="d-filter-button" role="group" aria-label=${button.title}>${buttonElement}${valueElements}</span>`;
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
        ? `${whole}\nSQL filters are not enabled (sql_filter_enabled)`
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
    const opElement: HTMLButtonElement = html`<button
      type="button"
      class="d-filter-chip__op"
      title=${`Change the operator of ${made.field}`}>${OP_SIGNS[made.op]}</button>`;
    opElement.addEventListener('click', () => void this.#changeOp(chip, index, made, source, opElement));
    const valueElement: HTMLButtonElement = html`<button
      type="button"
      class="d-filter-chip__value"
      title=${`Change the value of ${made.field}`}>${made.value === '' ? '(empty)' : made.value}</button>`;
    valueElement.addEventListener('click', () => void this.#changeValue(chip, index, made, source, valueElement));
    const label = pillLabel(chip.key);
    return html`<span class="d-filter-chip d-filter-chip--pill" data-testid="filter-chip" title=${label}>
      <span class="d-filter-chip__field">${made.field}</span>
      ${opElement}
      ${valueElement}
      <button
        type="button"
        class="d-filter-chip__remove"
        title=${`Remove ${label}`}
        aria-label=${`Remove ${label}`}
        onclick=${() => this.#remove(index)}>${createElement(X, { width: 12, height: 12 })}</button>
    </span>`;
  }

  /**
   * Asks a new op for the field's pill `chip` in a quick pick below `chipElement` (a menu), the ops of its type
   * (`opsOf`, the type from `source`'s `/fields`, the key carries none; the one it has checked; busy until the type is
   * there), and makes the pill again with it (`#remake`), the quick pick open meanwhile.
   */
  async #changeOp(chip: PillFilter, index: number, made: PillField, source: PillSource, chipElement: HTMLElement): Promise<void> {
    const items = this.#typeOf(made, source).then((known) =>
      opsOf(known?.type).map((op) => ({ label: `${made.field} ${OP_SIGNS[op]} ${made.value}`, icon: OP_ICONS[op], checked: op === made.op, op })),
    );
    await this.ui.showQuickPick(items, {
      anchor: chipElement,
      title: `Operator of ${made.field}`,
      menu: true,
      accept: async (picked) => {
        if (picked.op !== made.op) await this.#remake(chip, index, source, { ...made, op: picked.op });
      },
    });
  }

  /**
   * Asks a new value for the field's pill `chip` below `chipElement` as "Add filter" does (`askValue`: a time in an
   * input box, its value filled in; anything else in the quick pick of the chart's values; the type from `source`'s
   * `/fields`, the value's quick pick busy until it is there), and makes the pill again (`#remake`), the box open
   * meanwhile.
   */
  async #changeValue(chip: PillFilter, index: number, made: PillField, source: PillSource, chipElement: HTMLElement): Promise<void> {
    await askValue(
      this.ui,
      chipElement,
      `${made.field} ${OP_SIGNS[made.op]}`,
      made.op,
      this.#typeOf(made, source),
      (search, signal) => fetchValues(source.dataUrl, made, search, this.query.requestParams(), signal),
      (value) => this.#remake(chip, index, source, { ...made, value }),
      made.value,
    );
  }

  /**
   * The type of the pill's field as `source`'s `/fields` answers it (`typeIn`, asked once per chart and state,
   * `FieldsCache`); `undefined` when it fails or lacks the field (= and ≠).
   */
  #typeOf(made: PillField, source: PillSource): Promise<FieldType | undefined> {
    return this.fields.get(source.dataUrl, this.query.requestParams()).then(
      (fields) => typeIn(fields, made),
      () => undefined,
    );
  }

  /**
   * Asks `source` (`<dataUrl>/pill`) for the pill of `field` and puts it in the place of `chip` at `index`, unless
   * another chip is there meanwhile; rejects with the server's message for a refused one, the chip kept.
   */
  async #remake(chip: PillFilter, index: number, source: PillSource, { field, column, op, value }: PillField): Promise<void> {
    const pill = await fetchPill(source.dataUrl, { field, column, op, value });
    if (this.query.get(FILTERS)[index] === chip) this.#replace(index, { kind: 'pill', ...pill });
  }

  /**
   * Asks a new text for the SQL chip `chip` at `index` in the SQL input box below `chipElement` (the chip), its text
   * filled in and selected, and puts it in the chip's place unless another chip is there meanwhile; an empty text
   * removes the chip, Escape or a press elsewhere keeps it.
   */
  async #editSql(chip: SqlFilter, index: number, chipElement: HTMLElement): Promise<void> {
    const anchorElement = chipElement.closest<HTMLElement>('.d-filter-chip') ?? chipElement;
    const sql = await this.askSql?.({ title: 'SQL filter', prompt: SQL_PROMPT, placeholder: SQL_PLACEHOLDER, value: chip.sql, anchor: anchorElement });
    if (sql !== undefined && this.query.get(FILTERS)[index] === chip) this.#replace(index, { kind: 'sql', sql });
  }

  /**
   * Adds `button`'s pill: the one `page.json` signed, or for a button with `...` (`path ILIKE concat(..., '%')`) the
   * one its page makes of the value the viewer is asked for, in an input box below `buttonElement` named after the
   * button, the condition it makes shown below the field as it is typed (`buttonCondition`), an empty one refused; with
   * `index`, that pill replaces the chip there (a new value for a pressed button), the value shown first and selected.
   * A refused value shows the server's message in the still-open input box.
   */
  async #press(button: FilterButton, buttonElement: HTMLElement, index?: number): Promise<void> {
    if (!button.url) {
      if (button.key) this.query.set(FILTERS, addChip(this.query.get(FILTERS), { kind: 'pill', key: button.key }));
      return;
    }
    const { url } = button;
    const shown = index === undefined ? undefined : this.query.get(FILTERS)[index];
    const value = await this.ui.showInputBox({
      title: button.title,
      placeholder: button.queryPart,
      value: shown && buttonOf(shown, [button])?.value,
      validateInput: (typed) =>
        typed === ''
          ? { message: 'Enter a value.', severity: InputBoxValidationSeverity.Error }
          : { message: buttonCondition(button.queryPart, typed), severity: InputBoxValidationSeverity.Info },
      anchor: buttonElement,
      accept: async (typed) => {
        const pill = await fetchButtonPill(url, typed);
        if (index === undefined) this.query.set(FILTERS, addChip(this.query.get(FILTERS), { kind: 'pill', ...pill }));
        else if (this.query.get(FILTERS)[index] === shown) this.#replace(index, { kind: 'pill', ...pill });
      },
    });
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
