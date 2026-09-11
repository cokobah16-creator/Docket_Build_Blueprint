// Sittings: the chase list of past court dates with no update posted, each
// with the post-court-update form inline so a lawyer clears the backlog
// without navigating away, plus the diary of upcoming sittings with the
// registry's "date vacated" action.
//
// Rules enforced here: every read runs as the signed-in staff member through
// the security_invoker views firm_sittings_due and firm_cause_list — the
// database decides what this firm may see, and no service key is used;
// timestamps are UTC in the database and rendered in ctx.timezone; nothing
// firm-specific is hard-coded — the firm, its courts and its zone come from
// context.

import Link from "next/link";
import { redirect } from "next/navigation";
import { courtsFor, firmStaff, requestedFirmId, sittingsDue, staffContext, staffLabel } from "@/lib/firm-data";
import { vacateCourtEvent } from "@/lib/actions/court";
import { formatWhen } from "@/lib/time";
import { Alert } from "@/components/ui/alert";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { CourtUpdateForm } from "@/components/firm/court-update-form";
import { cn } from "@/lib/cn";
import type { CauseListRow, SittingDue } from "@/lib/db/types";

export const metadata = { title: "Sittings" };

const field = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none";

interface MatterCourt {
  id: string;
  court_id: string | null;
  court_name: string | null;
  judicial_division: string | null;
}

/**
 * The UTC instant for a wall-clock date and time in `tz` — the database keeps
 * UTC, the lawyer types the court's own calendar date. Two passes because the
 * offset itself depends on the instant.
 */
function zonedInstant(ymd: string, hhmm: string, tz: string): string {
  const [y, mo, d] = ymd.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const wanted = Date.UTC(y, (mo || 1) - 1, d || 1, h || 0, mi || 0, 0);
  let ts = wanted;
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(ts));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    ts -= asUtc - wanted;
  }
  return new Date(ts).toISOString();
}

/** "yesterday", "3 days ago" — how long a sitting has gone unreported. */
function sinceLabel(iso: string, nowMs: number): string {
  const rtf = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });
  const hours = Math.round((nowMs - new Date(iso).getTime()) / 3_600_000);
  if (hours < 24) return rtf.format(-Math.max(1, hours), "hour");
  const days = Math.round(hours / 24);
  if (days < 14) return rtf.format(-days, "day");
  if (days < 60) return rtf.format(-Math.round(days / 7), "week");
  return rtf.format(-Math.round(days / 30), "month");
}

