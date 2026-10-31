// See addFilter.
import type { WidgetNode } from '../../generated/zz_generated.dashica';
import type { QueryApi } from '../../hosts/query/query';
import { QuickPickItemKind, type MenuAnchor, type QuickPickItem, type QuickPickSeparator, type UiApi } from '../../hosts/ui/ui';
import type { PillSource } from '../../hosts/widgets/widgets';
import { typeKind } from '../widget-library/clickhouse-type';
import { FILTERS, addChip, type FilterOp } from './chips';
import { fetchPill, fieldParam, type FieldRef } from './offer';
import { OP_ICONS, OP_SIGNS, opsOf } from './ops';
import type { PillField } from './pill-key';

/** A table the shown page's charts filter (`page.json`'s `table` of a widget), and the fields they filter it by. */
export interface FilterableTable {
  readonly connection: string;
  /** With its database: `default.http_logs`. */
  readonly table: string;
  /** The first chart on it: its `/columns` answers the table's columns, its `/values` and `/pill` serve each column. */
  readonly widget: PillSource;
  /** Each field once, with the first chart naming it `filterable`: its `/values` and `/pill` serve the field. */
  readonly fields: readonly FilterableField[];
}

export interface FilterableField {
  /** The alias of the field (`host`). */
  readonly field: string;
  readonly widget: PillSource;
  /**
   * More than a column of the table (`page.json`'s `computed`: an expression, a `FilterAs`, a SQL file's field), so
   * "Add filter" lists it as a computed field; else it is one of the table's columns.
   */
  readonly computed: boolean;
}

/** The tables of `widgets` and their children, with their filterable fields, in the order the page has them. */
export function filterableTables(widgets: readonly WidgetNode[]): FilterableTable[] {
  const tables: { connection: string; table: string; widget: PillSource; fields: FilterableField[] }[] = [];
  const visit = (widget: WidgetNode) => {
    if ('table' in widget && widget.table) {
      const connection = widget.connection ?? 'default';
      let table = tables.find((t) => t.table === widget.table && t.connection === connection);
      if (!table) tables.push((table = { connection, table: widget.table, widget, fields: [] }));
      for (const field of widget.filterable ?? []) {
        if (!table.fields.some((f) => f.field === field)) table.fields.push({ field, widget, computed: widget.computed?.includes(field) ?? false });
      }
    }
    if ('children' in widget && widget.children) Object.values(widget.children).forEach(visit);
  };
  widgets.forEach(visit);
  return tables;
}

/**
 * The chart of `tables` that makes pills of `field` on `table` of `connection` (a pill's `pillField`), so that the
 * filter bar can make one again with another op or value: for a `column` the table's first chart, else the first
 * chart naming the field; `undefined` when no chart of the page reads that table or filters it by that field.
 */
export function fieldSource(
  tables: readonly FilterableTable[],
  { connection, table, field, column }: Pick<PillField, 'connection' | 'table' | 'field' | 'column'>,
): PillSource | undefined {
  const shown = tables.find((t) => t.connection === connection && t.table === table);
  return column ? shown?.widget : shown?.fields.find((f) => f.field === field)?.widget;
}

/**
 * The filter bar's "add filter" (as Grafana's ad hoc filters; docs/2026-10-28-workbench.md §3.14 D15, §3.15 D25, D27):
 * asks in quick picks at `anchor` for one of `tables` (none asked when there is only one), one of its columns or
 * computed fields (`fieldItems`), an op of its type (`opsOf`, in a menu; a column's type from the schema, a field's from its
 * chart's `/type` in `query`'s state, asked once the field is chosen, which reads no values, so a time's are never
 * asked), and a value (`askValue`); the value becomes that chart's pill (`fetchPill`), added to the
 * chips of `query`. While `sqlEnabled` (filters.sqlEnabled, §3.15 D26) the first quick pick ends with "SQL condition…"
 * under "Advanced" (its only entry while no chart filters a table), which asks the condition in an input box
 * (`addSqlCondition`). Escape at any step adds nothing; a failed `/pill` goes to the console.
 */
