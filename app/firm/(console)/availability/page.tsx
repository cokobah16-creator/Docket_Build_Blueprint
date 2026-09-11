// Availability: what a lawyer's week looks like, and therefore what the public
// booking wizard can offer a client. The editor writes availability_rules and
// availability_exceptions; the preview underneath asks the booking engine
// itself — available_slots() — what it would actually offer over the next
// fortnight, so nobody has to guess.
//
// Rules enforced here:
//  · The database is the authorization layer. Every read and write runs as the
//    signed-in staff member and no service key is used. availability_rules_write
//    allows (lawyer_id = auth.uid() and staff_w) or admin_w, so this screen shows
//    the lawyer picker only to an owner or admin — everyone else edits their own
//    week, which is the only week the database would let them write anyway.
//  · Timestamps are UTC in the database and rendered in the viewer's zone
//    (ctx.timezone) with Intl.DateTimeFormat. The rules themselves are times of
//    day in the LAWYER'S zone, because that is the zone available_slots() reads
//    (coalesce(profiles.timezone, firms.timezone)); when the two differ the
//    screen says so instead of quietly showing one as the other.
//  · Nothing firm-specific: the firm, its people and its services come from
//    context, never from code.
//  · Nothing fake. With no active service the wizard can offer nothing at all,
//    so the preview says exactly that rather than inventing slots.

import { firmStaff, requestedFirmId, staffContext, staffLabel, availabilityFor, WEEKDAYS } from "@/lib/firm-data";
import { zonedDayRange } from "@/lib/time";
import { Alert } from "@/components/ui/alert";
import {
  AppButton,
  AppButtonLink,
  AppCard,
  AppCardHeader,
  AppCardList,
  AppEmpty,
  AppLink,
  Footnote,
  ScreenTitle,
} from "@/components/app";
import { cn } from "@/lib/cn";
import type { AppointmentSlot, AvailabilityException, ServiceRow } from "@/lib/db/types";
import { AvailabilityEditor } from "./availability-editor";

export const metadata = { title: "Availability" };

const PREVIEW_DAYS = 14;
const BOOKED_STATUSES = ["pending", "awaiting_payment", "confirmed", "rescheduled"];
// The console's own field: neutral edge, 44px of thumb, and a focus ring in the
// shell's ink rather than any firm's colour.
const field =
  "mt-1.5 min-h-[44px] w-full rounded-[9px] border border-dk-field bg-white px-3 py-[11px] text-[14px] text-dk-strong focus:border-dk-pri focus:outline-none";

