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
//
// On the phone kit as the console's own screen. The chase list keeps the
// amber edge it has on Today, because an unreported sitting is the one thing
// on this screen that is genuinely late — and the heading says so in words as
// well as in colour. Everything else is the shell's neutral ink.

import { redirect } from "next/navigation";
import { courtsFor, firmStaff, requestedFirmId, sittingsDue, staffContext, staffLabel } from "@/lib/firm-data";
import { vacateCourtEvent } from "@/lib/actions/court";
import { formatWhen } from "@/lib/time";
import { Alert } from "@/components/ui/alert";
import {
  AppButton,
  AppCard,
  AppCardHeader,
  AppCardList,
  AppEmpty,
  AppLink,
  Footnote,
  ScreenTitle,
} from "@/components/app";
import { ChevronDownIcon, WarningIcon } from "@/components/ui/icons";
import { CourtUpdateForm } from "@/components/firm/court-update-form";
import type { CauseListRow, SittingDue } from "@/lib/db/types";

export const metadata = { title: "Sittings" };

const field =
  "mt-1.5 min-h-[44px] w-full rounded-[9px] border border-dk-field bg-white px-3 py-[11px] text-[14px] text-dk-strong placeholder:text-dk-muted focus:border-dk-pri focus:outline-none";
const labelClass = "text-[13px] font-semibold text-dk-strong";
const hintClass = "mt-0.5 text-[11.5px] leading-snug text-dk-muted";
/** Required is said in words: colour in the console means late, unpaid or waiting on you. */
const requiredMark = <span className="font-normal text-dk-muted">(required)</span>;