export async function addFilter(
  ui: Pick<UiApi, 'showQuickPick' | 'createQuickPick' | 'showInputBox'>,
  query: Pick<QueryApi, 'get' | 'set' | 'requestParams'>,
  tables: readonly FilterableTable[],
  anchor: MenuAnchor,
  sqlEnabled: boolean,
): Promise<void> {
  const advanced: readonly (SqlItem | QuickPickSeparator)[] = sqlEnabled
    ? [{ kind: QuickPickItemKind.Separator, label: 'Advanced' }, { label: 'SQL condition…', description: 'every query’s WHERE', sql: true }]
    : [];
  let table = tables.length === 1 ? tables[0] : undefined;
  if (!table) {
    const first = await ui.showQuickPick<(QuickPickItem & { table: FilterableTable }) | SqlItem>(
      [...tables.map((t) => ({ label: t.table, description: t.connection, table: t })), ...advanced],
      { anchor, title: 'Add filter', placeholder: tables.length > 0 ? 'The table to filter' : undefined },
    );
    if (first && 'sql' in first) return addSqlCondition(ui, query, anchor);
    table = first?.table;
    if (!table) return;
  }
  const field = await ui.showQuickPick<FieldItem | SqlItem>(
    [...(await fieldItems(table, query.requestParams())), ...(tables.length === 1 ? advanced : [])],
    { anchor, title: 'Add filter', placeholder: `A column or field of ${table.table}` },
  );
  if (field && 'sql' in field) return addSqlCondition(ui, query, anchor);
  if (!field) return;
  const { ref, widget } = field;
  // the type decides the ops; a failed answer leaves it unknown (= and ≠), the value step shows the message
  const first = field.known ?? (await fetchType(widget.dataUrl, ref, query.requestParams()).catch(() => undefined));
  const op = await ui.showQuickPick(
    opsOf(first?.type).map((op) => ({ label: `${ref.field} ${OP_SIGNS[op]} …`, icon: OP_ICONS[op], op })),
    { anchor, title: 'Add filter', menu: true },
  );
  if (!op) return;
  const sign = OP_SIGNS[op.op];
  const value = await askValue(ui, anchor, `${ref.field} ${sign}`, op.op, first, (search, signal) =>
    fetchValues(widget.dataUrl, ref, search, query.requestParams(), signal),
  );
  if (value === undefined) return;
  try {
    const { key } = await fetchPill(widget.dataUrl, { fieldId: ref.field, column: ref.column, op: op.op, value });
    query.set(FILTERS, addChip(query.get(FILTERS), { kind: 'pill', key }));
  } catch (error) {
    console.error(`Filter ${ref.field} ${sign} ${value} failed:`, error);
  }
}

/** A column or a computed field "Add filter" offers, the chart that serves it, a column's type and time range. */
interface FieldItem extends QuickPickItem {
  readonly ref: FieldRef;
  readonly widget: PillSource;
  readonly known?: Omit<Values, 'values'>;
}

/**
 * The entries of "Add filter"'s field step for `table` (§3.15 D27): under "Table columns" each column of the table,
 * with its type, as its first chart's `/columns` answers them in the query state `params` (the schema, so also the
 * columns no chart shows); under "Computed fields" the charts' fields that are more than a column (`computed`), each
 * once. Without the schema (a failed `/columns`, its message beside the heading) the columns are the charts' fields
 * that are one, each made by its chart.
 */
async function fieldItems(table: FilterableTable, params: URLSearchParams): Promise<(FieldItem | QuickPickSeparator)[]> {
  const ofField = (f: FilterableField): FieldItem => ({ label: f.field, ref: { field: f.field }, widget: f.widget });
  const computed = table.fields.filter((f) => f.computed).map(ofField);
  let columns: (FieldItem | QuickPickSeparator)[];
  try {
    const { columns: schema, timeRange } = await fetchColumns(table.widget.dataUrl, params);
    columns = [
      { kind: QuickPickItemKind.Separator, label: 'Table columns' },
      ...schema.map(({ name, type }) => ({ label: name, description: type, ref: { field: name, column: true }, widget: table.widget, known: { type, ...(timeRange ? { timeRange } : {}) } })),
    ];
  } catch (error) {
    columns = [
      { kind: QuickPickItemKind.Separator, label: 'Table columns', description: error instanceof Error ? error.message : String(error) },
      ...table.fields.filter((f) => !f.computed).map(ofField),
    ];
  }
  return [...columns, ...(computed.length > 0 ? [{ kind: QuickPickItemKind.Separator, label: 'Computed fields' } as const, ...computed] : [])];
}

