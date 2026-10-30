/**
 * The ends of a custom time range as the server reads them (`parseTimeExpr` in lib/httpserver/time_range.go): an
 * absolute time `2026-10-29 10:00`, or a time relative to now, `now`, `now-6h` (units s m h d w; days and weeks are
 * calendar days). The picker reads them to say what is wrong before anything is sent, and to shift a window.
 */

const RELATIVE = /^now(?:([+-])(\d+)([smhdw]))?$/;
const ABSOLUTE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;

/** The time `text` stands for at `now`, in the viewer's time zone; `undefined` for anything else. */
export function parseTimeExpr(text: string, now: Date): Date | undefined {
  const trimmed = text.trim();
  const relative = RELATIVE.exec(trimmed);
  if (relative) {
    const [, sign, amount, unit] = relative;
    const result = new Date(now);
    if (sign === undefined) return result;
    const n = sign === '-' ? -Number(amount) : Number(amount);
    switch (unit) {
      case 's':
        result.setSeconds(result.getSeconds() + n);
        break;
      case 'm':
        result.setMinutes(result.getMinutes() + n);
        break;
      case 'h':
        result.setHours(result.getHours() + n);
        break;
      case 'd':
        result.setDate(result.getDate() + n);
        break;
      case 'w':
        result.setDate(result.getDate() + 7 * n);
        break;
    }
    return result;
  }
  const absolute = ABSOLUTE.exec(trimmed);
  if (!absolute) return undefined;
  const [year, month, day, hours, minutes] = absolute.slice(1).map(Number);
  const result = new Date(year, month - 1, day, hours, minutes);
  // `2026-13-40 25:00` rolls over into another date
  if (result.getMonth() !== month - 1 || result.getDate() !== day || result.getHours() !== hours) return undefined;
  return result;
}

/** Whether `text` is relative to now (`now-6h`): such an end moves with every query. */
export function isRelative(text: string): boolean {
  return RELATIVE.test(text.trim());
}

/** `2026-10-29 10:00` in the viewer's time zone. */
export function formatTimeExpr(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
