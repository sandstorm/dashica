// See opsOf, OP_SIGNS and OP_ICONS.
import { ChevronLeft, ChevronRight, Filter, Minus, createElement } from 'lucide';
import type { QuickPickIcon } from '../../hosts/ui/ui';
import { typeKind } from '../widget-library/clickhouse-type';
import { FILTER_OPS, type FilterOp } from './chips';

/**
 * The ops a field of ClickHouse type `type` offers, in the order the quick picks show them (docs/2026-10-28-workbench.md
 * §3.15 D25): text (a String, an Enum, a Bool, an unknown type) `=` and `≠`; a number also `<`, `≤`, `>`, `≥`; a time or
 * a day `≥` and `≤` first, then `>`, `<`, `=`, `≠`.
 */
export function opsOf(type: string | undefined): readonly FilterOp[] {
  const kind = typeKind(type);
  if (kind === 'time' || kind === 'day') return ['ge', 'le', 'gt', 'lt', 'eq', 'ne'];
  if (kind === 'number') return FILTER_OPS;
  return ['eq', 'ne'];
}

/** The sign a chip and a quick pick show for each op (`sql.Op.Sign`). */
export const OP_SIGNS: Readonly<Record<FilterOp, string>> = { eq: '=', ne: '≠', lt: '<', le: '≤', gt: '>', ge: '≥' };

/**
 * The quick pick icon of each op, shared by a click's offer and "Add filter": a filter icon to filter by (`eq`), a
 * minus to exclude (`ne`), a chevron towards the values kept for the others.
 */
export const OP_ICONS: Readonly<Record<FilterOp, QuickPickIcon>> = {
  eq: { svg: createElement(Filter).outerHTML, label: 'Filter' },
  ne: { svg: createElement(Minus).outerHTML, label: 'Exclude' },
  lt: { svg: createElement(ChevronLeft).outerHTML, label: 'Below' },
  le: { svg: createElement(ChevronLeft).outerHTML, label: 'At most' },
  gt: { svg: createElement(ChevronRight).outerHTML, label: 'Above' },
  ge: { svg: createElement(ChevronRight).outerHTML, label: 'At least' },
};