/** "Add filter"'s advanced entry, "SQL condition…". */
interface SqlItem extends QuickPickItem {
  readonly sql: true;
}

/**
 * Asks for a SQL condition (`duration > 2000`) in an input box at `anchor` and adds it to the chips of `query` as a SQL
 * chip; nothing on Escape or a text of only spaces.
 */
async function addSqlCondition(ui: Pick<UiApi, 'showInputBox'>, query: Pick<QueryApi, 'get' | 'set'>, anchor: MenuAnchor): Promise<void> {
  const sql = await ui.showInputBox({
    title: 'SQL condition',
    prompt: 'Added to the WHERE of every query of the page',
    placeholder: "e.g., status = 'active' AND region IN ('us-east', 'eu-west')",
    anchor,
  });
  if (sql !== undefined) query.set(FILTERS, addChip(query.get(FILTERS), { kind: 'sql', sql }));
}

/**
 * Asks for a value to compare by `op` at `anchor`, titled `title`, for a field of the type `known` names (as its
 * `/values` answered): for a time or a day an input box with `current` filled in, else the edge of the time range
 * (its start for `≥`, `>`, `=` and `≠`, its end for `≤` and `<`, now without one) as ISO 8601 in UTC, a day as its
 * date, which ClickHouse reads best effort; else the quick pick of `pickValue`, its first values `known`'s when it
 * has them. Resolves with the value, or `undefined` when it was hidden without.
 */
export function askValue(
  ui: Pick<UiApi, 'createQuickPick' | 'showInputBox'>,
  anchor: MenuAnchor,
  title: string,
  op: FilterOp,
  known: Partial<Values> | undefined,
  load: (search: string, signal: AbortSignal) => Promise<Values>,
  current?: string,
): Promise<string | undefined> {
  const kind = typeKind(known?.type);
  if (kind !== 'time' && kind !== 'day') return pickValue(ui, anchor, title, (search, signal) => load(search, signal).then(({ values }) => values), known?.values);
  const edge = new Date((op === 'le' || op === 'lt' ? known?.timeRange?.to : known?.timeRange?.from) ?? Date.now()).toISOString();
  return ui.showInputBox({
    title,
    anchor,
    value: current ?? (kind === 'day' ? edge.slice(0, 10) : edge),
    prompt: kind === 'day' ? 'A day, e.g. 2026-10-31' : 'A time, e.g. 2026-10-31T10:00:00Z',
  });
}

/** A value `pickValue` offers. */
interface ValueItem extends QuickPickItem {
  readonly value: string;
}

/** How long the typing rests before the values are asked again, in ms. */
const SEARCH_DELAY = 200;

/**
 * Asks for a value in a quick pick at `anchor` titled `title`: the values `load` finds for the typed text (asked at
 * first with '' unless `initial` has them already, again once the typing rests, the request before aborted), and the
 * typed text itself first when it is none of them, so a value beyond the ones found can be chosen. A failed `load`
 * shows its message below the list. Resolves with the value chosen, or `undefined` when the box was hidden without.
 */
