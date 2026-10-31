// See pillLabel, pillButton and pillField.
import type { FilterOp } from './chips';

/** What a field's pill filters (`pillField`): the rows of `table` where `field` shows `value` (`eq`) or does not (`ne`). */
export interface PillField {
  /** The ClickHouse connection of `table` (`default`). */
  readonly connection: string;
  /** With its database: `default.http_logs`. */
  readonly table: string;
  /** The alias of the field (`host`). */
  readonly field: string;
  readonly op: FilterOp;
  /** As the field shows it (`acme`); '' for an empty one. */
  readonly value: string;
}

/**
 * The label a pill's key carries (`customer = acme`), the chip's text: its key is `<payload>.<mac>`, the payload the
 * pill as JSON in base64url (lib/dashboard/filter, `Sign`); the key itself when it has none.
 */
export function pillLabel(key: string): string {
  const { label } = payloadOf(key);
  return typeof label === 'string' && label ? label : key;
}

/**
 * The filter button a pill's key was made for: its condition as the dashboard declares it (`duration_ms >= ...`,
 * the button's `queryPart`) and the value written in for its `...` ('' for a button without); `undefined` for the
 * pill of a field.
 */
export function pillButton(key: string): { readonly button: string; readonly value: string } | undefined {
  const { button, value } = payloadOf(key);
  if (typeof button !== 'string' || !button) return undefined;
  return { button, value: typeof value === 'string' ? value : '' };
}

/**
 * The field a pill's key filters by, as its chart made it (`<dataUrl>/pill`): its table, the field's alias, the op and
 * the value the field shows, by which the filter bar makes it again with another op or value; `undefined` for a
 * button's pill, a key without a field, and one without a value (signed before pills carried it, so it cannot be made
 * again: an empty value is `""`).
 */
export function pillField(key: string): PillField | undefined {
  const { connection, table, field, op, value, button } = payloadOf(key);
  if (button || typeof connection !== 'string' || typeof table !== 'string' || typeof field !== 'string' || !field) return undefined;
  if ((op !== 'eq' && op !== 'ne') || typeof value !== 'string') return undefined;
  return { connection, table, field, op, value };
}

/** The payload of a pill's key, as JSON (`Sign`); empty for a key without one. */
function payloadOf(key: string): Record<string, unknown> {
  const dot = key.indexOf('.');
  if (dot < 0) return {};
  try {
    const payload = key.slice(0, dot).replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (parsed !== null && typeof parsed === 'object') return parsed as Record<string, unknown>;
  } catch {
    // not a pill's key: the server refuses it, the chip shows it as it is
  }
  return {};
}
