import Link from "next/link";
import { redirect } from "next/navigation";
import { loginPath } from "@/lib/auth-redirect-server";
import { supabaseServer } from "@/lib/supabase/server";
import { selectedFirm } from "@/lib/portal-firm";
import { publishedPolicyText } from "@/lib/policy-text";
import { clientStatusLabel, modeLabel } from "@/lib/client-words";
import { whenWords } from "@/lib/notifications-copy";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { StatusPill, isStatus } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { Screen } from "@/components/portal/screen";
import { PageHeader, WithAside } from "@/components/shell/layout";
import { firmPageHref } from "../firm-href";

export const metadata = { title: "Consultations" };

interface AppointmentRow {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  mode: string;
  client_timezone: string | null;
  service_id: string | null;
  lawyer_id: string | null;
  hold_expires_at: string | null;
}

/** The waiting room is offered from an hour before, as on the consultation's own page, and stays
 *  until an hour after the end. The room itself opens ten minutes before the start. */
const ROOM_OFFERED_BEFORE_MS = 60 * 60 * 1000;
const ROOM_CLOSES_AFTER_MS = 60 * 60 * 1000;

function joinable(a: AppointmentRow, now: number): boolean {
  return (
    a.mode === "virtual" &&
    (a.status === "confirmed" || a.status === "rescheduled") &&
    now >= new Date(a.starts_at).getTime() - ROOM_OFFERED_BEFORE_MS &&
    now <= new Date(a.ends_at).getTime() + ROOM_CLOSES_AFTER_MS
  );
}

/** A time still held for payment. It is paid on its own page, which shows who is paid and for
 *  what before its button, so the list links there and never opens a checkout itself. */
function payable(a: AppointmentRow, now: number): boolean {
  return a.status === "awaiting_payment" && a.hold_expires_at !== null && new Date(a.hold_expires_at).getTime() > now;
}

const rowLink =
  "min-w-0 rounded-control hover:underline focus-visible:outline focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-ink-strong";

