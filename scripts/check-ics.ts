// What the calendar writer must keep true, asserted by running it. `deno run scripts/check-ics.ts`
// (the `deno` CI job). src/lib/ics.ts is dependency-free TypeScript, so deno is the whole oracle.
//
// Every one of these is a way an iCalendar feed fails SILENTLY: a client meeting a bad line does
// not raise an error, it shows the wrong thing or nothing at all — and the thing not shown is a
// court date.

import {
  buildCalendar, escapeText, foldLine, icsDay, icsDayAfter, icsInstant,
} from "../src/lib/ics.ts";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { console.log(`PASS ${name}`); return; }
  failures += 1;
  console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

// 1. The three characters that break a line, and the newline that breaks a file.
check("a comma is escaped", escapeText("Adebayo, Okonkwo & Co") === "Adebayo\\, Okonkwo & Co");
check("a semicolon is escaped", escapeText("mention; then hearing") === "mention\\; then hearing");
check("a backslash is escaped first", escapeText("a\\b") === "a\\\\b");
check("a newline becomes a literal \\n", escapeText("line one\nline two") === "line one\\nline two");
check("a CRLF becomes one \\n, not two", escapeText("a\r\nb") === "a\\nb");

// 2. Folding is by OCTET, because a Yoruba or Igbo name is multi-byte in UTF-8.
const long = "Ọlá".repeat(40);
const folded = foldLine(`SUMMARY:${long}`);
check("a long line is folded", folded.includes("\r\n "));
check("every folded segment is within 75 octets",
  folded.split("\r\n").every((seg) => new TextEncoder().encode(seg).length <= 75),
  String(Math.max(...folded.split("\r\n").map((s) => new TextEncoder().encode(s).length))));
check("folding does not split a multi-byte character",
  folded.split("\r\n").join("").replace(/^SUMMARY:/, "").replace(/ /g, "") === long.replace(/ /g, ""));
check("a short line is left alone", foldLine("SUMMARY:Mention") === "SUMMARY:Mention");

// 3. Instants are UTC with a Z; calendar days never move.
check("an instant is written as UTC", icsInstant("2026-09-13T08:15:00Z") === "20260913T081500Z");
check("...and an offset is converted, not copied", icsInstant("2026-09-13T09:15:00+01:00") === "20260913T081500Z");
check("a calendar day is the day it is", icsDay("2026-09-30") === "20260930");
check("an all-day end is exclusive: the day after", icsDayAfter("2026-09-30") === "20261001");
check("...across a month end", icsDayAfter("2026-12-31") === "20270101");

// 4. The whole document.
const cal = buildCalendar("Docket — court diary", [
  { uid: "court-1@docket", start: "2026-09-13T08:15:00Z", end: "2026-09-13T09:15:00Z",
    summary: "Mention: AK-M-2026-000014", location: "High Court of Lagos State, Ikeja",
    description: "Adebayo v Union Bank; suit FHC/L/CS/77/2026" },
  { uid: "deadline-1@docket", start: "2026-09-30", allDay: true, summary: "File the written address", status: "TENTATIVE" },
], "2026-09-13T07:00:00Z");

check("it begins and ends as a calendar", cal.startsWith("BEGIN:VCALENDAR\r\n") && cal.trimEnd().endsWith("END:VCALENDAR"));
check("every line ends CRLF, and none ends with a bare LF",
  cal.split("\r\n").every((l) => !l.includes("\n")) && cal.endsWith("\r\n"));
check("both events are present", (cal.match(/BEGIN:VEVENT/g) ?? []).length === 2);
check("an all-day entry uses a DATE value", cal.includes("DTSTART;VALUE=DATE:20260930") && cal.includes("DTEND;VALUE=DATE:20261001"));
check("a timed entry carries a UTC start and end", cal.includes("DTSTART:20260913T081500Z") && cal.includes("DTEND:20260913T091500Z"));
check("the description's semicolon survived escaping", cal.includes("Adebayo v Union Bank\\; suit FHC/L/CS/77/2026"));
check("status is carried through", cal.includes("STATUS:TENTATIVE"));
check("each event has a stable uid", cal.includes("UID:court-1@docket") && cal.includes("UID:deadline-1@docket"));
check("the feed is named", cal.includes("X-WR-CALNAME:Docket — court diary"));

// 5. An empty diary is a valid calendar, not an error. A lawyer with nothing listed must not see
//    their calendar app report a broken feed.
const empty = buildCalendar("Empty", [], "2026-09-13T07:00:00Z");
check("an empty diary is still a valid calendar",
  empty.includes("BEGIN:VCALENDAR") && empty.includes("END:VCALENDAR") && !empty.includes("BEGIN:VEVENT"));

if (failures > 0) { console.error(`\n${failures} check(s) failed`); Deno.exit(1); }
console.log("\nthe calendar writer holds");
