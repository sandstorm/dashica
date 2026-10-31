import { html } from 'htl';
import { Filter, X, createElement } from 'lucide';
import type { Disposable } from '../../core/disposable/disposable';
import type { FilterButton } from '../../generated/zz_generated.dashica';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { FilterChip, FilterOp, QueryApi } from '../../hosts/query/query';
import type { Selection } from '../../hosts/widgets/widgets';
import './filters.css';

/**
 * The filters of a page that has them (`page.json`'s `filterBar`): the filter bar shows one chip per filter, structured
 * ("host = a") or SQL ("SQL: duration > 2000"), each removed with its × and edited with a click on its text. The funnel
 * button in the title bar adds a SQL chip. The page's filter buttons are toggles: pressed while a SQL chip has their
 * condition (`status >= 500`; a `...` in it is asked for), which is then labelled with the button's title. The bar
 * shows while it has a chip or a button, else the page has no bar for nothing. On a chart's selected category, the
 * floating bar `widget/selection` offers "Filter by" and "Exclude", which add it as a structured chip and end the
 * selection.
 */
export const filters: Extension = {
  id: 'filters',
  activate({ ui, page, query, widgets, commands, subscriptions }) {
    const addSelection = (op: FilterOp) => (selection: Selection) => {
      query.filters.add(selection.fieldId, op, selection.value);
      widgets.clearSelection();
    };
    subscriptions.push(commands.registerCommand('filters.filterBySelection', addSelection('eq')));
    subscriptions.push(commands.registerCommand('filters.excludeSelection', addSelection('ne')));
    const isCategory = (selection: Selection) => selection.kind === 'category';
    subscriptions.push(ui.registerMenuItem<Selection>('widget/selection', { command: 'filters.filterBySelection', title: 'Filter by', order: 1, when: isCategory }));
    subscriptions.push(ui.registerMenuItem<Selection>('widget/selection', { command: 'filters.excludeSelection', title: 'Exclude', order: 2, when: isCategory }));
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
    const filterBar = new FilterBar(query, showBar);
    const showForPage = () => {
      button?.dispose();
      button = undefined;
      filterBar.setButtons(page.current?.filterBar ? page.current.filterButtons : []);
      if (page.current?.filterBar) button = ui.registerBarItem('title', filterBar.toggle, { alignment: 'right', priority: 40 });
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
 * The button among `buttons` whose condition the SQL chip `sql` is, and the text in place of its `...`s (`values`):
 * `sql` equals its `queryPart`, or a `queryPart` with `...` with a non-empty text in place of each.
 */
export function buttonOf(sql: string, buttons: readonly FilterButton[]): { button: FilterButton; values: string[] } | undefined {
  for (const button of buttons) {
    if (button.queryPart === sql) return { button, values: [] };
    if (!button.queryPart.includes('...')) continue;
    const pattern = button.queryPart.split('...').map(escapeRegExp).join('([\\s\\S]+)');
    const match = new RegExp(`^${pattern}$`).exec(sql);
    if (match) return { button, values: match.slice(1) };
  }
  return undefined;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Which chip is edited: its index in the chips, or `new` for the SQL chip the funnel adds. */
type Editing = number | 'new' | undefined;

/**
 * The funnel button (`toggle`) and the filter bar's content (`el`): the chips of `query` and the page's buttons
 * (`setButtons`); `show` draws them again. `onDidChangeWanted` is called when an edit starts (the funnel's new SQL chip
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
  readonly el: HTMLElement = html`<div class="d-filter-bar">${this.#chips}${this.#buttons}</div>`;
  #pageButtons: readonly FilterButton[] = [];
  #editing: Editing;
  /** The field of the chip being edited, focused once it is in the document. */
  #editor: HTMLElement | undefined;

  constructor(
    private readonly query: QueryApi,
    private readonly onDidChangeWanted: () => void,
  ) {
    this.toggle.addEventListener('click', () => this.#edit('new'));
  }

  /** Whether the filter bar has something to show: a chip, the page's buttons, or the SQL chip being added. */
  get wanted(): boolean {
    return this.query.filters.chips.length > 0 || this.#pageButtons.length > 0 || this.#editing === 'new';
  }

  setButtons(buttons: readonly FilterButton[]): void {
    this.#pageButtons = buttons;
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
    const shown = chips.map((chip, index) => (this.#editing === index ? this.#editorOf(chip, index) : this.#chipOf(chip, index)));
    if (this.#editing === 'new') shown.push(this.#editorOf({ kind: 'sql', sql: '' }, 'new'));
    this.#chips.hidden = shown.length === 0;
    this.#chips.replaceChildren(...shown);
    this.#buttons.hidden = this.#pageButtons.length === 0;
    this.#buttons.replaceChildren(
      ...this.#pageButtons.map((button) => {
        const pressed = chips.some((chip) => chip.kind === 'sql' && buttonOf(chip.sql, [button]) !== undefined);
        const el: HTMLButtonElement = html`<button type="button" class="d-button" aria-pressed=${String(pressed)}>${button.title}</button>`;
        el.addEventListener('click', () => (pressed ? this.#release(button) : this.#press(button)));
        return el;
      }),
    );
  }

  #chipOf(chip: FilterChip, index: number): HTMLElement {
    const edit = () => this.#edit(index);
    let label: string;
    let op: Element | string = '';
    let value: string;
    let whole: string;
    if (chip.kind === 'sql') {
      const pressed = buttonOf(chip.sql, this.#pageButtons);
      label = pressed ? pressed.button.title + (pressed.values.length > 0 ? ':' : '') : 'SQL:';
      value = pressed ? pressed.values.join(', ') : chip.sql.replace(/\s+/g, ' ');
      whole = chip.sql;
    } else {
      const sign = chip.op === 'eq' ? '=' : '≠';
      label = chip.fieldId;
      op = html`<button
        type="button"
        class="d-filter-chip__op"
        title=${chip.op === 'eq' ? 'Change to ≠' : 'Change to ='}
        onclick=${() => this.query.filters.replace(index, { ...chip, op: chip.op === 'eq' ? 'ne' : 'eq' })}>${sign}</button>`;
      value = chip.value;
      whole = `${chip.fieldId} ${sign} ${chip.value}`;
    }
    return html`<span class="d-filter-chip" data-testid="filter-chip" title=${whole}>
      <span class="d-filter-chip__label" onclick=${edit}>${label}</span>
      ${op}
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
   * The chip `chip` at `index` in edit mode: a SQL chip's text in a textarea (Shift+Enter a new line), a structured
   * chip's value in an input, its `=` / `≠` flipping the op. Enter or leaving the field applies, Escape cancels.
   */
  #editorOf(chip: FilterChip, index: number | 'new'): HTMLElement {
    let op = chip.kind === 'field' ? chip.op : 'eq';
    const field: HTMLInputElement | HTMLTextAreaElement =
      chip.kind === 'sql'
        ? html`<textarea
            class="d-field d-field--full d-field--mono"
            placeholder="e.g., status = 'active' AND region IN ('us-east', 'eu-west')"
            aria-label="SQL filter"
            rows="2"></textarea>`
        : html`<input class="d-field d-field--mono" aria-label=${`Value of ${chip.fieldId}`} />`;
    field.value = chip.kind === 'sql' ? chip.sql : chip.value;
    const done = (apply: boolean) => {
      if (this.#editing !== index) return;
      this.#editing = undefined;
      const before = this.query.filters.chips;
      if (apply && index === 'new') this.query.filters.add(field.value);
      else if (apply && typeof index === 'number')
        this.query.filters.replace(index, chip.kind === 'sql' ? { kind: 'sql', sql: field.value } : { ...chip, op, value: field.value });
      // the chips did not change (cancelled, empty, the same again), so no `onDidChange` draws them
      if (this.query.filters.chips === before) {
        this.#draw();
        this.onDidChangeWanted();
      }
    };
    field.addEventListener('keydown', (event) => {
      const key = (event as KeyboardEvent).key;
      if (key === 'Escape') done(false);
      else if (key === 'Enter' && !(event as KeyboardEvent).shiftKey) {
        event.preventDefault();
        done(true);
      }
    });
    field.addEventListener('blur', () => done(true));
    this.#editor = field;
    if (chip.kind === 'sql') return html`<span class="d-filter-chip d-filter-chip--editing" data-testid="filter-chip-editor">${field}</span>`;
    const sign: HTMLButtonElement = html`<button type="button" class="d-filter-chip__op" title="Change the op">${op === 'eq' ? '=' : '≠'}</button>`;
    // keeps the focus in the field, so the click does not apply the edit
    sign.addEventListener('mousedown', (event) => event.preventDefault());
    sign.addEventListener('click', () => {
      op = op === 'eq' ? 'ne' : 'eq';
      sign.textContent = op === 'eq' ? '=' : '≠';
    });
    return html`<span class="d-filter-chip" data-testid="filter-chip-editor">
      <span class="d-filter-chip__label">${chip.fieldId}</span>
      ${sign}${field}
    </span>`;
  }

  #edit(editing: Editing): void {
    this.#editing = editing;
    this.#draw();
    this.onDidChangeWanted();
  }

  /** Adds `button`'s condition; a `...` in it (`path LIKE '...%'`) is the value the viewer is asked for. */
  #press(button: FilterButton): void {
    if (!button.queryPart.includes('...')) {
      this.query.filters.add(button.queryPart);
      return;
    }
    const value = prompt('Parameter value');
    if (value) this.query.filters.add(button.queryPart.replaceAll('...', value));
  }

  /** Removes every chip that has `button`'s condition, in one change. */
  #release(button: FilterButton): void {
    this.query.filters.remove((chip) => chip.kind === 'sql' && buttonOf(chip.sql, [button]) !== undefined);
  }
}
