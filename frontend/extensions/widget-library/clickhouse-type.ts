// See typeKind and pillValue.

/**
 * What a ClickHouse type holds, as the filters compare it (docs/2026-10-28-workbench.md §3.15 D25): `day` a Date or
 * Date32, `time` a DateTime or DateTime64, `number` an integer, a float or a Decimal, `text` anything else (a String,
 * an Enum, a Bool, a UUID) and an unknown type. `Nullable(…)` and `LowCardinality(…)` count as what they wrap.
 */
export type TypeKind = 'text' | 'number' | 'day' | 'time';

export function typeKind(type: string | undefined): TypeKind {
  const t = unwrap(type);
  if (/^DateTime(64)?\b/.test(t)) return 'time';
  if (/^Date(32)?$/.test(t)) return 'day';
  if (/^(U?Int\d+|Float\d+|BFloat16|Decimal(\d+)?)\b/.test(t)) return 'number';
  return 'text';
}

/** `type` without the `Nullable(…)` and `LowCardinality(…)` around it: `DateTime64(3)`; '' for none. */
function unwrap(type: string | undefined): string {
  let t = type?.trim() ?? '';
  for (let wrapped = WRAPPED.exec(t); wrapped; wrapped = WRAPPED.exec(t)) t = wrapped[1].trim();
  return t;
}

const WRAPPED = /^(?:Nullable|LowCardinality)\((.*)\)$/;

/** A day in ms. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A value of a column of ClickHouse type `type` as a pill compares it: a time as ISO 8601 in UTC
 * (`2026-10-31T10:00:00.000Z`), a day as `2026-10-31`, anything else as text. A value as Arrow carries it: a
 * `DateTime` in seconds (ClickHouse sends it as UInt32), a `Date` in days (UInt16), a `DateTime64` and a `Date32` in
 * ms, a `Date` object as it is; a time that is no number or date stays its text.
 */
export function pillValue(value: unknown, type: string | undefined): string {
  const kind = typeKind(type);
  if (kind !== 'time' && kind !== 'day') return String(value);
  const unwrapped = unwrap(type);
  const ms =
    value instanceof Date
      ? value.getTime()
      : typeof value === 'number' || typeof value === 'bigint'
        ? Number(value) * (/^DateTime(\(|$)/.test(unwrapped) ? 1000 : /^Date$/.test(unwrapped) ? DAY_MS : 1)
        : NaN;
  if (Number.isNaN(ms)) return String(value);
  const iso = new Date(ms).toISOString();
  return kind === 'day' ? iso.slice(0, 10) : iso;
}