export default async function AppointmentsPage() {
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(await loginPath("client"));
  const firm = await selectedFirm(supabase);

  let query = supabase
    .from("appointments")
    .select("id, starts_at, ends_at, status, mode, client_timezone, service_id, lawyer_id, hold_expires_at");
  if (firm) query = query.eq("firm_id", firm.id);
  const { data } = await query.order("starts_at", { ascending: false }).limit(20);
  const appointments = (data ?? []) as AppointmentRow[];

  // One lookup each for the service and lawyer names rather than one per row.
  const idsOf = (key: "service_id" | "lawyer_id") =>
    Array.from(new Set(appointments.map((a) => a[key]).filter((v): v is string => Boolean(v))));
  const serviceIds = idsOf("service_id");
  const lawyerIds = idsOf("lawyer_id");
  const [{ data: serviceRows }, { data: lawyerRows }] = await Promise.all([
    serviceIds.length ? supabase.from("services").select("id, name").in("id", serviceIds) : Promise.resolve({ data: [] }),
    lawyerIds.length ? supabase.from("lawyer_public").select("id, full_name").in("id", lawyerIds) : Promise.resolve({ data: [] }),
  ]);
  const serviceName = new Map(((serviceRows ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]));
  const lawyerName = new Map(
    ((lawyerRows ?? []) as Array<{ id: string; full_name: string | null }>)
      .filter((l) => l.full_name)
      .map((l) => [l.id, l.full_name as string]),
  );

  // One read, split in two: what is still to come, soonest first, and what has
  // been. The agenda a client actually wants is the first of those.
  const now = Date.now();
  const upcoming = appointments
    .filter((a) => new Date(a.ends_at).getTime() >= now)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = appointments.filter((a) => new Date(a.ends_at).getTime() < now);
  const bookHref = firm ? await firmPageHref(firm, "/book") : null;
  const firmWords = firm?.name ?? "your firm";
  // The list shows one firm's consultations when a firm is selected, so its own published
  // cancellation text applies to every row. A "0-" draft is not the firm's policy and is not shown.
  const cancellationText = firm ? publishedPolicyText(firm.policies.cancellation) : null;

  // The one thing this screen is for right now (docs/VOICE.md, rule 15): a call that is about to
  // start, then a time held for payment, then booking. Only that action is drawn filled. A call can
  // still be joined for an hour after its end, when it is already in the past list.
  const joinNow = appointments.find((a) => joinable(a, now)) ?? null;
  const payNow = joinNow ? null : (upcoming.find((a) => payable(a, now)) ?? null);
  const mainId = joinNow?.id ?? payNow?.id ?? null;
  const bookVariant = mainId ? "ghost" : "primary";

  const row = (a: AppointmentRow) => {
    const tz = a.client_timezone ?? "Africa/Lagos";
    const lawyer = a.lawyer_id ? lawyerName.get(a.lawyer_id) : undefined;
    const action = joinable(a, now)
      ? { href: `/app/appointments/${a.id}/waiting-room`, label: "Join the waiting room" }
      : payable(a, now)
        ? { href: `/app/appointments/${a.id}`, label: "See and pay the fee" }
        : null;
    return (
      <li key={a.id} className="flex flex-col gap-2.5 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <Link href={`/app/appointments/${a.id}`} className={rowLink}>
          <span className="block text-15 font-semibold text-ink">
            {(a.service_id && serviceName.get(a.service_id)) || "Consultation"}
          </span>
          <span className="mt-0.5 block text-13 text-ink">{whenWords(a.starts_at, tz)}</span>
          <span className="mt-0.5 block text-13 text-ink-muted">
            {modeLabel(a.mode)} with {lawyer ?? `a lawyer from ${firmWords}`}
          </span>
        </Link>
        <div className="flex shrink-0 flex-wrap items-center gap-2.5">
          {isStatus(a.status) && <StatusPill status={a.status} label={clientStatusLabel(a.status)} />}
          {action && (
            <Link href={action.href} className={buttonClasses(a.id === mainId ? "primary" : "ghost", "sm")}>
              {action.label}
            </Link>
          )}
        </div>
      </li>
    );
  };

  return (
    <Screen>
      <PageHeader
        title="Consultations"
        description={firm ? `Your consultations with ${firm.name}.` : "Your consultations."}
        actions={
          bookHref &&
          upcoming.length > 0 && (
            <Link href={bookHref} className={buttonClasses(bookVariant, "md", "hidden md:inline-flex")}>
              Book a consultation
            </Link>
          )
        }
      />

      <WithAside
        from="xl"
        aside={
          <Disclosure summary="Joining, moving and cancelling">
            <div className="flex flex-col gap-3">
              <p className="text-15 leading-relaxed text-ink">
                A video call has a waiting room. You can go in from an hour before to test your camera and microphone. The
                room opens 10 minutes before the start. There is nothing to install.
              </p>
              <p className="text-15 leading-relaxed text-ink">
                You can cancel an upcoming consultation from its page. To move it to another time, message {firmWords}.
              </p>
              {cancellationText && (
                <div className="flex flex-col gap-1">
                  <p className="text-13 font-semibold text-ink">If plans change</p>
                  <p className="text-15 leading-relaxed text-ink">{cancellationText}</p>
                </div>
              )}
            </div>
          </Disclosure>
        }
      >
        <Card>
          <CardHeader title={upcoming.length > 0 ? `Upcoming (${upcoming.length})` : "Upcoming"} />
          {upcoming.length === 0 ? (
            <EmptyState
              title={past.length > 0 ? "No upcoming consultations" : "No consultations yet"}
              hint="When you book a consultation, it shows here with its time and what to do next."
              action={
                bookHref && (
                  <Link href={bookHref} className={buttonClasses(bookVariant, "md")}>
                    Book a consultation
                  </Link>
                )
              }
            />
          ) : (
            <ul className="divide-y divide-hairline">{upcoming.map(row)}</ul>
          )}
        </Card>

        {past.length > 0 && (
          <Card>
            <CardHeader title={`Past (${past.length})`} />
            <ul className="divide-y divide-hairline">{past.map(row)}</ul>
          </Card>
        )}
      </WithAside>

      {/* Booking is offered exactly once at every width: in the empty list when nothing is
          booked, otherwise in the header from md up and here on a phone, where the header has no
          room for it and the thumb expects a full-width button at the end of the list. */}
      {bookHref && upcoming.length > 0 && (
        <Link href={bookHref} className={buttonClasses(bookVariant, "lg", "w-full md:hidden")}>
          Book a consultation
        </Link>
      )}
    </Screen>
  );
}
