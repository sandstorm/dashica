// Test helper for the charts' click to filter: the command `filters.offer` recorded in place of the `filters` extension.
import type { Commands } from '../../hosts/commands/commands';
import type { MenuAnchor } from '../../hosts/ui/ui';
import { OFFER, type FilterCandidate, type PillSource } from '../filter-library/offer';

/** One run of `filters.offer`: a click's point, its candidates, the widget's pills. */
export interface RecordedOffer {
  readonly at: MenuAnchor;
  readonly candidates: readonly FilterCandidate[];
  readonly source: PillSource;
}

/**
 * Registers `filters.offer` on `commands` (a testbed's), recording each run into the returned list, in order; the
 * registration ends with `commands`.
 */
export function recordOffers(commands: Pick<Commands, 'registerCommand'>): RecordedOffer[] {
  const offers: RecordedOffer[] = [];
  commands.registerCommand(OFFER, (at: MenuAnchor, candidates: readonly FilterCandidate[], source: PillSource) => void offers.push({ at, candidates, source }));
  return offers;
}
