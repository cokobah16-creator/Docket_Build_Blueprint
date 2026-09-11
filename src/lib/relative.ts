// "3 hours ago", "in 2 days", "2 weeks ago" — one place for it.
//
// Five console screens each carried their own Intl.RelativeTimeFormat block with slightly
// different thresholds. The queues added in Wave 1 use this one; the older copies can move over
// as they are touched. Past and future both, because a due date is a future instant until it is
// an overdue one.

export function relativeLabel(iso: string, nowMs: number): string {
  const rtf = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });
  const diff = new Date(iso).getTime() - nowMs;
  const sign = diff < 0 ? -1 : 1;
  const hours = Math.round(Math.abs(diff) / 3_600_000);
  if (hours < 1) return sign < 0 ? "just now" : "within the hour";
  if (hours < 24) return rtf.format(sign * hours, "hour");
  const days = Math.round(hours / 24);
  if (days < 14) return rtf.format(sign * days, "day");
  if (days < 60) return rtf.format(sign * Math.round(days / 7), "week");
  return rtf.format(sign * Math.round(days / 30), "month");
}
