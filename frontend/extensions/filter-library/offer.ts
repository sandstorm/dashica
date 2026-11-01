import type { Commands } from '../../hosts/commands/commands';
import type { MenuAnchor } from '../../hosts/ui/ui';

/**
 * The command a click to filter runs (docs/2026-10-28-workbench.md §3.8): a chart's mark, a table's cell or an Explore
 * view's group row hands it its point, its candidates and the widget's `PillSource`; the `filters` extension registers
 * it and shows the quick pick. This folder is the contract between the charts, the Explore view and the `filters`
 * extension, as `time-library` is the one of the time range.
 */
export const OFFER = 'filters.offer';

/**
 * The widget whose `<dataUrl>/pill` makes the pills a click offers, and the aliases of its fields that make one
 * (`page.json`'s `filterable`): the last argument of `filters.offer`.
 */
export interface PillSource {
  readonly dataUrl: string;
  readonly filterable?: readonly string[];
}

/** A category's value a click offers to filter by (a bar's category, its fill, a table cell). */
export interface FilterCandidate {
  /** The alias of the clicked field's column (`host`), the field its widget's `/pill` makes the pill of. */
  readonly fieldId: string;
  /** As the pill compares it: a time as ISO 8601 in UTC (`2026-10-31T10:00:00.000Z`), anything else as it shows. */
  readonly value: string;
  /** The field's ClickHouse type (`DateTime`, `LowCardinality(String)`), by which the ops are offered; unknown without. */
  readonly type?: string;
}

/** Offers to filter by or exclude each of `candidates` at `at` (a click's point, a cell). */
export type OfferFilters = (at: MenuAnchor, candidates: readonly FilterCandidate[]) => void;

/**
 * How a click on `widget`'s marks, cells or rows offers its candidates: it runs the command `filters.offer` with them
 * and the widget's `dataUrl` and `filterable` (whose `/pill` makes the pill, which fields make one). The `filters`
 * extension shows the quick pick; without it a click offers nothing (the unknown command goes to the console).
 */
export function offerFiltersOf(commands: Pick<Commands, 'executeCommand'>, { dataUrl, filterable }: PillSource): OfferFilters {
  return (at, candidates) => {
    commands.executeCommand(OFFER, at, candidates, { dataUrl, filterable }).catch((error: unknown) => console.error(`Command ${OFFER} failed:`, error));
  };
}
