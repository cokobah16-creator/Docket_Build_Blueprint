import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { formatMoneyMinor } from "@/lib/money";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusPill, type Status } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Screen, ScreenHeader, FactRow } from "@/components/portal/screen";
import { PayPanel } from "@/components/portal/pay-panel";
import { selectedFirm } from "@/lib/portal-firm";
import type { PaymentChannel } from "@/lib/providers/payments";
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
    selectedFirm(supabase),
  ]);
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
  const lawyerName = law?.full_name ?? "your lawyer";
  const appointmentId = appt.id;
  const pay = async (channel: PaymentChannel) => {
    "use server";
    const r = await startPayment(appointmentId, channel);
    if (r?.error) return r;
  };
  // Form actions must return void; errors come back through the query string.
  const cancel = async () => {
    "use server";
    const r = await cancelAppointment(appointmentId);
    if (r?.error) redirect(`/app/appointments/${appointmentId}?error=${encodeURIComponent(r.error)}`);
    redirect(`/app/appointments/${appointmentId}`);
  };

  return (
    <>
      <ScreenHeader back="/app/appointments" backLabel="Back to appointments" title={appt.reference} titleAs="mono" />
      <Screen>
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-heading text-[22px] font-semibold leading-tight tracking-[-0.015em] text-brand">
            {svc?.name ?? "Consultation"}
          </h1>
          <StatusPill status={appt.status as Status} />
        </div>

        {actionError && <Alert kind="error">{actionError}</Alert>}

        {appt.status === "awaiting_payment" && inv && inv.status !== "paid" && (
          <PayPanel
            amount={formatMoneyMinor(inv.total_minor, inv.currency)}
            invoiceNumber={inv.number}
            description={`${svc?.name ?? "Consultation"} · ${when}`}
            holdExpiresAt={appt.hold_expires_at}
            firmName={firm?.name ?? "your firm"}
            onPay={pay}
          />
        )}

        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <dl className="space-y-3">
              <FactRow label="When">{when}</FactRow>
              <FactRow label="Timezone">{tz}</FactRow>
              <FactRow label="Lawyer">{law?.full_name ?? "Assigned lawyer"}{law?.title ? ` · ${law.title}` : ""}</FactRow>
              <FactRow label="Format">{appt.mode.replace("_", " ")}</FactRow>
              {svc && <FactRow label="Duration">{svc.duration_min} minutes</FactRow>}
              {inv && (
                <FactRow label="Invoice">
                  <Link href={`/app/payments/${inv.id}`} className="font-mono text-brand underline underline-offset-2">{inv.number}</Link>
                  {" · "}{formatMoneyMinor(inv.total_minor, inv.currency)} · {inv.status.replace("_", " ")}
                </FactRow>
              )}
            </dl>
          </CardBody>
        </Card>

        {appt.status === "rescheduled" && upcoming && (
          <Alert kind="info" title="This appointment was moved">
            Your new time is shown above. Reminders will be sent again for the new time.
          </Alert>
        )}

        {roomOpen && (
          <Card>
            <CardHeader title="Video consultation" />
            <CardBody className="space-y-3">
              <p className="text-[13.5px] leading-relaxed text-gray-700">
                The waiting room opens at{" "}
                <strong className="text-gray-900">{new Intl.DateTimeFormat("en-GB", { timeStyle: "short", timeZone: tz }).format(opensAt)}</strong>, 10 minutes before
                your consultation. Test your camera and microphone there, then wait for {lawyerName} to admit you.
              </p>
              <Link href={`/app/appointments/${appt.id}/waiting-room`} className={buttonClasses("primary", "lg", "w-full")}>
                Go to the waiting room
              </Link>
            </CardBody>
          </Card>
        )}

        {notes && notes.client_summary && (
          <Card>
            <CardHeader title="Your consultation summary" />
            <CardBody className="space-y-3 text-[13.5px] leading-relaxed text-gray-800">
              <p className="whitespace-pre-wrap">{notes.client_summary}</p>
              {notes.advice_given && (
                <div><p className="text-[11px] uppercase tracking-wide text-gray-500">Advice</p><p className="whitespace-pre-wrap">{notes.advice_given}</p></div>
              )}
              {notes.follow_up && (
                <div><p className="text-[11px] uppercase tracking-wide text-gray-500">Next steps</p><p className="whitespace-pre-wrap">{notes.follow_up}</p></div>
              )}
              <p className="text-[11.5px] text-gray-500">
                Written by your lawyer ·{" "}
                {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: tz }).format(new Date(notes.updated_at))}
              </p>
            </CardBody>
          </Card>
        )}

        {live && upcoming && (
          <>
            <form action={cancel}><Button type="submit" variant="ghost" size="lg" className="w-full">Cancel appointment</Button></form>
            <p className="text-[11.5px] leading-relaxed text-gray-500">
              Consultations may be rescheduled or cancelled free of charge up to 24 hours before the appointment.
            </p>
          </>
        )}
      </Screen>
    </>
  );
}
