// See filters in filters.ts.
import type { WidgetNode } from '../../generated/zz_generated.dashica';
import type { QueryApi } from '../../hosts/query/query';
import { QuickPickItemKind, type MenuAnchor, type QuickPickItem, type QuickPickSeparator, type UiApi } from '../../hosts/ui/ui';
import { typeKind } from '../widget-library/clickhouse-type';
import { FILTERS, addChip, type FilterOp } from './chips';
import { fetchPill, fieldParam, type FieldRef, type PillSource } from './offer';
import { OP_ICONS, OP_SIGNS, opsOf } from './ops';
import type { PillField } from './pill-key';

/**
 * The filter bar's "Add filter": asks in quick picks at `anchor` for one of `tables` (none asked when there is only
 * one), one of its columns or computed fields (`fieldItems`, with their types from the charts' `/fields` in `query`'s
 * state, kept in `fields`; its quick pick opens at once, busy until they answer), an op of its type (`opsOf`, in a
 * menu, asking nothing more; a time's values are never asked), and a value (`askValue`); the value becomes that
 * chart's pill (`fetchPill`), added to the chips of `query`. With `askSql` (sql_filter_enabled) the first quick pick
 * ends with "SQL condition…" under "Advanced" (its only entry while no chart filters a table), which asks the
 * condition in the SQL input box (`addSqlCondition`). Escape at any step adds nothing; a failed `/pill` shows the
 * server's message in the value's still-open box.
 */
export async function addFilter(
  ui: Pick<UiApi, 'showQuickPick' | 'createQuickPick' | 'showInputBox'>,
  query: Pick<QueryApi, 'get' | 'set' | 'requestParams'>,
  tables: readonly FilterableTable[],
  anchor: MenuAnchor,
  fields: FieldsCache,
  askSql?: AskSql,
): Promise<void> {
  const advanced: readonly (SqlItem | QuickPickSeparator)[] = askSql
    ? [{ kind: QuickPickItemKind.Separator, label: 'Advanced' }, { label: 'SQL condition…', description: 'every query’s WHERE', sql: true }]
    : [];
  let table = tables.length === 1 ? tables[0] : undefined;
  if (!table) {
    const first = await ui.showQuickPick<(QuickPickItem & { table: FilterableTable }) | SqlItem>(
      [...tables.map((t) => ({ label: t.table, description: t.connection, table: t })), ...advanced],
      { anchor, title: 'Add filter', placeholder: tables.length > 0 ? 'The table to filter' : undefined },
    );
    if (first && 'sql' in first) return addSqlCondition(askSql!, query, anchor);
    table = first?.table;
    if (!table) return;
  }
  // opens at once, busy while the charts' `/fields` answer
  const field = await ui.showQuickPick<FieldItem | SqlItem>(
    fieldItems(table, fields, query.requestParams()).then((items) => [...items, ...(tables.length === 1 ? advanced : [])]),
    { anchor, title: 'Add filter', placeholder: `A column or field of ${table.table}` },
  );
  if (field && 'sql' in field) return addSqlCondition(askSql!, query, anchor);
  if (!field) return;
  const { ref, widget, known } = field;
  // the type decides the ops; without one (a failed `/fields`) they are = and ≠
  const op = await ui.showQuickPick(
    opsOf(known?.type).map((op) => ({ label: `${ref.field} ${OP_SIGNS[op]} …`, icon: OP_ICONS[op], op })),
    { anchor, title: 'Add filter', menu: true },
  );
  if (!op) return;
  const sign = OP_SIGNS[op.op];
  await askValue(
    ui,
    anchor,
    `${ref.field} ${sign}`,
    op.op,
    known,
    (search, signal) => fetchValues(widget.dataUrl, ref, search, query.requestParams(), signal),
    async (value) => {
      const { key } = await fetchPill(widget.dataUrl, { field: ref.field, column: ref.column, op: op.op, value });
      query.set(FILTERS, addChip(query.get(FILTERS), { kind: 'pill', key }));
    },
  );
}

