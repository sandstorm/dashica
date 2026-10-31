// See addFilter.
import type { WidgetNode } from '../../generated/zz_generated.dashica';
import type { FilterOp, PillField, QueryApi } from '../../hosts/query/query';
import type { MenuAnchor, QuickPickItem, UiApi } from '../../hosts/ui/ui';
import type { PillSource } from '../../hosts/widgets/widgets';
import { OP_ICONS, fetchPill } from './offer';

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
 * The filter bar's "add filter" (as Grafana's ad hoc filters; docs/2026-10-28-workbench.md §3.14 D15): asks in quick
 * picks at `anchor` for one of `tables` (none asked when there is only one), one of its fields, `=` or `≠`, and a value
 * (`pickValue`, from the field's chart's `/values` in `query`'s state); the value becomes that chart's pill
 * (`fetchPill`), added to `query`'s filters. Escape at any step adds nothing; a failed `/pill` goes to the console.
 */
export async function addFilter(ui: Pick<UiApi, 'showQuickPick' | 'createQuickPick'>, query: QueryApi, tables: readonly FilterableTable[], anchor: MenuAnchor): Promise<void> {
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
  const op = await ui.showQuickPick(
    [
      { label: `${field.field} = …`, icon: OP_ICONS.eq, op: 'eq' as FilterOp },
      { label: `${field.field} ≠ …`, icon: OP_ICONS.ne, op: 'ne' as FilterOp },
    ],
    { anchor, title: 'Add filter' },
  );
  if (!op) return;
  const sign = op.op === 'eq' ? '=' : '≠';
  const value = await pickValue(ui, anchor, `${field.field} ${sign}`, (search, signal) =>
    fetchValues(field.widget.dataUrl, field.field, search, query.requestParams(), signal),
  );
  if (value === undefined) return;
  try {
    query.filters.add(await fetchPill(field.widget.dataUrl, { fieldId: field.field, op: op.op, value }));
  } catch (error) {
    console.error(`Filter ${field.field} ${sign} ${value} failed:`, error);
  }
}

/** A value `pickValue` offers. */
interface ValueItem extends QuickPickItem {
  readonly value: string;
}

/** How long the typing rests before the values are asked again, in ms. */
const SEARCH_DELAY = 200;

/**
 * Asks for a value in a quick pick at `anchor` titled `title`: the values `load` finds for the typed text (asked at
 * first with '', again once the typing rests, the request before aborted), and the typed text itself first when it is
 * none of them, so a value beyond the ones found can be chosen. A failed `load` shows its message below the list.
 * Resolves with the value chosen, or `undefined` when the box was hidden without.
 */
export function pickValue(
  ui: Pick<UiApi, 'createQuickPick'>,
  anchor: MenuAnchor,
  title: string,
  load: (search: string, signal: AbortSignal) => Promise<readonly string[]>,
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
    ask('');
  });
}

/**
 * The values of `field` that contain `search`, as `<dataUrl>/values` answers them in the query state `params`
 * (at most 100, sorted); rejects with the server's message.
 */
export async function fetchValues(dataUrl: string, field: string, search: string, params: URLSearchParams, signal?: AbortSignal): Promise<string[]> {
  const asked = new URLSearchParams(params);
  asked.set('field', field);
  asked.set('search', search);
  const response = await fetch(`${dataUrl}/values?${asked}`, { signal });
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  return (await response.json()) as string[];
}