export function pickValue(
  ui: Pick<UiApi, 'createQuickPick'>,
  anchor: MenuAnchor,
  title: string,
  load: (search: string, signal: AbortSignal) => Promise<readonly string[]>,
  initial?: readonly string[],
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const box = ui.createQuickPick<ValueItem>();
    box.title = title;
    box.anchor = anchor;
    box.placeholder = 'Type to search the values';
    let found: readonly string[] = [];
    let request: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let picked: string | undefined;
    const draw = () => {
      const typed = box.value;
      box.items = [
        ...(typed !== '' && !found.includes(typed) ? [{ label: typed, description: 'as typed', value: typed }] : []),
        ...found.map((value) => ({ label: value === '' ? '(empty)' : value, value })),
      ];
    };
    const ask = (search: string) => {
      request?.abort();
      const { signal } = (request = new AbortController());
      box.busy = true;
      load(search, signal).then(
        (values) => {
          if (signal.aborted) return;
          found = values;
          box.prompt = undefined;
          box.busy = false;
          draw();
        },
        (error: unknown) => {
          if (signal.aborted) return;
          found = [];
          box.prompt = error instanceof Error ? error.message : String(error);
          box.busy = false;
          draw();
        },
      );
    };
    box.onDidChangeValue((search) => {
      draw();
      clearTimeout(timer);
      timer = setTimeout(() => ask(search), SEARCH_DELAY);
    });
    box.onDidAccept(() => {
      picked = box.selectedItems[0]?.value;
      box.hide();
    });
    box.onDidHide(() => {
      clearTimeout(timer);
      request?.abort();
      box.dispose();
      resolve(picked);
    });
    box.show();
    if (initial) {
      found = initial;
      draw();
    } else ask('');
  });
}

/** What `<dataUrl>/values` answers for a field. */
export interface Values {
  /** The field's ClickHouse type (`DateTime`, `LowCardinality(String)`). */
  readonly type: string;
  /** Its values that contain the search, at most 100, sorted. */
  readonly values: readonly string[];
  /** The time range the server resolved, in ms since the epoch (X-Dashica-Resolved-Time-Range); none without it. */
  readonly timeRange?: { readonly from: number; readonly to: number };
}

/**
 * The type of `field` (a chart's field or a column, `FieldRef`) and its values that contain `search`, as
 * `<dataUrl>/values` answers them in the query state `params`; rejects with the server's message.
 */
export function fetchValues(dataUrl: string, field: FieldRef, search: string, params: URLSearchParams, signal?: AbortSignal): Promise<Values> {
  const asked = new URLSearchParams(params);
  asked.set(...fieldParam(field));
  asked.set('search', search);
  return fetchAnswer(`${dataUrl}/values?${asked}`, signal);
}

/**
 * The type of `field` alone, as `<dataUrl>/type` answers it in the query state `params` without reading the field's
 * values (its `values` are empty, so none are kept: the value step asks them); rejects with the server's message.
 */
export async function fetchType(dataUrl: string, field: FieldRef, params: URLSearchParams): Promise<Omit<Values, 'values'>> {
  const asked = new URLSearchParams(params);
  asked.set(...fieldParam(field));
  const { values: _none, ...type } = await fetchAnswer(`${dataUrl}/type?${asked}`);
  return type;
}

/** A column of a table, as `<dataUrl>/columns` answers it (the server's schema, `clickhouse.SchemaColumn`). */
export interface Column {
  readonly name: string;
  /** Its ClickHouse type (`LowCardinality(String)`). */
  readonly type: string;
}

/**
 * The columns of the table of the chart at `dataUrl`, as `<dataUrl>/columns` answers them in the query state `params`,
 * with the resolved time range (a time column's default value); rejects with the server's message.
 */
export async function fetchColumns(dataUrl: string, params: URLSearchParams): Promise<{ readonly columns: readonly Column[]; readonly timeRange?: Values['timeRange'] }> {
  const response = await fetch(`${dataUrl}/columns?${params}`);
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  const { columns } = (await response.json()) as { columns: readonly Column[] };
  const timeRange = timeRangeOf(response);
  return { columns: columns.map(({ name, type }) => ({ name, type })), ...(timeRange ? { timeRange } : {}) };
}

/** The answer of `/values` or `/type` at `url`, with the resolved time range. */
async function fetchAnswer(url: string, signal?: AbortSignal): Promise<Values> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  const { type, values } = (await response.json()) as Values;
  const timeRange = timeRangeOf(response);
  return { type, values, ...(timeRange ? { timeRange } : {}) };
}

/** The time range the server resolved for `response` (X-Dashica-Resolved-Time-Range); none without the header. */
function timeRangeOf(response: Response): Values['timeRange'] | undefined {
  return (JSON.parse(response.headers.get('X-Dashica-Resolved-Time-Range') || 'null') as Values['timeRange'] | null) ?? undefined;
}
