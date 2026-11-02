// iCalendar export of the client's court dates across every firm (RLS-scoped).
import { supabaseServer } from "@/lib/supabase/server";
import type { CourtEventRow } from "@/lib/db/types";

function icsDate(iso: string) {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
function esc(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

export async function GET() {
  const supabase = await supabaseServer();
  // These bodies are what a client sees if the file cannot be made, so they are sentences.
  if (!supabase) return new Response("Your court dates cannot be added right now. Try again later.", { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Sign in to the app first, then add your court dates again.", { status: 401 });

  // A vacated date is not exported: the registry took it off, and a calendar that still shows it lies.
  const { data: rows } = await supabase.from("court_events").select("id, matter_id, firm_id, scheduled_at, court_name, purpose, outcome_update_id, vacated_at").is("vacated_at", null).order("scheduled_at").limit(500);
  const events = (rows ?? []) as CourtEventRow[];
  const matterIds = Array.from(new Set(events.map((e) => e.matter_id)));
  const { data: matterRows } = matterIds.length ? await supabase.from("matters").select("id, reference, title").in("id", matterIds) : { data: [] };
  const matters = new Map(((matterRows ?? []) as Array<{ id: string; reference: string; title: string }>).map((m) => [m.id, m]));

  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Docket//Court dates//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Court dates"];
  for (const e of events) {
    const m = matters.get(e.matter_id);
    const start = new Date(e.scheduled_at);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    lines.push(
      "BEGIN:VEVENT",
      `UID:court-${e.id}@docket`,
      `DTSTAMP:${icsDate(new Date().toISOString())}`,
      `DTSTART:${icsDate(start.toISOString())}`,
      `DTEND:${icsDate(end.toISOString())}`,
      // The title a client reads in their own calendar, so no dash (docs/VOICE.md, rule 21).
      `SUMMARY:${esc(`${m?.title ?? "Court date"}${e.purpose ? `: ${e.purpose}` : ""}`)}`,
      // What it is first, the reference last and labelled (docs/VOICE.md, rule 5).
      `DESCRIPTION:${esc([e.purpose, m?.reference ? `Reference ${m.reference}` : null].filter(Boolean).join("\n"))}`,
      ...(e.court_name ? [`LOCATION:${esc(e.court_name)}`] : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return new Response(lines.join("\r\n") + "\r\n", {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'attachment; filename="court-dates.ics"',
      "cache-control": "private, no-store",
    },
  });
}
