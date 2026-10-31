// See offerFilters.
import type { QueryApi } from '../../hosts/query/query';
import type { MenuAnchor, QuickPickItem, UiApi } from '../../hosts/ui/ui';
import type { FilterCandidate, PillSource } from '../../hosts/widgets/widgets';
import { FILTERS, addChip, type FilterOp, type Pill } from './chips';
import { OP_ICONS, OP_SIGNS, opsOf } from './ops';

/**
 * The command `filters.offer` (docs/2026-10-28-workbench.md §3.8, §3.15 D25): a click on a chart's mark, a table's cell
 * or an Explore view's group row offers, in a quick pick "Filter" at `at` (a menu), to filter by each of `candidates` ("status =
 * 500" with a filter icon) or to exclude it (the same with a minus icon), and for a number or a time to compare with it
 * ("timestamp ≥ 2026-10-31T10:00:00.000Z", a time's `≥` and `≤` first; the ops of its type, `opsOf`), in order, those
 * of them whose field `source` names `filterable`; choosing one asks `source`'s `/pill` for its pill and adds it to
 * the chips of `query` (the active tab's: the click happened in the tab shown). A failed answer adds none, it goes to
 * the console. Nothing without such candidates.
 */
export async function offerFilters(
  ui: Pick<UiApi, 'showQuickPick'>,
  query: Pick<QueryApi, 'get' | 'set'>,
  at: MenuAnchor,
  candidates: readonly FilterCandidate[],
  source: PillSource,
): Promise<void> {
  const items = filterPicks(candidates.filter(({ fieldId }) => source.filterable?.includes(fieldId)));
  if (items.length === 0) return;
  const picked = await ui.showQuickPick(items, { anchor: at, title: 'Filter', menu: true });
  if (!picked) return;
  try {
    const { key } = await fetchPill(source.dataUrl, picked);
    query.set(FILTERS, addChip(query.get(FILTERS), { kind: 'pill', key }));
  } catch (error) {
    console.error(`Filter ${picked.fieldId} failed:`, error);
  }
}

/** What `offerFilters` offers for a candidate: to compare it by `op`. */
interface FilterPick extends QuickPickItem, FilterCandidate {
  readonly op: FilterOp;
}

/**
 * For each candidate in order, one pick per op of its type: "<field> = <value>" to filter by it (a filter icon) and to
 * exclude it (a minus icon), "<field> ≥ <value>" and the like to compare with it (a chevron).
 */
function filterPicks(candidates: readonly FilterCandidate[]): FilterPick[] {
  return candidates.flatMap((candidate) =>
    opsOf(candidate.type).map((op) => ({
      label: `${candidate.fieldId} ${op === 'ne' ? '=' : OP_SIGNS[op]} ${candidate.value}`,
      icon: OP_ICONS[op],
      ...candidate,
      op,
    })),
  );
}

/**
 * What a pill filters by (docs/2026-10-28-workbench.md §3.15 D27): a chart's field by its alias, or with `column` a
 * column of the chart's table by its name.
 */
export interface FieldRef {
  readonly field: string;
  readonly column?: boolean;
}

/** `ref` as `/pill`, `/values` and `/type` take it: `field=<alias>`, or `column=<name>` for a column. */
export function fieldParam(ref: FieldRef): [string, string] {
  return [ref.column ? 'column' : 'field', ref.field];
}

/**
 * The pill `<dataUrl>/pill` makes of `fieldId` `op` `value` (a click's choice, "Add filter", an edited chip), its key
 * (the chip reads its label from it, `pillLabel`); with `column` the pill on that column of the chart's table
 * (`fieldParam`, §3.15 D27).
 * Rejects with the server's message (a field that cannot filter: 422).
 */
export async function fetchPill(
  dataUrl: string,
  { fieldId, column, op, value }: Pick<FilterCandidate, 'fieldId' | 'value'> & { readonly op: FilterOp; readonly column?: boolean },
): Promise<Pill> {
  const asked = new URLSearchParams([fieldParam({ field: fieldId, column }), ['op', op], ['value', value]]);
  const response = await fetch(`${dataUrl}/pill?${asked}`);
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  const { key } = (await response.json()) as Pill;
  return { key };
}