/** Calendar-date arithmetic on a YYYY-MM-DD, done at noon UTC so no zone can shift the day. */
function addDays(ymd: string, days: number): string {
  const at = new Date(`${ymd}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

function weekdayOf(ymd: string): number {
  return new Date(`${ymd}T12:00:00Z`).getUTCDay();
}

function dayLabel(ymd: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(`${ymd}T12:00:00Z`));
}

/** One day of the fortnight preview, as the booking engine itself answered it. */
interface SlotResult {
  slots: AppointmentSlot[];
  error: string | null;
}

interface PreviewDay {
  ymd: string;
  weekday: number;
  slots: AppointmentSlot[];
  error: string | null;
  booked: number;
  cap: number | null;
  hasHours: boolean;
  blockedAllDay: AvailabilityException | null;
  blockedPart: AvailabilityException[];
}

export default async function AvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ firm?: string; lawyer?: string }>;
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

  const { supabase, firmId, userId, isAdmin, timezone: viewerTz } = ctx;
  const staff = await firmStaff(supabase, firmId);

  // Only an owner or admin may look at — or write — someone else's week.
  const requested = sp.lawyer && staff.some((m) => m.user_id === sp.lawyer) ? sp.lawyer : null;
  const lawyerId = isAdmin && requested ? requested : userId;
  const isSelf = lawyerId === userId;
  const member = staff.find((m) => m.user_id === lawyerId) ?? null;
  const lawyerName = member ? staffLabel(member) : isSelf ? "You" : "This colleague";

  const [rules, { data: profileRow }, { data: firmRow }, { data: serviceRows }] = await Promise.all([
    availabilityFor(supabase, firmId, lawyerId),
    supabase.from("profiles").select("timezone").eq("id", lawyerId).maybeSingle(),
    // available_slots() only looks at an active firm — it reads the zone from a
    // `where f.status = 'active'` row and returns nothing at all when there is
    // none. Without the status the preview below would explain fourteen empty
    // days with reasons that never applied.
    supabase.from("firms").select("timezone, status").eq("id", firmId).maybeSingle(),
    supabase
      .from("services")
      .select("id, firm_id, slug, name, description, price_minor, currency, duration_min, virtual_available, is_active, sort")
      .eq("firm_id", firmId)
      .order("sort", { ascending: true })
      .limit(50),
  ]);

  // available_slots() reads the lawyer's own zone, falling back to the firm's.
  const lawyerTz =
    (profileRow as { timezone: string | null } | null)?.timezone ??
    (firmRow as { timezone: string | null } | null)?.timezone ??
    viewerTz;
  const zonesDiffer = lawyerTz !== viewerTz;

  const services = (serviceRows ?? []) as ServiceRow[];
  const active = services.filter((s) => s.is_active);
  const service = active[0] ?? null;

  const { ymd: todayYmd, start: windowStart } = zonedDayRange(lawyerTz);
  const days = Array.from({ length: PREVIEW_DAYS }, (_, i) => addDays(todayYmd, i));
  const windowEnd = new Date(windowStart.getTime() + (PREVIEW_DAYS + 1) * 86_400_000);

  // One call to the booking engine per day: the preview is what it would really
  // offer, not a re-implementation of it in TypeScript.
  const slotsForDays = async (): Promise<SlotResult[]> => {
    const svc = service;
    if (!svc) return [];
    return Promise.all(
      days.map(async (day): Promise<SlotResult> => {
        const { data, error } = await supabase.rpc("available_slots", {
          p_firm: firmId,
          p_lawyer: lawyerId,
          p_service: svc.id,
          p_date: day,
        });
        return { slots: (data ?? []) as AppointmentSlot[], error: error?.message ?? null };
      }),
    );
  };

  const [{ data: exceptionRows }, { data: apptRows }, slotResults] = await Promise.all([
    supabase
      .from("availability_exceptions")
      .select("id, firm_id, lawyer_id, on_date, is_available, start_time, end_time, reason")
      .eq("firm_id", firmId)
      .eq("lawyer_id", lawyerId)
      .gte("on_date", todayYmd)
      .order("on_date", { ascending: true })
      .limit(120),
    supabase
      .from("appointments")
      .select("id, starts_at, status")
      .eq("firm_id", firmId)
      .eq("lawyer_id", lawyerId)
      .in("status", BOOKED_STATUSES)
      .gte("starts_at", windowStart.toISOString())
      .lt("starts_at", windowEnd.toISOString())
      .limit(500),
    slotsForDays(),
  ]);

  const exceptions = (exceptionRows ?? []) as AvailabilityException[];
  const firmActive = (firmRow as { status?: string } | null)?.status === "active";
  const appointments = (apptRows ?? []) as Array<{ id: string; starts_at: string; status: string }>;

  // The engine counts a day in the lawyer's zone, so the diary is grouped the same way.
  const ymdIn = new Intl.DateTimeFormat("en-CA", { timeZone: lawyerTz, year: "numeric", month: "2-digit", day: "2-digit" });
  const bookedByDay = new Map<string, number>();
  for (const a of appointments) {
    const key = ymdIn.format(new Date(a.starts_at));
    bookedByDay.set(key, (bookedByDay.get(key) ?? 0) + 1);
  }

  // The cap the engine applies to a weekday is the one on its first block: it stops
  // reading blocks the moment the day's booked count reaches that block's cap.
  const capByWeekday = new Map<number, number>();
  const hoursByWeekday = new Map<number, boolean>();
  for (const r of rules) {
    hoursByWeekday.set(r.weekday, true);
    if (!capByWeekday.has(r.weekday)) capByWeekday.set(r.weekday, r.max_per_day);
  }

  const preview: PreviewDay[] = days.map((ymd, i) => {
    const result: SlotResult | undefined = slotResults[i];
    const onDay = exceptions.filter((e) => e.on_date === ymd && !e.is_available);
    const weekday = weekdayOf(ymd);
    return {
      ymd,
      weekday,
      slots: result?.slots ?? [],
      error: result?.error ?? null,
      booked: bookedByDay.get(ymd) ?? 0,
      cap: capByWeekday.get(weekday) ?? null,
      hasHours: hoursByWeekday.get(weekday) ?? false,
      blockedAllDay: onDay.find((e) => !e.start_time) ?? null,
      blockedPart: onDay.filter((e) => Boolean(e.start_time)),
    };
  });

  const timeFmt = new Intl.DateTimeFormat("en-GB", { timeStyle: "short", timeZone: viewerTz });
  const totalSlots = preview.reduce((n, d) => n + d.slots.length, 0);
  const previewError = preview.find((d) => d.error)?.error ?? null;

  function whyEmpty(day: PreviewDay): string {
    // The engine never looked at the week, so no reason drawn from the week is true.
    if (!firmActive) return "The firm is not active, so the booking engine offers nothing at all this week or any other.";
    if (day.blockedAllDay) {
      const reason = day.blockedAllDay.reason?.trim();
      return reason ? `Blocked — ${reason}.` : "Blocked for the whole day.";
    }
    if (!day.hasHours) return `No hours set for a ${WEEKDAYS[day.weekday]}.`;
    if (day.cap !== null && day.booked >= day.cap) {
      return `${day.booked} already booked — that is the daily cap of ${day.cap}, so the day is closed to new bookings.`;
    }
    // The engine counts this lawyer's day across every firm they sit in; this page
    // can only see the appointments of the firm being viewed, so a day that looks
    // under the cap here may be at the cap there.
    if (day.cap !== null && day.hasHours) {
      return `The booking engine counts this lawyer's whole day, including any other firm they sit in, and found no room. This firm has ${day.booked} of the cap of ${day.cap}.`;
    }
    if (day.ymd === todayYmd) return "Nothing left today: a slot is only offered if it starts more than two hours from now.";
    if (day.blockedPart.length > 0) return "What the hours would offer is blocked or already booked.";
    return "Every slot is taken, or falls in a break.";
  }

  return (
    <div className="dk-rise flex flex-col gap-3.5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <ScreenTitle>Availability</ScreenTitle>
          <p className="mt-[3px] text-[12.5px] leading-snug text-dk-soft">
            {ctx.firmName} · {isSelf ? "your week" : `${lawyerName}'s week`} · hours in {lawyerTz}
            {zonesDiffer ? `, slot times shown in ${viewerTz}` : ""}
          </p>
        </div>
        <AppButtonLink href="/firm/appointments" variant="ghost-sm" className="self-start">
          Consultations
        </AppButtonLink>
      </header>

      {isAdmin && staff.length > 1 ? (
        <AppCard>
          {/* One row, ending flush: the select grows and the 44px control sits
              on its baseline at every width. */}
          <form method="get" action="/firm/availability" className="flex items-end gap-2 px-[17px] py-[15px]">
            {sp.firm && <input type="hidden" name="firm" value={sp.firm} />}
            <div className="min-w-0 flex-1">
              <label htmlFor="lawyer" className="text-[13px] font-semibold text-dk-strong">Whose week</label>
              <select id="lawyer" name="lawyer" defaultValue={lawyerId} className={field}>
                {staff.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {staffLabel(m)}{m.user_id === userId ? " (you)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <AppButton type="submit" variant="ghost-sm">
              Open
            </AppButton>
          </form>
        </AppCard>
      ) : (
        !isAdmin && (
          <Alert kind="info">
            You are editing your own week. An owner or admin of {ctx.firmName} can edit anyone's — the database allows
            nobody else.
          </Alert>
        )
      )}

      <AvailabilityEditor
        key={lawyerId}
        firmId={firmId}
        lawyerId={lawyerId}
        lawyerName={lawyerName}
        lawyerTimezone={lawyerTz}
        isSelf={isSelf}
        canEdit={isAdmin || isSelf}
        todayYmd={todayYmd}
        initialRules={rules}
        initialExceptions={exceptions}
      />

      <AppCard>
        <AppCardHeader
          title="What a client would be offered"
          action={
            service ? (
              <span className="hidden flex-none text-[11.5px] text-dk-soft sm:inline">
                next {PREVIEW_DAYS} days · {totalSlots} slot{totalSlots === 1 ? "" : "s"}
              </span>
            ) : undefined
          }
        />
        {!service ? (
          <AppEmpty
            title="No active service, so nothing can be booked at all"
            hint={
              services.length > 0
                ? `The wizard offers slots for a service, and ${services.map((s) => s.name).join(", ")} ${services.length === 1 ? "is" : "are"} in the catalogue but not active. Until an owner or admin activates one — with a fee and a length — this week changes nothing a client can see.`
                : "The wizard offers slots for a service, and this firm has none in its catalogue yet. Until an owner or admin adds one — with a fee and a length — this week changes nothing a client can see."
            }
            action={<AppLink href="/firm/appointments">See the consultations already booked</AppLink>}
          />
        ) : (
          <>
            {previewError && (
              <div className="px-[17px] pt-[15px]">
                <Alert kind="error" title="The booking engine refused this">{previewError}</Alert>
              </div>
            )}
            <p className="px-[17px] py-[15px] text-[12.5px] leading-[1.55] text-dk-soft">
              Computed by the booking engine itself for{" "}
              <span className="font-semibold text-dk-strong">{service.name}</span> ({service.duration_min} minutes), the
              first active service. A longer or shorter service produces different times.
              {zonesDiffer ? ` Times below are in your zone, ${viewerTz}.` : ""}
            </p>
            <AppCardList className="border-t border-dk-rule">
              {preview.map((day) => {
                const first = day.slots[0];
                const last = day.slots[day.slots.length - 1];
                const isToday = day.ymd === todayYmd;
                return (
                  <div key={day.ymd} className="flex items-start justify-between gap-3 px-[15px] py-[13px]">
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-semibold leading-[1.35] text-dk-strong">
                        {dayLabel(day.ymd)}
                        {isToday ? " · today" : ""}
                      </p>
                      <p className="mt-[3px] text-[11.5px] leading-[1.45] text-dk-soft">
                        {day.slots.length > 0 ? (
                          <>
                            {first && last
                              ? `${timeFmt.format(new Date(first.starts_at))} – ${timeFmt.format(new Date(last.ends_at))}`
                              : ""}
                            {day.booked > 0 ? ` · ${day.booked} already booked in this firm` : ""}
                            {day.cap !== null ? ` · cap ${day.cap}` : ""}
                            {day.blockedPart.length > 0 ? " · part of the day is blocked" : ""}
                          </>
                        ) : (
                          whyEmpty(day)
                        )}
                      </p>
                    </div>
                    {/* A count, not a status: a day with nothing free is neither
                        late nor unpaid, so it stays in the console's greys. */}
                    <span
                      className={cn(
                        "flex-none whitespace-nowrap rounded-full border px-2.5 py-[3px] text-[11.5px] font-semibold",
                        day.slots.length > 0
                          ? "border-dk-line bg-white text-dk-strong"
                          : "border-dk-rule bg-dk-tint text-dk-muted",
                      )}
                    >
                      {day.slots.length === 0 ? "nothing free" : `${day.slots.length} slot${day.slots.length === 1 ? "" : "s"}`}
                    </span>
                  </div>
                );
              })}
            </AppCardList>
            <div className="flex flex-col gap-1.5 border-t border-dk-rule px-[17px] py-[15px]">
              <Footnote>
                Two things trim a day even when the week says it is open. Nothing starting within{" "}
                <span className="font-semibold text-dk-soft">two hours</span> of now is ever offered — the lead time is
                fixed in the booking engine, so today always looks shorter than tomorrow. And the{" "}
                <span className="font-semibold text-dk-soft">daily cap</span> counts the appointments already in the diary
                that day: once they reach the cap, the whole day stops being offered, however many hours are left in it.
              </Footnote>
              <Footnote>A slot also disappears when it overlaps a break, a blocked range, or an appointment already booked.</Footnote>
            </div>
          </>
        )}
      </AppCard>
    </div>
  );
}
