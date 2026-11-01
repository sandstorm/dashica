/**
 * `2026-10-29 10:00+01:00`: `date` in the viewer's time zone with its offset to UTC, an end of a custom range as
 * `customRange` takes it; the server reads it with the offset, whatever its own time zone.
 */
export function formatTime(date: Date): string {
  return `${formatLocalTime(date)}${formatUtcOffset(date)}`;
}

/** `2026-10-29 10:00` in the viewer's time zone, to the minute: a time as the viewer reads it (a chart's tip). */
export function formatLocalTime(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * An end of a custom range as typed (`2026-10-29 10:00`, `now-6h`) as it is sent: an absolute time without offset with
 * the viewer's offset at that time (`2026-10-29 10:00+01:00`), anything else as it is (the server says what it cannot
 * read).
 */
export function withUtcOffset(text: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(text.trim());
  if (!m) return text.trim();
  const [year, month, day, hours, minutes] = m.slice(1).map(Number);
  return formatTime(new Date(year, month - 1, day, hours, minutes));
}

/** `+01:00`, `-03:00`, `+05:30`, `+00:00`: the viewer's offset to UTC at `date`, as ISO 8601 writes it. */
function formatUtcOffset(date: Date): string {
  const minutes = -date.getTimezoneOffset();
  const abs = Math.abs(minutes);
  return `${minutes < 0 ? '-' : '+'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