/** A table the shown page's charts filter (`page.json`'s `table` of a widget), and the fields they filter it by. */
export interface FilterableTable {
  readonly connection: string;
  /** With its database: `default.http_logs`. */
  readonly table: string;
  /** The first chart on it: its `/fields` answers the table's columns, its `/values` and `/pill` serve each column. */
  readonly widget: PillSource;
  /** Each field once, with the first chart naming it `filterable`: its `/fields`, `/values` and `/pill` serve the field. */
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
 * Asks for SQL (a condition) in an input box at `options.anchor`, while the server takes SQL chips (sql_filter_enabled):
 * the filters extension's SQL editor in it (`showSqlInputBox`). Resolves with the text, or `undefined` without.
 */
export type AskSql = (options: { readonly title: string; readonly prompt?: string; readonly placeholder?: string; readonly value?: string; readonly anchor: MenuAnchor }) => Promise<string | undefined>;

/** The line below a SQL condition's field. */
export const SQL_PROMPT = 'Added to the WHERE of every query of the page; Shift+Enter for a new line';

/** A SQL condition's field while it is empty. */
export const SQL_PLACEHOLDER = "e.g., status = 'active' AND region IN ('us-east', 'eu-west')";

/**
 * Asks for a value to compare by `op` at `anchor`, titled `title`, for a field of the type `known` names (as its
 * chart's `/fields` answered): for a time or a day an input box with `current` filled in, else the edge of `known`'s
 * time range (its start for `≥`, `>`, `=` and `≠`, its end for `≤` and `<`, now without one) as ISO 8601 in UTC, a
 * day as its date, which ClickHouse reads best effort; else the quick pick of `pickValue`, the values from `load`.
 * A type still to come (a Promise: a chip's `/fields` not asked yet) opens the value's quick pick at once, busy
 * until it is there; a time's or a day's input box then takes its place. Choosing a value runs `accept` with it (the
 * pill made of it), the box open and busy meanwhile, its error shown in the box (`QuickPickOptions.accept`). Resolves
 * with the value, or `undefined` when it was hidden without.
 */
export function askValue(
  ui: Pick<UiApi, 'createQuickPick' | 'showInputBox'>,
  anchor: MenuAnchor,
  title: string,
  op: FilterOp,
  known: FieldType | undefined | Promise<FieldType | undefined>,
  load: (search: string, signal: AbortSignal) => Promise<readonly string[]>,
  accept: (value: string) => Promise<unknown>,
  current?: string,
): Promise<string | undefined> {
  const inputBox = (type: FieldType | undefined): AskInstead | undefined => {
    const kind = typeKind(type?.type);
    if (kind !== 'time' && kind !== 'day') return undefined;
    const edge = new Date((op === 'le' || op === 'lt' ? type?.timeRange?.to : type?.timeRange?.from) ?? Date.now()).toISOString();
    return () =>
      ui.showInputBox({
        title,
        anchor,
        value: current ?? (kind === 'day' ? edge.slice(0, 10) : edge),
        prompt: kind === 'day' ? 'A day, e.g. 2026-10-31' : 'A time, e.g. 2026-10-31T10:00:00Z',
        accept,
      });
  };
  if (!(known instanceof Promise)) return inputBox(known)?.() ?? pickValue(ui, anchor, title, load, accept);
  return pickValue(ui, anchor, title, load, accept, known.then(inputBox, () => undefined));
}

/**
 * Asks for a value in a quick pick at `anchor` titled `title`: the values `load` finds for the typed text (asked at
 * first with '', again once the typing rests, the request before aborted; busy while one is out), and the
 * typed text itself first when it is none of them, so a value beyond the ones found can be chosen. A failed `load`
 * shows its message below the list. Choosing a value runs `accept` with it, the box open and busy until it settles;
 * a failed one shows its error in the box's message line. With `instead` the box waits busy for it before asking: a
 * box it names takes the box's place. Resolves with the value chosen, or `undefined` when the box was hidden without.
 */
export function pickValue(
  ui: Pick<UiApi, 'createQuickPick'>,
  anchor: MenuAnchor,
  title: string,
  load: (search: string, signal: AbortSignal) => Promise<readonly string[]>,
  accept: (value: string) => Promise<unknown>,
  instead?: Promise<AskInstead | undefined>,
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
    let ready = instead === undefined;
    let hidden = false;
    let replaced = false;
    let accepting = false;
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
      if (ready) timer = setTimeout(() => ask(search), SEARCH_DELAY);
    });
    box.onDidAccept(() => {
      const value = box.selectedItems[0]?.value;
      if (value === undefined || accepting) return;
      accepting = true;
      box.busy = true;
      box.message = undefined;
      accept(value).then(
        () => {
          picked = value;
          box.hide();
        },
        (error: unknown) => {
          if (hidden) console.error(`${title} failed:`, error);
          accepting = false;
          box.busy = false;
          box.message = error instanceof Error ? error.message : String(error);
        },
      );
    });
    box.onDidHide(() => {
      hidden = true;
      clearTimeout(timer);
      request?.abort();
      box.dispose();
      if (!replaced) resolve(picked);
    });
    box.show();
    if (!instead) return ask('');
    box.busy = true;
    void instead.then((other) => {
      if (hidden) return;
      if (other) {
        replaced = true;
        box.hide();
        return resolve(other());
      }
      ready = true;
      ask(box.value);
    });
  });
}

