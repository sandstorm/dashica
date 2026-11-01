// See filters in filters.ts.
import type { QueryApi } from '../../hosts/query/query';
import type { DataPointMenuItem, DataPointMenuProvider } from '../../hosts/widgets/widgets';
import { FILTERS, addChip, type FilterOp, type Pill } from './chips';
import { OP_ICONS, OP_SIGNS, opsOf } from './ops';

/**
 * What a click on a chart's mark, a table's cell or an Explore view's group row offers to filter by: in the widgets
 * host's data point menu, for each data point whose field the widget names `filterable` (page.json's), in order, one
 * item per op of its type (`opsOf`), each with its own sign: "status = 500" to filter by it (a filter icon), "status ≠ 500" to exclude it (a minus icon), for a number or a
 * time "timestamp ≥ 2026-10-31T10:00:00.000Z" and the like to compare with it (a chevron; a time's `≥` and `≤` first).
 * Each runs `filters.addPill` with the widget's `dataUrl`, whose `/pill` makes the pill. None for a widget without
 * filterable fields.
 */
export const filterMenuProvider: DataPointMenuProvider = {
  provideDataPointMenuItems({ widget }, dataPoints): readonly DataPointMenuItem[] {
    if (!('dataUrl' in widget) || !('filterable' in widget) || !widget.filterable) return [];
    const { dataUrl, filterable } = widget;
    return dataPoints
      .filter(({ field }) => filterable.includes(field))
      .flatMap(({ field, value, type }) =>
        opsOf(type).map((op) => ({
          label: `${field} ${OP_SIGNS[op]} ${value}`,
          icon: OP_ICONS[op],
          command: ADD_PILL,
          arguments: [dataUrl, field, op, value],
        })),
      );
  },
};

/** The command a data point menu's filter runs (`(dataUrl, field, op, value)`), which `addPill` does. */
export const ADD_PILL = 'filters.addPill';

/**
 * Adds the pill `<dataUrl>/pill` makes of `field` `op` `value` to the chips of `query` (the active tab's: the click
 * happened in the tab shown). Rejects with the server's message, adding none: the data point menu, still open, shows it.
 */
export async function addPill(query: Pick<QueryApi, 'get' | 'set'>, dataUrl: string, field: string, op: FilterOp, value: string): Promise<void> {
  const { key } = await fetchPill(dataUrl, { field, op, value });
  query.set(FILTERS, addChip(query.get(FILTERS), { kind: 'pill', key }));
}

/**
 * The widget whose `<dataUrl>/pill` makes a pill, and the aliases of its fields that make one (`page.json`'s
 * `filterable`): what "Add filter" and a chip's edit ask.
 */
export interface PillSource {
  readonly dataUrl: string;
  readonly filterable?: readonly string[];
}

/**
 * What a pill filters by: a chart's field by its alias, or with `column` a column of the chart's table by its name.
 */
export interface FieldRef {
  readonly field: string;
  readonly column?: boolean;
}

/** `ref` as `/pill` and `/values` take it: `field=<alias>`, or `column=<name>` for a column. */
export function fieldParam(ref: FieldRef): [string, string] {
  return [ref.column ? 'column' : 'field', ref.field];
}

/**
 * The pill `<dataUrl>/pill` makes of `field` `op` `value` (a click's choice, "Add filter", an edited chip), its key
 * (the chip reads its label from it, `pillLabel`); with `column` the pill on that column of the chart's table
 * (`fieldParam`). Rejects with the server's message (a field that cannot filter: 422).
 */
export async function fetchPill(
  dataUrl: string,
  { field, column, op, value }: { readonly field: string; readonly column?: boolean; readonly op: FilterOp; readonly value: string },
): Promise<Pill> {
  const asked = new URLSearchParams([fieldParam({ field, column }), ['op', op], ['value', value]]);
  const response = await fetch(`${dataUrl}/pill?${asked}`);
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  const { key } = (await response.json()) as Pill;
  return { key };
}
