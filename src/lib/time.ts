// Time-zone helpers for server components (UTC in the database, rendered in the viewer's zone).

function tzOffsetMs(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - date.getTime();
}

/** UTC instants for the start and end of the calendar day containing `at` in `tz`. */
export function zonedDayRange(tz: string, at: Date = new Date()): { start: Date; end: Date; ymd: string } {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  const naive = new Date(`${ymd}T00:00:00Z`);
  const start = new Date(naive.getTime() - tzOffsetMs(naive, tz));
  return { start, end: new Date(start.getTime() + 86_400_000), ymd };
}

export function formatWhen(iso: string, tz: string, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }): string {
  return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: tz }).format(new Date(iso));
}