/** The time range the server resolved, in ms since the epoch (X-Dashica-Resolved-Time-Range). */
export interface ResolvedTimeRange {
  readonly from: number;
  readonly to: number;
}

/**
 * The values of `field` (a chart's field or a column, `FieldRef`) that contain `search`, at most 100, sorted, as
 * `<dataUrl>/values` answers them in the query state `params`; rejects with the server's message.
 */
export async function fetchValues(dataUrl: string, field: FieldRef, search: string, params: URLSearchParams, signal?: AbortSignal): Promise<readonly string[]> {
  const asked = new URLSearchParams(params);
  asked.set(...fieldParam(field));
  asked.set('search', search);
  const response = await fetch(`${dataUrl}/values?${asked}`, { signal });
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  const { values } = (await response.json()) as { values: readonly string[] };
  return values;
}

/** A column of a table or a computed field of a chart, as `<dataUrl>/fields` answers it. */
export interface Column {
  readonly name: string;
  /** Its ClickHouse type (`LowCardinality(String)`). */
  readonly type: string;
}

/** What `<dataUrl>/fields` answers for a chart. */
export interface Fields {
  /** The columns of its table, from the server's schema. */
  readonly columns: readonly Column[];
  /** Its fields that are more than a column (`page.json`'s `computed`), by alias. */
  readonly computed: readonly Column[];
  /** The time range the server resolved; none without the header. */
  readonly timeRange?: ResolvedTimeRange;
}

/** The type of a field and the time range of its chart's answer: what the op and value steps go by. */
export interface FieldType {
  readonly type: string;
  readonly timeRange?: ResolvedTimeRange;
}

/**
 * The type of `ref` in `fields`: a column's among the columns, a chart's field among the computed fields, else the
 * column of its name (a field that is a column); `undefined` for one it does not have.
 */
export function typeIn(fields: Fields, ref: FieldRef): FieldType | undefined {
  const named = (columns: readonly Column[]) => columns.find((c) => c.name === ref.field);
  const found = (ref.column ? undefined : named(fields.computed)) ?? named(fields.columns);
  return found && { type: found.type, ...(fields.timeRange ? { timeRange: fields.timeRange } : {}) };
}

/**
 * The fields of the chart at `dataUrl`, as `<dataUrl>/fields` answers them in the query state `params`, with the
 * resolved time range (a time's default value); rejects with the server's message.
 */
export async function fetchFields(dataUrl: string, params: URLSearchParams): Promise<Fields> {
  const response = await fetch(`${dataUrl}/fields?${params}`);
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  const { columns, computed } = (await response.json()) as Fields;
  const timeRange = JSON.parse(response.headers.get('X-Dashica-Resolved-Time-Range') || 'null') as ResolvedTimeRange | null;
  return { columns, computed, ...(timeRange ? { timeRange } : {}) };
}

/**
 * The charts' `/fields` answers (`fetchFields`), one kept per chart for the query state it was asked in without the
 * filter chips (`FILTERS`: pills and SQL chips change no field's type), so that "Add filter" and the filter bar's
 * edits ask a chart once; another state (a new time range) asks again, a failed answer is not kept.
 */
export class FieldsCache {
  readonly #answers = new Map<string, { readonly params: string; readonly answer: Promise<Fields> }>();