/** The registry vacated a date. Returns void: it always redirects back with the outcome. */
async function vacate(formData: FormData): Promise<void> {
  "use server";
  const firm = String(formData.get("firm") ?? "");
  const eventId = String(formData.get("eventId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const tz = String(formData.get("tz") ?? "Africa/Lagos");
  const newDay = String(formData.get("newDate") ?? "").trim();
  const newTime = String(formData.get("newTime") ?? "").trim() || "09:00";
  const newPurpose = String(formData.get("newPurpose") ?? "").trim();

  // zonedInstant() builds a Date from these two strings and toISOString() throws
  // RangeError on an unreadable one — before vacateCourtEvent's own guard can
  // turn a bad value into a banner. A date input only ever submits "" or a real
  // date, but a hand-made POST must get the honest refusal, not a 500.
  const badDay = newDay !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(newDay);
  const badTime = newTime !== "" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(newTime);
  if (badDay || badTime) {
    const bad = new URLSearchParams();
    if (firm) bad.set("firm", firm);
    bad.set("error", "That refixed date could not be read.");
    redirect(`/firm/sittings?${bad.toString()}`);
  }

  const result = await vacateCourtEvent(
    eventId,
    reason,
    newDay ? zonedInstant(newDay, newTime, tz) : null,
    newPurpose || null,
  );

  const qs = new URLSearchParams();
  if (firm) qs.set("firm", firm);
  if ("error" in result) qs.set("error", result.error);
  else qs.set("vacated", result.newEventId ? "refixed" : "1");
  redirect(`/firm/sittings?${qs.toString()}`);
}

export default async function SittingsPage({
  searchParams,
}: {
  searchParams: Promise<{ firm?: string; error?: string; vacated?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await staffContext(await requestedFirmId({ firm: sp.firm }));

  if (!ctx) {
    return (
      <Alert kind="warning" title="Not configured">
        Supabase environment variables are not set, or this account is not a member of a firm.
        See <code>.env.example</code>, or ask a firm owner to add you.
      </Alert>
    );
  }

  const { supabase, firmId, timezone: tz } = ctx;
  const nowIso = new Date().toISOString();

  const [due, courts, { data: causeRows }, staff] = await Promise.all([
    sittingsDue(supabase, firmId, 50),
    courtsFor(supabase, firmId),
    supabase
      .from("firm_cause_list")
      .select("*")
      .eq("firm_id", firmId)
      .gte("scheduled_at", nowIso)
      .order("scheduled_at", { ascending: true })
      .limit(100),
    firmStaff(supabase, firmId),
  ]);

  const upcoming = (causeRows ?? []) as CauseListRow[];
  const staffById = new Map(staff.map((m) => [m.user_id, staffLabel(m)]));

  const matterIds = Array.from(new Set(due.map((d) => d.matter_id)));
  const { data: matterRows } = matterIds.length
    ? await supabase.from("matters").select("id, court_id, court_name, judicial_division").in("id", matterIds)
    : { data: [] as MatterCourt[] };
  const matterById = new Map(((matterRows ?? []) as MatterCourt[]).map((m) => [m.id, m]));

  const nowMs = Date.now();
  const dayOf = (iso: string) => formatWhen(iso, tz, { dateStyle: "full" });

  // Group the diary by court day so a lawyer reads "Monday, then Tuesday".
  const days: Array<{ label: string; rows: CauseListRow[] }> = [];
  for (const row of upcoming) {
    const label = dayOf(row.scheduled_at);
    const last = days[days.length - 1];
    if (last && last.label === label) last.rows.push(row);
    else days.push({ label, rows: [row] });
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-[22px] font-bold tracking-[-0.02em] text-[#141414]">Sittings</h1>
          <p className="text-sm text-gray-600">{ctx.firmName} · times in {tz}</p>
        </div>
        <Link href="/firm/matters" className="shrink-0 text-sm text-brand underline">All matters →</Link>
      </header>

      {sp.error && <Alert kind="error" title="The court diary refused that">{sp.error}</Alert>}
      {sp.vacated === "1" && (
        <Alert kind="success" title="Date vacated">
          The matter is marked as awaiting a date and the client has been told.
        </Alert>
      )}
      {sp.vacated === "refixed" && (
        <Alert kind="success" title="Date vacated and refixed">
          The replacement sitting is in the diary below and the client has been told.
        </Alert>
      )}

      <Card className={cn(due.length > 0 && "border-amber-300")}>
        <CardHeader title={`Sittings without an update (${due.length})`} />
        {due.length === 0 ? (
          <EmptyState
            title="Nothing to chase"
            hint="Every past sitting has an update against it. A sitting appears here four hours after its time if nobody has posted what happened."
            action={<Link href="/firm/matters" className="text-sm text-brand underline">Open a matter to post an update</Link>}
          />
        ) : (
          <ul className="divide-y divide-gray-100">
            {due.map((s: SittingDue) => {
              const matter = matterById.get(s.matter_id) ?? null;
              return (
                <li key={s.court_event_id} id={`sitting-${s.court_event_id}`} className="px-4 py-4 sm:px-5">
                  <details>
                    <summary className="cursor-pointer marker:text-brand">
                      <span className="ml-1 inline-block align-top">
                        <span className="block text-sm font-medium text-gray-900">{s.cause_title}</span>
                        <span className="mt-0.5 block text-xs text-gray-600">
                          {s.suit_number ?? s.reference}
                          {s.court ? ` · ${s.court}` : ""}
                          {s.purpose || s.purpose_kind ? ` · ${s.purpose ?? (s.purpose_kind ?? "").replace(/_/g, " ")}` : ""}
                        </span>
                        <span className="mt-1 block text-xs font-medium text-amber-800">
                          Sat {formatWhen(s.scheduled_at, tz, { dateStyle: "medium", timeStyle: "short" })} · {sinceLabel(s.scheduled_at, nowMs)}
                          {s.lawyer_id && staffById.has(s.lawyer_id) ? ` · ${staffById.get(s.lawyer_id)}` : ""}
                        </span>
                        <span className="mt-1 block text-xs font-medium text-brand underline">Post what happened</span>
                      </span>
                    </summary>
                    <div className="mt-4 border-t border-gray-100 pt-4">
                      <CourtUpdateForm
                        matterId={s.matter_id}
                        firmId={firmId}
                        timezone={tz}
                        courts={courts}
                        currentCourtId={matter?.court_id ?? null}
                        currentCourtName={matter?.court_name ?? s.court ?? null}
                        judicialDivision={matter?.judicial_division ?? null}
                        sittingAt={s.scheduled_at}
                      />
                      <p className="mt-3 text-xs text-gray-500">
                        <Link href={`/firm/matters/${s.matter_id}`} className="text-brand underline">Open the matter →</Link>
                      </p>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title={`In the diary (${upcoming.length})`} />
        {upcoming.length === 0 ? (
          <EmptyState
            title="No court dates ahead"
            hint="Post a court update with a next date, or fix one from the matter, and the sitting appears here."
            action={<Link href="/firm/matters" className="text-sm text-brand underline">Open a matter</Link>}
          />
        ) : (
          <ul className="divide-y divide-gray-100">
            {days.map((day) => (
              <li key={day.label} className="px-4 py-4 sm:px-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{day.label}</p>
                <ul className="mt-2 space-y-3">
                  {day.rows.map((row) => (
                    <li key={row.court_event_id} id={`event-${row.court_event_id}`}>
                      <p className="text-sm font-medium text-gray-900">
                        {formatWhen(row.scheduled_at, tz, { timeStyle: "short" })} · {row.cause_title}
                      </p>
                      <p className="text-xs text-gray-600">
                        {row.suit_number ?? row.reference}
                        {row.court ? ` · ${row.court}` : ""}
                        {row.courtroom ? ` · ${row.courtroom}` : ""}
                        {row.judge ? ` · ${row.judge}` : ""}
                        {row.purpose || row.purpose_kind ? ` · ${row.purpose ?? (row.purpose_kind ?? "").replace(/_/g, " ")}` : ""}
                        {row.source === "hearing_notice" ? " · from a hearing notice" : ""}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-3">
                        <Link href={`/firm/matters/${row.matter_id}`} className="text-xs text-brand underline">Open the matter →</Link>
                      </div>

                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-medium text-gray-700 marker:text-brand">
                          <span className="ml-1 underline">Date vacated</span>
                        </summary>
                        <form action={vacate} className="mt-2 space-y-2 rounded-lg border border-gray-200 p-3">
                          <input type="hidden" name="eventId" value={row.court_event_id} />
                          <input type="hidden" name="tz" value={tz} />
                          <input type="hidden" name="firm" value={sp.firm ?? ""} />
                          <div>
                            <label htmlFor={`vr_${row.court_event_id}`} className="text-sm font-medium text-gray-900">
                              Why the date was vacated <span className="text-red-700">*</span>
                            </label>
                            <p className="text-xs text-gray-500">Your client reads this on the timeline.</p>
                            <input
                              id={`vr_${row.court_event_id}`} name="reason" type="text" required minLength={3} maxLength={500}
                              placeholder="The judge is on election duty" className={field}
                            />
                          </div>
                          <div className="flex flex-wrap items-end gap-3">
                            <div className="min-w-[9rem] flex-1">
                              <label htmlFor={`vd_${row.court_event_id}`} className="text-sm font-medium text-gray-900">Refixed to (if the registry gave a date)</label>
                              <input id={`vd_${row.court_event_id}`} name="newDate" type="date" className={field} />
                            </div>
                            <div className="w-28">
                              <label htmlFor={`vt_${row.court_event_id}`} className="text-sm font-medium text-gray-900">Time</label>
                              <input id={`vt_${row.court_event_id}`} name="newTime" type="time" defaultValue="09:00" className={field} />
                            </div>
                          </div>
                          <div>
                            <label htmlFor={`vp_${row.court_event_id}`} className="text-sm font-medium text-gray-900">Fixed for</label>
                            <input
                              id={`vp_${row.court_event_id}`} name="newPurpose" type="text" maxLength={200}
                              placeholder={row.purpose ?? "hearing"} className={field}
                            />
                          </div>
                          <button
                            type="submit"
                            className="min-h-[44px] w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-brand hover:bg-black/5"
                          >
                            Record the vacated date
                          </button>
                          <p className="text-xs text-gray-500">
                            Leave the date blank if the registry has not refixed it — the matter is then marked as awaiting a date.
                          </p>
                        </form>
                      </details>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
