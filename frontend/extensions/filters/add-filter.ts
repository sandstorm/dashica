// See addFilter.
import type { WidgetNode } from '../../generated/zz_generated.dashica';
import type { QueryApi } from '../../hosts/query/query';
import type { MenuAnchor, QuickPickItem, UiApi } from '../../hosts/ui/ui';
import type { PillSource } from '../../hosts/widgets/widgets';
import { typeKind } from '../widget-library/clickhouse-type';
import { FILTERS, addChip, type FilterOp } from './chips';
import { fetchPill } from './offer';
import { OP_ICONS, OP_SIGNS, opsOf } from './ops';
import type { PillField } from './pill-key';

/** A table the shown page's charts filter (`page.json`'s `table` of a widget), and the fields they filter it by. */
export interface FilterableTable {
  readonly connection: string;
  /** With its database: `default.http_logs`. */
  readonly table: string;
  /** Each field once, with the first chart naming it `filterable`: its `/values` and `/pill` serve the field. */
  readonly fields: readonly FilterableField[];
}

export interface FilterableField {
  /** The alias of the field (`host`). */
  readonly field: string;
  readonly widget: PillSource;
}

/** The tables of `widgets` and their children with filterable fields, in the order the page has them. */
export function filterableTables(widgets: readonly WidgetNode[]): FilterableTable[] {
  const tables: { connection: string; table: string; fields: FilterableField[] }[] = [];
  const visit = (widget: WidgetNode) => {
    if ('table' in widget && widget.table && widget.filterable?.length) {
      const connection = widget.connection ?? 'default';
      let table = tables.find((t) => t.table === widget.table && t.connection === connection);
      if (!table) tables.push((table = { connection, table: widget.table, fields: [] }));
      for (const field of widget.filterable) {
        if (!table.fields.some((f) => f.field === field)) table.fields.push({ field, widget });
      }
    }
    if ('children' in widget && widget.children) Object.values(widget.children).forEach(visit);
  };
  widgets.forEach(visit);
  return tables;
}

/**
 * The chart of `tables` that makes pills of `field` on `table` of `connection` (a pill's `pillField`), so that the
 * filter bar can make one again with another op or value; `undefined` when no chart of the page filters that table by
 * that field.
 */
export function fieldSource(tables: readonly FilterableTable[], { connection, table, field }: Pick<PillField, 'connection' | 'table' | 'field'>): PillSource | undefined {
  return tables.find((t) => t.connection === connection && t.table === table)?.fields.find((f) => f.field === field)?.widget;
}

/**
 * The filter bar's "add filter" (as Grafana's ad hoc filters; docs/2026-10-28-workbench.md §3.14 D15, §3.15 D25): asks
 * in quick picks at `anchor` for one of `tables` (none asked when there is only one), one of its fields, an op of the
 * field's type (`opsOf`; the type from the field's chart's `/type` in `query`'s state, asked once the field is chosen,
 * which reads no values, so a time's are never asked), and a value (`askValue`); the value becomes that chart's pill (`fetchPill`, with the
 * type), added to the chips of `query`. Escape at any step adds nothing; a failed `/pill` goes to the console.
 */
export async function addFilter(
  ui: Pick<UiApi, 'showQuickPick' | 'createQuickPick' | 'showInputBox'>,
  query: Pick<QueryApi, 'get' | 'set' | 'requestParams'>,
  tables: readonly FilterableTable[],
  anchor: MenuAnchor,
): Promise<void> {
  const table =
    tables.length === 1
      ? tables[0]
      : (await ui.showQuickPick(tables.map((t) => ({ label: t.table, description: t.connection, table: t })), { anchor, title: 'Add filter', placeholder: 'The table to filter' }))?.table;
  if (!table) return;
  const field = await ui.showQuickPick(
    table.fields.map((f) => ({ label: f.field, ...f })),
    { anchor, title: 'Add filter', placeholder: `A field of ${table.table}` },
  );
  if (!field) return;
  // the type decides the ops; a failed answer leaves it unknown (= and ≠), the value step shows the message
  const first = await fetchType(field.widget.dataUrl, field.field, query.requestParams()).catch(() => undefined);
  const op = await ui.showQuickPick(
    opsOf(first?.type).map((op) => ({ label: `${field.field} ${OP_SIGNS[op]} …`, icon: OP_ICONS[op], op })),
    { anchor, title: 'Add filter' },
  );
  if (!op) return;
  const sign = OP_SIGNS[op.op];
  const value = await askValue(ui, anchor, `${field.field} ${sign}`, op.op, first, (search, signal) =>
    fetchValues(field.widget.dataUrl, field.field, search, query.requestParams(), signal),
  );
  if (value === undefined) return;
  try {
    const { key } = await fetchPill(field.widget.dataUrl, { fieldId: field.field, op: op.op, value, type: first?.type });
    query.set(FILTERS, addChip(query.get(FILTERS), { kind: 'pill', key }));
  } catch (error) {
    console.error(`Filter ${field.field} ${sign} ${value} failed:`, error);
  }
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
 * The type of `field` and its values that contain `search`, as `<dataUrl>/values` answers them in the query state
 * `params`; rejects with the server's message.
 */
export function fetchValues(dataUrl: string, field: string, search: string, params: URLSearchParams, signal?: AbortSignal): Promise<Values> {
  const asked = new URLSearchParams(params);
  asked.set('field', field);
  asked.set('search', search);
  return fetchAnswer(`${dataUrl}/values?${asked}`, signal);
}

/**
 * The type of `field` alone, as `<dataUrl>/type` answers it in the query state `params` without reading the field's
 * values (its `values` are empty, so none are kept: the value step asks them); rejects with the server's message.
 */
export async function fetchType(dataUrl: string, field: string, params: URLSearchParams): Promise<Omit<Values, 'values'>> {
  const asked = new URLSearchParams(params);
  asked.set('field', field);
  const { values: _none, ...type } = await fetchAnswer(`${dataUrl}/type?${asked}`);
  return type;
}

/** The answer of `/values` or `/type` at `url`, with the resolved time range. */
async function fetchAnswer(url: string, signal?: AbortSignal): Promise<Values> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  const { type, values } = (await response.json()) as Values;
  const timeRange = JSON.parse(response.headers.get('X-Dashica-Resolved-Time-Range') || 'null') as Values['timeRange'] | null;
  return { type, values, ...(timeRange ? { timeRange } : {}) };
}
