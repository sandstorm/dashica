// See offerFilters.
import { Filter, Minus, createElement } from 'lucide';
import type { FilterOp, Pill, QueryApi } from '../../hosts/query/query';
import type { MenuAnchor, QuickPickIcon, QuickPickItem, UiApi } from '../../hosts/ui/ui';
import type { FilterCandidate, PillSource } from '../../hosts/widgets/widgets';

/**
 * The command `filters.offer` (docs/2026-10-28-workbench.md §3.8): a click on a chart's mark, a table's cell or an
 * Explore view's group row offers, in a quick pick "Filter" at `at`, to filter by each of `candidates` ("status = 500"
 * with a filter icon) or to exclude it (the same with a minus icon), in order, those of them whose field `source` names
 * `filterable`; choosing one asks `source`'s `/pill` for its pill and adds it to `query`'s filters (the active tab's:
 * the click happened in the tab shown). A failed answer adds none, it goes to the console. Nothing without such
 * candidates.
 */
export async function offerFilters(
  ui: Pick<UiApi, 'showQuickPick'>,
  query: QueryApi,
  at: MenuAnchor,
  candidates: readonly FilterCandidate[],
  source: PillSource,
): Promise<void> {
  const items = filterPicks(candidates.filter(({ fieldId }) => source.filterable?.includes(fieldId)));
  if (items.length === 0) return;
  const picked = await ui.showQuickPick(items, { anchor: at, title: 'Filter' });
  if (!picked) return;
  try {
    query.filters.add(await fetchPill(source.dataUrl, picked));
  } catch (error) {
    console.error(`Filter ${picked.fieldId} failed:`, error);
  }
}

/** What `offerFilters` offers for a candidate: to filter by it (`eq`) or to exclude it (`ne`). */
interface FilterPick extends QuickPickItem, FilterCandidate {
  readonly op: FilterOp;
}

/**
 * The quick pick icon of each op, shared by a chart click (`filterPicks`) and "Add filter": a filter icon to filter by
 * (`eq`), a minus to exclude (`ne`).
 */
export const OP_ICONS: Readonly<Record<FilterOp, QuickPickIcon>> = {
  eq: { svg: createElement(Filter).outerHTML, label: 'Filter' },
  ne: { svg: createElement(Minus).outerHTML, label: 'Exclude' },
};

/** For each candidate in order, "<field> = <value>" to filter by it (a filter icon), then to exclude it (a minus icon). */
function filterPicks(candidates: readonly FilterCandidate[]): FilterPick[] {
  return candidates.flatMap(({ fieldId, value }) => {
    const label = `${fieldId} = ${value}`;
    return [
      { label, icon: OP_ICONS.eq, fieldId, value, op: 'eq' as const },
      { label, icon: OP_ICONS.ne, fieldId, value, op: 'ne' as const },
    ];
  });
}

/**
 * The pill `<dataUrl>/pill` makes of `fieldId` `op` `value` (a click's choice, "Add filter", an edited chip); rejects
 * with the server's message (a field that cannot filter: 422).
 */
export async function fetchPill(dataUrl: string, { fieldId, op, value }: FilterCandidate & { readonly op: FilterOp }): Promise<Pill> {
  const response = await fetch(`${dataUrl}/pill?${new URLSearchParams({ field: fieldId, op, value })}`);
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  const { key, label } = (await response.json()) as Pill;
  return { key, label };
}
