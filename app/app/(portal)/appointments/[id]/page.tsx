import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { formatMoneyMinor } from "@/lib/money";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusPill, type Status } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

  const [{ data: service }, { data: lawyer }, { data: invoice }, { data: notesRow }] = await Promise.all([
    appt.service_id ? supabase.from("services").select("name, duration_min").eq("id", appt.service_id).maybeSingle() : Promise.resolve({ data: null }),
    appt.lawyer_id ? supabase.from("lawyer_public").select("full_name, title").eq("id", appt.lawyer_id).maybeSingle() : Promise.resolve({ data: null }),
    appt.invoice_id ? supabase.from("invoices").select("id, number, status, total_minor, currency").eq("id", appt.invoice_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("consultation_notes").select("client_summary, advice_given, follow_up, updated_at").eq("appointment_id", id).maybeSingle(),
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
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-brand">{svc?.name ?? "Consultation"}</h1>
          <p className="text-sm text-gray-600">{appt.reference}</p>
        </div>
        <StatusPill status={appt.status as Status} />
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

      <Card>
        <CardHeader title="Details" />
        <CardBody>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-gray-500">When</dt><dd className="text-right font-medium text-gray-900">{when} ({tz})</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-gray-500">Lawyer</dt><dd className="font-medium text-gray-900">{law?.full_name ?? "Assigned lawyer"}{law?.title ? ` · ${law.title}` : ""}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-gray-500">Format</dt><dd className="font-medium text-gray-900">{appt.mode.replace("_", " ")}</dd></div>
            {svc && <div className="flex justify-between gap-4"><dt className="text-gray-500">Duration</dt><dd className="font-medium text-gray-900">{svc.duration_min} minutes</dd></div>}
            {inv && (
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Invoice</dt>
                <dd className="text-right font-medium text-gray-900">
                  <Link href={`/app/payments/${inv.id}`} className="text-brand underline">{inv.number}</Link>{" "}
                  · {formatMoneyMinor(inv.total_minor, inv.currency)} · {inv.status.replace("_", " ")}
                </dd>
              </div>
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
            <p className="text-sm text-gray-700">
              The waiting room opens at{" "}
              <strong>{new Intl.DateTimeFormat("en-GB", { timeStyle: "short", timeZone: tz }).format(opensAt)}</strong>, 10 minutes before
              your consultation. Test your camera and microphone there, then wait for your lawyer to admit you.
            </p>
            <Link href={`/app/appointments/${appt.id}/waiting-room`} className="inline-flex w-full items-center justify-center rounded-lg bg-brand px-6 py-3.5 text-base font-medium text-brand-on hover:opacity-90">
              Go to the waiting room
            </Link>
          </CardBody>
        </Card>
      )}

      {notes && notes.client_summary && (
        <Card>
          <CardHeader title="Your consultation summary" />
          <CardBody className="space-y-3 text-sm text-gray-800">
            <p className="whitespace-pre-wrap">{notes.client_summary}</p>
            {notes.advice_given && (
              <div><p className="text-xs uppercase tracking-wide text-gray-500">Advice</p><p className="whitespace-pre-wrap">{notes.advice_given}</p></div>
            )}
            {notes.follow_up && (
              <div><p className="text-xs uppercase tracking-wide text-gray-500">Next steps</p><p className="whitespace-pre-wrap">{notes.follow_up}</p></div>
            )}
            <p className="text-xs text-gray-500">
              Written by your lawyer ·{" "}
              {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: tz }).format(new Date(notes.updated_at))}
            </p>
          </CardBody>
        </Card>
      )}

      <div className="flex flex-wrap gap-3">
        {appt.status === "awaiting_payment" && inv && inv.status !== "paid" && (
          <form action={pay}><Button type="submit" size="lg">Pay {formatMoneyMinor(inv.total_minor, inv.currency)}</Button></form>
        )}
        {live && upcoming && (
          <form action={cancel}><Button type="submit" variant="ghost">Cancel appointment</Button></form>
        )}
      </div>
    </div>
  );
}
