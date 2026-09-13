// A minimal, dependency-free iCalendar writer (RFC 5545), shared by the calendar-feed Edge
// Function and run as a check by scripts/check-ics.ts.
//
// It exists because the fiddly parts of this format are exactly the parts that fail silently: a
// comma inside a summary, a line longer than 75 octets, a bare newline where CRLF was required, a
// timestamp that is not UTC. A calendar app meeting any of those does not raise an error — it
// shows the wrong thing, or nothing, and a lawyer misses a court date. So the escaping and the
// folding live here, on their own, where they can be asserted.
//
// WHAT IT DELIBERATELY DOES NOT DO. No timezone definitions: every instant is written as UTC with
// a trailing Z, which every calendar client renders in the reader's own zone. A VTIMEZONE block
// would be a second, redundant statement of the same fact and one more thing to get wrong. All-day
// entries use a DATE value, so a deadline lands on its day in every zone rather than sliding.

export interface IcsEvent {
  /** Stable across regenerations of the feed: a calendar updates the entry rather than duplicating it. */
  uid: string;
  /** An instant, or a bare YYYY-MM-DD for an all-day entry. */
  start: string;
  end?: string;
  allDay?: boolean;
  summary: string;
  description?: string;
  location?: string;
  /** Bumped when the entry changes, so a client knows to replace what it has. */
  sequence?: number;
  status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
}

/** RFC 5545 §3.3.11: backslash, semicolon and comma are escaped; a newline becomes a literal \n. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Fold to 75 OCTETS, not 75 characters (§3.1). A Yoruba name is multi-byte in UTF-8, so folding by
 * character length would produce lines that are legal by one measure and too long by the one the
 * specification uses. A continuation begins with a single space, and a multi-byte character is
 * never split across the fold.
 */
export function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let currentBytes = 0;
  // The first line may run to 75 octets; each continuation carries a leading space, so 74 remain.
  let budget = 75;
  for (const ch of line) {
    const size = new TextEncoder().encode(ch).length;
    if (currentBytes + size > budget) {
      out.push(current);
      current = ch;
      currentBytes = size;
      budget = 74;
    } else {
      current += ch;
      currentBytes += size;
    }
  }
  out.push(current);
  return out.join("\r\n ");
}

/** 20260913T081500Z. Always UTC: the reader's calendar renders it wherever they are. */
export function icsInstant(iso: string): string {
  const d = new Date(iso);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** 20260913, from a YYYY-MM-DD calendar day. Never shifted through a timezone. */
export function icsDay(day: string): string {
  return day.slice(0, 10).replace(/-/g, "");
}

/** The day after, for an all-day entry: DTEND is exclusive in RFC 5545. */
export function icsDayAfter(day: string): string {
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return icsDay(d.toISOString());
}

export function buildCalendar(name: string, events: IcsEvent[], stamp: string): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Docket//Legal diary//EN",
    "CALSCALE:GREGORIAN",
    // A published feed, not an invitation: nobody is being asked to reply.
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
    // A polite hint; a client refreshes when it likes and this only asks it not to hammer us.
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const e of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${e.uid}`);
    lines.push(`DTSTAMP:${icsInstant(stamp)}`);
    if (e.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${icsDay(e.start)}`);
      lines.push(`DTEND;VALUE=DATE:${icsDayAfter(e.end ?? e.start)}`);
    } else {
      lines.push(`DTSTART:${icsInstant(e.start)}`);
      if (e.end) lines.push(`DTEND:${icsInstant(e.end)}`);
    }
    lines.push(`SUMMARY:${escapeText(e.summary)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    lines.push(`SEQUENCE:${e.sequence ?? 0}`);
    lines.push(`STATUS:${e.status ?? "CONFIRMED"}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  // CRLF between lines, and a trailing one: §3.1 is explicit and some clients are strict about it.
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