/** A `<summary>` with no platform triangle — the chevron beside it is ours. */
const summaryClass =
  "flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden";

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
    <div className="dk-rise flex flex-col gap-3.5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <ScreenTitle>Sittings</ScreenTitle>
          <p className="mt-[3px] text-[12.5px] leading-snug text-dk-soft">
            {ctx.firmName} · times in {tz}
          </p>
        </div>
        <AppLink href="/firm/matters" className="mt-0.5 inline-flex min-h-[44px] flex-none items-center">
          All matters
        </AppLink>
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

      {/* The chase list, in the amber the artboard gives a backlog. The icon
          and the heading carry the same message without the colour. */}
      <section className="overflow-hidden rounded-card border border-[#E7B84B] bg-white shadow-card">
        <header className="flex items-center gap-2 border-b border-[#F3E2B3] bg-[#FFFBEB] px-[15px] py-3">
          <WarningIcon size={16} className="flex-none text-[#92400E]" />
          <h2 className="min-w-0 font-app-head text-[13.5px] font-bold text-[#7A3E0A]">
            Sittings without an update ({due.length})
          </h2>
        </header>
        {due.length === 0 ? (
          <AppEmpty
            title="Nothing to chase"
            hint="Every past sitting has an update against it. A sitting appears here four hours after its time if nobody has posted what happened."
            action={<AppLink href="/firm/matters" className="inline-flex min-h-[44px] items-center">Open a matter to post an update</AppLink>}
          />
        ) : (
          <AppCardList>
            {due.map((s: SittingDue) => {
              const matter = matterById.get(s.matter_id) ?? null;
              return (
                <div key={s.court_event_id} id={`sitting-${s.court_event_id}`} className="px-[15px] py-[13px]">
                  <details className="group">
                    <summary className={summaryClass}>
                      <span className="min-w-0 flex-1 py-1">
                        <span className="block text-[13.5px] font-semibold leading-[1.35] text-dk-strong">{s.cause_title}</span>
                        <span className="mt-[3px] block text-[11.5px] leading-[1.45] text-dk-soft">
                          <span className="font-mono">{s.suit_number ?? s.reference}</span>
                          {s.court ? ` · ${s.court}` : ""}
                          {s.purpose || s.purpose_kind ? ` · ${s.purpose ?? (s.purpose_kind ?? "").replace(/_/g, " ")}` : ""}
                        </span>
                        <span className="mt-1 block text-[11.5px] font-semibold leading-[1.45] text-[#92400E]">
                          Sat {formatWhen(s.scheduled_at, tz, { dateStyle: "medium", timeStyle: "short" })} · {sinceLabel(s.scheduled_at, nowMs)}
                          {s.lawyer_id && staffById.has(s.lawyer_id) ? ` · ${staffById.get(s.lawyer_id)}` : ""}
                        </span>
                        <span className="mt-1.5 block text-[12.5px] font-semibold text-dk-pri underline underline-offset-2">
                          Post what happened
                        </span>
                      </span>
                      <span
                        aria-hidden="true"
                        className="grid h-11 w-11 flex-none place-items-center text-dk-muted transition group-open:rotate-180"
                      >
                        <ChevronDownIcon size={18} />
                      </span>
                    </summary>
                    <div className="mt-3.5 border-t border-dk-rule pt-3.5">
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
                      <p className="mt-3">
                        <AppLink href={`/firm/matters/${s.matter_id}`} className="inline-flex min-h-[44px] items-center">Open the matter</AppLink>
                      </p>
                    </div>
                  </details>
                </div>
              );
            })}
          </AppCardList>
        )}
      </section>

      <AppCard>
        <AppCardHeader title={`In the diary (${upcoming.length})`} />
        {upcoming.length === 0 ? (
          <AppEmpty
            title="No court dates ahead"
            hint="Post a court update with a next date, or fix one from the matter, and the sitting appears here."
            action={<AppLink href="/firm/matters" className="inline-flex min-h-[44px] items-center">Open a matter</AppLink>}
          />
        ) : (
          <AppCardList>
            {days.map((day) => (
              <div key={day.label} className="px-[15px] py-[13px]">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-dk-soft">{day.label}</p>
                <ul className="mt-2.5 flex flex-col gap-3.5">
                  {day.rows.map((row) => (
                    <li key={row.court_event_id} id={`event-${row.court_event_id}`}>
                      <p className="text-[13.5px] font-semibold leading-[1.35] text-dk-strong">
                        <span className="font-mono">{formatWhen(row.scheduled_at, tz, { timeStyle: "short" })}</span>
                        {" · "}
                        {row.cause_title}
                      </p>
                      <p className="mt-[3px] text-[11.5px] leading-[1.45] text-dk-soft">
                        <span className="font-mono">{row.suit_number ?? row.reference}</span>
                        {row.court ? ` · ${row.court}` : ""}
                        {row.courtroom ? ` · ${row.courtroom}` : ""}
                        {row.judge ? ` · ${row.judge}` : ""}
                        {row.purpose || row.purpose_kind ? ` · ${row.purpose ?? (row.purpose_kind ?? "").replace(/_/g, " ")}` : ""}
                        {row.source === "hearing_notice" ? " · from a hearing notice" : ""}
                      </p>
                      <p className="mt-1">
                        <AppLink href={`/firm/matters/${row.matter_id}`} className="inline-flex min-h-[44px] items-center">Open the matter</AppLink>
                      </p>

                      <details className="group mt-1.5">
                        <summary className={summaryClass}>
                          <span className="py-2 text-[12.5px] font-semibold text-dk-pri underline underline-offset-2">
                            Date vacated
                          </span>
                          <span
                            aria-hidden="true"
                            className="grid h-11 w-11 flex-none place-items-center text-dk-muted transition group-open:rotate-180"
                          >
                            <ChevronDownIcon size={16} />
                          </span>
                        </summary>
                        <form action={vacate} className="mt-2 flex flex-col gap-3 rounded-[10px] border border-dk-line bg-white p-3">
                          <input type="hidden" name="eventId" value={row.court_event_id} />
                          <input type="hidden" name="tz" value={tz} />
                          <input type="hidden" name="firm" value={sp.firm ?? ""} />
                          <div>
                            <label htmlFor={`vr_${row.court_event_id}`} className={labelClass}>
                              Why the date was vacated {requiredMark}
                            </label>
                            <p className={hintClass}>Your client reads this on the timeline.</p>
                            <input
                              id={`vr_${row.court_event_id}`} name="reason" type="text" required minLength={3} maxLength={500}
                              placeholder="The judge is on election duty" className={field}
                            />
                          </div>
                          <div className="flex flex-wrap items-end gap-3">
                            <div className="min-w-[9rem] flex-1">
                              <label htmlFor={`vd_${row.court_event_id}`} className={labelClass}>Refixed to (if the registry gave a date)</label>
                              <input id={`vd_${row.court_event_id}`} name="newDate" type="date" className={field} />
                            </div>
                            <div className="w-28">
                              <label htmlFor={`vt_${row.court_event_id}`} className={labelClass}>Time</label>
                              <input id={`vt_${row.court_event_id}`} name="newTime" type="time" defaultValue="09:00" className={field} />
                            </div>
                          </div>
                          <div>
                            <label htmlFor={`vp_${row.court_event_id}`} className={labelClass}>Fixed for</label>
                            <input
                              id={`vp_${row.court_event_id}`} name="newPurpose" type="text" maxLength={200}
                              placeholder={row.purpose ?? "hearing"} className={field}
                            />
                          </div>
                          <AppButton type="submit">Record the vacated date</AppButton>
                          <Footnote>
                            Leave the date blank if the registry has not refixed it — the matter is then marked as awaiting a date.
                          </Footnote>
                        </form>
                      </details>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </AppCardList>
        )}
      </AppCard>
    </div>
  );
}