  /** The fields of the chart at `dataUrl` in the query state `params`. */
  get(dataUrl: string, params: URLSearchParams): Promise<Fields> {
    const asked = new URLSearchParams([...params].filter(([key]) => !FILTERS.urlKeys.includes(key)));
    const kept = this.#answers.get(dataUrl);
    if (kept && kept.params === asked.toString()) return kept.answer;
    const answer = fetchFields(dataUrl, asked);
    this.#answers.set(dataUrl, { params: asked.toString(), answer });
    answer.catch(() => {
      if (this.#answers.get(dataUrl)?.answer === answer) this.#answers.delete(dataUrl);
    });
    return answer;
  }
}

/** "Add filter"'s advanced entry, "SQL condition…". */
interface SqlItem extends QuickPickItem {
  readonly sql: true;
}

/**
 * Asks for a SQL condition (`duration > 2000`) by `askSql` at `anchor` and adds it to the chips of `query` as a SQL
 * chip; nothing on Escape or a text of only spaces.
 */
async function addSqlCondition(askSql: AskSql, query: Pick<QueryApi, 'get' | 'set'>, anchor: MenuAnchor): Promise<void> {
  const sql = await askSql({ title: 'SQL condition', prompt: SQL_PROMPT, placeholder: SQL_PLACEHOLDER, anchor });
  if (sql !== undefined) query.set(FILTERS, addChip(query.get(FILTERS), { kind: 'sql', sql }));
}

/** A column or a computed field "Add filter" offers, the chart that serves it, its type and the time range. */
interface FieldItem extends QuickPickItem {
  readonly ref: FieldRef;
  readonly widget: PillSource;
  readonly known?: FieldType;
}

/**
 * The entries of "Add filter"'s field step for `table`: under "Table columns" each column of the
 * table, with its type, as its first chart's `/fields` answers them in the query state `params` (the schema, so also
 * the columns no chart shows); under "Computed fields" the charts' fields that are more than a column (`computed`),
 * each once, with its type as its chart's `/fields` answers it. Each chart's `/fields` is asked once, all at once,
 * through `fields`. Without the schema (a failed `/fields`, its message beside the heading) the columns are the
 * charts' fields that are one, each made by its chart.
 */
async function fieldItems(table: FilterableTable, fields: FieldsCache, params: URLSearchParams): Promise<(FieldItem | QuickPickSeparator)[]> {
  const answerOf = (widget: PillSource) => fields.get(widget.dataUrl, params);
  const ofField = (f: FilterableField, answer?: Fields): FieldItem => {
    const known = answer && typeIn(answer, { field: f.field });
    return { label: f.field, ref: { field: f.field }, widget: f.widget, ...(known ? { description: known.type, known } : {}) };
  };
  const [schema, ...computed] = await Promise.all([
    answerOf(table.widget).then(
      (answer) => ({ answer }),
      (error: unknown) => ({ error }),
    ),
    ...table.fields.filter((f) => f.computed).map((f) => answerOf(f.widget).then((answer) => ofField(f, answer), () => ofField(f))),
  ]);
  const columns: (FieldItem | QuickPickSeparator)[] =
    'answer' in schema
      ? [
          { kind: QuickPickItemKind.Separator, label: 'Table columns' },
          ...schema.answer.columns.map(({ name }) => {
            const known = typeIn(schema.answer, { field: name, column: true })!;
            return { label: name, description: known.type, ref: { field: name, column: true }, widget: table.widget, known };
          }),
        ]
      : [
          { kind: QuickPickItemKind.Separator, label: 'Table columns', description: schema.error instanceof Error ? schema.error.message : String(schema.error) },
          ...table.fields.filter((f) => !f.computed).map((f) => ofField(f)),
        ];
  return [...columns, ...(computed.length > 0 ? [{ kind: QuickPickItemKind.Separator, label: 'Computed fields' } as const, ...computed] : [])];
}

/** Asks for the value in a box of its own (a time's input box) in place of `pickValue`'s. */
type AskInstead = () => Promise<string | undefined>;

/** A value `pickValue` offers. */
interface ValueItem extends QuickPickItem {
  readonly value: string;
}

/** How long the typing rests before the values are asked again, in ms. */
const SEARCH_DELAY = 200;
