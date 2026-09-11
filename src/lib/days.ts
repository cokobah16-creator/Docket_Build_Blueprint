// Calendar days, as calendar days.
//
// A DATE column is a calendar day and is never shifted through a timezone — matters.closed_at,
// matters.next_action_due, invoices.due_at. These helpers keep that rule at the edges: "today" is
// asked in a named timezone, and a day is formatted without ever becoming an instant that the
// viewer's clock could move to the day before. Safe in server and client code alike.

/** Today as YYYY-MM-DD in a timezone — the day it is where the firm is, not on the server. */
export function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** "30 Sept 2026" from "2026-09-30". Formatted in UTC on purpose: the day is the day. */
export function formatDay(day: string): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}

/** True when a YYYY-MM-DD day is before today in the timezone — string order is date order. */
export function isPastDay(day: string, timeZone: string): boolean {
  return day < todayIn(timeZone);
}
