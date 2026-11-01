// See filters in filters.ts.
import { queryKey, type QueryEntries } from '../../hosts/query/query';

/**
 * The filter chips of a tab's query state (`query.get(FILTERS)`), the `filters` extension's. In the URL, in the order
 * they were added: one `f` per pill, one `sql` per SQL chip (`?f=<key>&sql=status >= 500`), none by default; the data
 * handlers read them as they are. An empty `f` and an `sql` of only spaces are left out. An `f` is kept as it is,
 * whatever it holds: the server checks its signature. A `?sql=` holding several conditions is one chip.
 */
export const FILTERS = queryKey<readonly FilterChip[]>(['f', 'sql'], {
  parse: (url) => [...url].map(([key, value]) => parseChip(key, value)).filter((chip) => chip !== undefined),
  format: entriesOf,
  sentToServer: true,
});

/** A chip of the filter bar: a pill (`?f=`), or a SQL condition every query of the page adds to its WHERE (`?sql=`). */
export type FilterChip = PillFilter | SqlFilter;

/**
 * A pill: a condition on a table that the server wrote from a widget's field and signed (`<dataUrl>/pill`); every
 * chart on that table applies it, the others say they ignore it. Or a filter button's condition, signed the same
 * (`page.json`'s `key`, or `<page>/button`), which every query that takes filters applies. Only its key is kept and
 * sent; what the key says of itself (its label, field or button) is read by `pill-key.ts`.
 */
export interface Pill {
  /** What the URL holds (`?f=<key>`): the signed pill. */
  readonly key: string;
}

export interface PillFilter extends Pill {
  readonly kind: 'pill';
}

/** A SQL condition (`duration > 2000`); several AND together, each in its own parentheses. */
export interface SqlFilter {
  readonly kind: 'sql';
  readonly sql: string;
}

/**
 * How a pill compares its field with its value (`sql.Op`): `eq` equals (Filter by …), `ne` differs (Exclude …), `lt`
 * / `le` / `gt` / `ge` less than, at most, greater than, at least. Which a field offers depends on its type (`opsOf`).
 */
export type FilterOp = 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge';

/** Every op, as a number offers them and `pill-key.ts` reads one from a key. */
export const FILTER_OPS: readonly FilterOp[] = ['eq', 'ne', 'lt', 'le', 'gt', 'ge'];

/** `chips` with `chip` added at the end; `chips` itself when it is there already or a SQL chip of only spaces. */
export function addChip(chips: readonly FilterChip[], chip: FilterChip): readonly FilterChip[] {
  return isEmpty(chip) || chips.some((old) => sameChip(old, chip)) ? chips : [...chips, chip];
}

/**
 * `chips` with `chip` in place of the one at `index` (an edit); a SQL chip of only spaces removes it, and so does a
 * chip that is there already (once in the URL, as `addChip` keeps it). `chips` itself for an index beyond them or the
 * same chip again.
 */
export function replaceChip(chips: readonly FilterChip[], index: number, chip: FilterChip): readonly FilterChip[] {
  if (index < 0 || index >= chips.length || sameChip(chips[index], chip)) return chips;
  // an edit that makes a chip another one already is (`host = a` switched to the `host ≠ a` beside it) removes it
  const removed = isEmpty(chip) || chips.some((old) => sameChip(old, chip));
  return removed ? chips.filter((_, i) => i !== index) : chips.map((old, i) => (i === index ? chip : old));
}

/**
 * `chips` without the one at index `which`, or without every chip `which` holds for (a released filter button's);
 * `chips` itself when that removes none.
 */
export function removeChips(chips: readonly FilterChip[], which: number | ((chip: FilterChip) => boolean)): readonly FilterChip[] {
  const kept = chips.filter((chip, i) => (typeof which === 'number' ? i !== which : !which(chip)));
  return kept.length < chips.length ? kept : chips;
}

/** The chip of the URL's entry `key`=`value`; `undefined` for another key, an empty `f`, an `sql` of only spaces. */
function parseChip(key: string, value: string): FilterChip | undefined {
  if (key === 'f' && value !== '') return { kind: 'pill', key: value };
  if (key === 'sql' && value.trim() !== '') return { kind: 'sql', sql: value };
  return undefined;
}

function entriesOf(chips: readonly FilterChip[]): QueryEntries {
  return chips.map((chip) => (chip.kind === 'sql' ? ['sql', chip.sql] : ['f', chip.key]));
}

/** A SQL chip of only spaces: it filters nothing, the server leaves it out. */
function isEmpty(chip: FilterChip): boolean {
  return chip.kind === 'sql' && chip.sql.trim() === '';
}

function sameChip(a: FilterChip, b: FilterChip): boolean {
  if (a.kind === 'sql') return b.kind === 'sql' && a.sql === b.sql;
  return b.kind === 'pill' && a.key === b.key;
}
