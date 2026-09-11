// Client appointment detail (design/pwa artboard, CLIENT · APPOINTMENT DETAIL):
// the reference rides in the sub-header, the service names the screen, and the
// rest is two cards — what was booked, and how to get into the room.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { currentFirm } from "@/lib/firm";
import { formatMoneyMinor } from "@/lib/money";
import {
  AppScreen,
  SubHeader,
  SubHeaderRef,
  AppCard,
  AppCardBody,
  AppCardHeader,
  AppDetail,
  AppStatusPill,
  AppButton,
  AppButtonLink,
  Footnote,
} from "@/components/app";
import type { Status } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { cancelAppointment, startPayment } from "@/lib/actions/booking";

export const metadata = { title: "Appointment" };

interface Appt {
  id: string; reference: string; status: string; mode: string;
  starts_at: string; ends_at: string; client_timezone: string | null;
  fee_minor: number | null; currency: string | null; invoice_id: string | null;
  lawyer_id: string | null; service_id: string | null; hold_expires_at: string | null;
}

export default async function AppointmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error: actionError } = await searchParams;
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/app/login");

  const { data } = await supabase
    .from("appointments")
    .select("id, reference, status, mode, starts_at, ends_at, client_timezone, fee_minor, currency, invoice_id, lawyer_id, service_id, hold_expires_at")
    .eq("id", id)
    .maybeSingle();
  const appt = (data ?? null) as Appt | null;
  if (!appt) notFound();

  const [{ data: service }, { data: lawyer }, { data: invoice }, { data: notesRow }, firm] = await Promise.all([
    appt.service_id ? supabase.from("services").select("name, duration_min").eq("id", appt.service_id).maybeSingle() : Promise.resolve({ data: null }),
    appt.lawyer_id ? supabase.from("lawyer_public").select("full_name, title").eq("id", appt.lawyer_id).maybeSingle() : Promise.resolve({ data: null }),
    appt.invoice_id ? supabase.from("invoices").select("id, number, status, total_minor, currency").eq("id", appt.invoice_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("consultation_notes").select("client_summary, advice_given, follow_up, updated_at").eq("appointment_id", id).maybeSingle(),
    // For the cancellation terms under the button. The artboard writes "free of
    // charge up to 24 hours", which is one firm's prototype policy; each firm
    // sets its own, and the public booking flow already shows this same text.
    currentFirm(),
  ]);
  const cancellation = firm?.policies.cancellation?.text;
  const notes = notesRow as { client_summary: string | null; advice_given: string | null; follow_up: string | null; updated_at: string } | null;
  const svc = service as { name: string; duration_min: number } | null;
  const law = lawyer as { full_name: string | null; title: string | null } | null;
  const inv = invoice as { id: string; number: string; status: string; total_minor: number; currency: string } | null;

  const tz = appt.client_timezone ?? "Africa/Lagos";
  const when = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: tz }).format(new Date(appt.starts_at));
  const live = ["awaiting_payment", "pending", "confirmed", "rescheduled"].includes(appt.status);
  const upcoming = new Date(appt.starts_at).getTime() > Date.now();
  const roomOpen =
    appt.mode === "virtual" &&
    (appt.status === "confirmed" || appt.status === "rescheduled") &&
    Date.now() <= new Date(appt.ends_at).getTime() + 60 * 60 * 1000;
  const opensAt = new Date(new Date(appt.starts_at).getTime() - 10 * 60 * 1000);
  const appointmentId = appt.id;
  // Form actions must return void; errors come back through the query string.
  const pay = async () => {
    "use server";
    const r = await startPayment(appointmentId);
    if (r?.error) redirect(`/app/appointments/${appointmentId}?error=${encodeURIComponent(r.error)}`);
  };
  const cancel = async () => {
    "use server";
    const r = await cancelAppointment(appointmentId);
    if (r?.error) redirect(`/app/appointments/${appointmentId}?error=${encodeURIComponent(r.error)}`);
    redirect(`/app/appointments/${appointmentId}`);
  };

  return (
    <>
      <SubHeader backHref="/app/appointments" backLabel="Back to appointments">
        <SubHeaderRef>{appt.reference}</SubHeaderRef>
      </SubHeader>

      <AppScreen>
        <header className="flex items-start justify-between gap-3">
          <h1 className="font-app-head text-[22px] font-semibold leading-[1.2] tracking-[-0.015em] text-dk-pri">
            {svc?.name ?? "Consultation"}
          </h1>
          <AppStatusPill status={appt.status as Status} />
        </header>

        {actionError && <Alert kind="error">{actionError}</Alert>}

        {appt.status === "awaiting_payment" && (
          <Alert kind="warning" title="Payment needed to confirm">
            Your slot is held until{" "}
            {appt.hold_expires_at
              ? new Intl.DateTimeFormat("en-GB", { timeStyle: "short", timeZone: tz }).format(new Date(appt.hold_expires_at))
              : "payment"}
            . Pay now to confirm it.
          </Alert>
        )}

        <AppCard>
          <AppCardHeader title="Details" />
          <AppCardBody className="flex flex-col gap-3">
            <AppDetail label="When">{when}</AppDetail>
            <AppDetail label="Timezone">{tz}</AppDetail>
            <AppDetail label="Lawyer">
              {law?.full_name ?? "Assigned lawyer"}
              {law?.title ? ` · ${law.title}` : ""}
            </AppDetail>
            <AppDetail label="Format">{appt.mode.replace(/_/g, " ")}</AppDetail>
            {svc && <AppDetail label="Duration">{svc.duration_min} minutes</AppDetail>}
            {inv && (
              <AppDetail label="Invoice">
                <Link
                  href={`/app/payments/${inv.id}`}
                  className="font-mono text-dk-pri underline underline-offset-2"
                >
                  {inv.number}
                </Link>{" "}
                · {formatMoneyMinor(inv.total_minor, inv.currency)} ·{" "}
                {inv.status.replace(/_/g, " ")}
              </AppDetail>
            )}
          </AppCardBody>
        </AppCard>

        {appt.status === "rescheduled" && upcoming && (
          <Alert kind="info" title="This appointment was moved">
            Your new time is shown above. Reminders will be sent again for the new time.
          </Alert>
        )}

        {roomOpen && (
          <AppCard>
            <AppCardHeader title="Video consultation" />
            <AppCardBody className="flex flex-col gap-3">
              <p className="text-[13.5px] leading-[1.5] text-dk-body">
                The waiting room opens at{" "}
                <strong className="font-semibold text-dk-strong">
                  {new Intl.DateTimeFormat("en-GB", { timeStyle: "short", timeZone: tz }).format(opensAt)}
                </strong>
                , 10 minutes before your consultation. Test your camera and microphone
                there, then wait for {law?.full_name ?? "your lawyer"} to admit you.
              </p>
              <AppButtonLink href={`/app/appointments/${appt.id}/waiting-room`}>
                Go to the waiting room
              </AppButtonLink>
            </AppCardBody>
          </AppCard>
        )}

        {notes && notes.client_summary && (
          <AppCard>
            <AppCardHeader title="Your consultation summary" />
            <AppCardBody className="flex flex-col gap-3 text-[13.5px] leading-[1.5] text-dk-body">
              <p className="whitespace-pre-wrap">{notes.client_summary}</p>
              {notes.advice_given && (
                <div>
                  <p className="text-[11.5px] uppercase tracking-wide text-dk-muted">Advice</p>
                  <p className="whitespace-pre-wrap">{notes.advice_given}</p>
                </div>
              )}
              {notes.follow_up && (
                <div>
                  <p className="text-[11.5px] uppercase tracking-wide text-dk-muted">Next steps</p>
                  <p className="whitespace-pre-wrap">{notes.follow_up}</p>
                </div>
              )}
              <p className="text-[11.5px] text-dk-muted">
                Written by your lawyer ·{" "}
                {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: tz }).format(new Date(notes.updated_at))}
              </p>
            </AppCardBody>
          </AppCard>
        )}

        {appt.status === "awaiting_payment" && inv && inv.status !== "paid" && (
          <form action={pay}>
            <AppButton type="submit">Pay {formatMoneyMinor(inv.total_minor, inv.currency)}</AppButton>
          </form>
        )}

        {live && upcoming && (
          <>
            <form action={cancel} className="flex">
              <AppButton type="submit" variant="ghost">Cancel appointment</AppButton>
            </form>
            {cancellation && <Footnote>{String(cancellation)}</Footnote>}
          </>
        )}
      </AppScreen>
    </>
  );
}
