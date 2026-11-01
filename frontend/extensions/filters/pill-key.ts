// See filters in filters.ts.
import type { FilterOp } from './chips';
import { OP_SIGNS } from './ops';

/** What a field's pill filters (`pillField`): the rows of `table` where `field` compares by `op` with `value`. */
export interface PillField {
  /** The ClickHouse connection of `table` (`default`). */
  readonly connection: string;
  /** As `page.json` names it: `http_logs` on a connection to `default`, else with its database. */
  readonly table: string;
  /** The alias of the field (`host`), or with `column` the column's name. */
  readonly field: string;
  /** Set for a pill on a column of `table`, whose key carries no condition, which any chart on it makes. */
  readonly column?: true;
  readonly op: FilterOp;
  /** As the field shows it (`acme`, a time as ISO 8601); '' for an empty one. */
  readonly value: string;
}

/**
 * The chip's text of a pill's key: `customer = acme` for a field's, a button's condition and its value
 * (`duration_ms >= ...: 500`), the key itself when it is neither.
 */
export function pillLabel(key: string): string {
  const field = pillField(key);
  if (field) return `${field.field} ${OP_SIGNS[field.op]} ${field.value}`;
  const button = pillButton(key);
  if (button) return button.value ? `${button.button}: ${button.value}` : button.button;
  return key;
}

/**
 * The filter button a pill's key was made for: its condition as the dashboard declares it (`duration_ms >= ...`,
 * the button's `queryPart`) and the value written in for its `...` ('' for a button without); `undefined` for the
 * pill of a field.
 */
export function pillButton(key: string): { readonly button: string; readonly value: string } | undefined {
  const parts = partsOf(key);
  if (!parts?.[0]?.startsWith('@') || parts.length > 2) return undefined;
  const [button, value = ''] = parts.map(unescape);
  if (button === undefined || value === undefined || button.length < 2) return undefined;
  return { button: button.slice(1), value };
}

/** The ops by their ClickHouse operator as a key writes them, the two-character ones first (`Sign`). */
const OPERATORS: readonly (readonly [string, FilterOp])[] = [
  ['!=', 'ne'],
  ['<=', 'le'],
  ['>=', 'ge'],
  ['=', 'eq'],
  ['<', 'lt'],
  ['>', 'gt'],
];

/**
 * The field a pill's key filters by, as its chart made it (`<dataUrl>/pill`): its table, the field's alias (or a
 * column's name, `column`, for a key without a condition), the op and the value the field shows, by which the filter
 * bar makes it again with another op or value; `undefined` for a button's pill and a key it cannot read. The key is
 * `[<connection>:]<table>.<field><op><value>[~<condition>]~<mac>`, each part with its separators percent-encoded
 * (lib/dashboard/filter, `Sign`).
 */
export function pillField(key: string): PillField | undefined {
  const parts = partsOf(key);
  const head = parts?.[0];
  if (!parts || head === undefined || head.startsWith('@') || parts.length > 2) return undefined;
  const at = head.search(/[=!<>]/);
  const operator = at < 0 ? undefined : OPERATORS.find(([sign]) => head.startsWith(sign, at));
  if (!operator) return undefined;
  const names = head.slice(0, at);
  const dot = names.lastIndexOf('.');
  const colon = names.indexOf(':');
  const connection = colon < 0 ? 'default' : unescape(names.slice(0, colon));
  const table = names.slice(colon + 1, dot).split('.').map(unescape);
  const field = unescape(names.slice(dot + 1));
  const value = unescape(head.slice(at + operator[0].length));
  if (dot < 0 || connection === undefined || table.length > 2 || table.some((t) => !t) || !field || value === undefined) return undefined;
  return { connection, table: table.join('.'), field, ...(parts.length === 1 ? { column: true as const } : {}), op: operator[1], value };
}

/** The parts of a key before its mac (split at `~`); `undefined` for one without a mac. */
function partsOf(key: string): string[] | undefined {
  const mac = key.lastIndexOf('~');
  return mac < 0 ? undefined : key.slice(0, mac).split('~');
}

/** A part of a key as it was before `Sign` percent-encoded it; `undefined` for one that is no such text. */
function unescape(part: string): string | undefined {
  try {
    return decodeURIComponent(part);
  } catch {
    return undefined;
  }
}
