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
import { clientTimezone } from "@/lib/portal-data";
import type { PaymentChannel } from "@/lib/providers/payments";
import { cancelAppointment, startPayment } from "@/lib/actions/booking";
import { DocumentsTab } from "@/components/portal/documents-tab";
import { BeforeCard } from "./before-card";
import type { AppointmentReadiness, DocumentRequestRow, DocumentVersionRow, DocumentRow, IntakeForm } from "@/lib/db/types";

export const metadata = { title: "Appointment" };

interface Appt {
  id: string; firm_id: string; reference: string; status: string; mode: string;
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
    .select("id, firm_id, reference, status, mode, starts_at, ends_at, client_timezone, fee_minor, currency, invoice_id, lawyer_id, service_id, hold_expires_at")
    .eq("id", id)
    .maybeSingle();
  const appt = (data ?? null) as Appt | null;
  if (!appt) notFound();

  const [{ data: service }, { data: lawyer }, { data: invoice }, { data: notesRow }, firm, { data: readinessRow }, { data: docRows }, { data: requestRows }] = await Promise.all([
    appt.service_id ? supabase.from("services").select("name, duration_min").eq("id", appt.service_id).maybeSingle() : Promise.resolve({ data: null }),
    appt.lawyer_id ? supabase.from("lawyer_public").select("full_name, title").eq("id", appt.lawyer_id).maybeSingle() : Promise.resolve({ data: null }),
    appt.invoice_id ? supabase.from("invoices").select("id, number, status, total_minor, currency").eq("id", appt.invoice_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("consultation_notes").select("client_summary, advice_given, follow_up, updated_at").eq("appointment_id", id).maybeSingle(),
    selectedFirm(supabase),
    // What is still needed before the consultation, computed by the database (migration 35).
    supabase.rpc("appointment_readiness", { p_appointment: id }),
    supabase.from("documents").select("id, firm_id, matter_id, appointment_id, name, category, client_visible, current_version_id, uploaded_by, reviewed_at, reviewed_by, created_at").eq("appointment_id", id).is("deleted_at", null).order("created_at", { ascending: false }).limit(100),
    supabase.from("document_requests").select("id, firm_id, matter_id, appointment_id, title, why, due_on, requested_by, requested_at, fulfilled_document_id, fulfilled_at, cancelled_at").eq("appointment_id", id).order("requested_at", { ascending: false }).limit(50),
  ]);
  const readiness = (readinessRow ?? null) as AppointmentReadiness | null;
  const docs = (docRows ?? []) as DocumentRow[];
  const requests = (requestRows ?? []) as DocumentRequestRow[];
  const { data: versionRows } = docs.length
    ? await supabase.from("document_versions").select("id, document_id, storage_path, mime, size_bytes, uploaded_by, created_at").in("document_id", docs.map((d) => d.id))
    : { data: [] as DocumentVersionRow[] };
  const versions = (versionRows ?? []) as DocumentVersionRow[];
  const documents = docs.map((d) => ({ ...d, version: versions.find((v) => v.id === d.current_version_id) ?? null, version_count: versions.filter((v) => v.document_id === d.id).length }));
  // The questions still to answer come from the form the readiness item names.
  const intakeItem = readiness?.items.find((i) => i.kind === "intake");
  const { data: formRow } = intakeItem?.ref ? await supabase.from("intake_forms").select("id, firm_id, service_id, name, schema").eq("id", intakeItem.ref).maybeSingle() : { data: null };
  const questions = ((formRow as IntakeForm | null)?.schema?.questions ?? []);
  const notes = notesRow as { client_summary: string | null; advice_given: string | null; follow_up: string | null; updated_at: string } | null;
  const svc = service as { name: string; duration_min: number } | null;
  const law = lawyer as { full_name: string | null; title: string | null } | null;
  const inv = invoice as { id: string; number: string; status: string; total_minor: number; currency: string } | null;

  // The zone the viewer reads in, not the one captured at booking: a document's dates belong to
  // the person looking at them, as on every other portal screen. The consultation's own time
  // stays in the zone it was booked in, which is what client_timezone is for.
  const tz = appt.client_timezone ?? "Africa/Lagos";
  const viewerTz = await clientTimezone(supabase, user.id);
  // The firm that owns this consultation. `firm` is the host or the cookie's choice, which for a
  // client of two firms can be the other one — and a document written with that firm's id is
  // refused by the row-firm trigger, so the upload simply failed.
  const { data: ownerFirm } = await supabase.from("firm_public").select("id, name").eq("id", appt.firm_id).maybeSingle();
  const apptFirm = (ownerFirm as { id: string; name: string } | null) ?? null;
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

        {appt.status === "pending" && (
          <Alert kind="info" title="Booked and held">
            The time is yours. {apptFirm?.name ?? firm?.name ?? "Your firm"} confirms it once what it asked for is in — see below.
          </Alert>
        )}

        {readiness && live && (readiness.held || readiness.items.some((i) => !i.satisfied)) && (
          <Card>
            <CardHeader title="Before your consultation" />
            <CardBody>
              <BeforeCard appointmentId={appt.id} readiness={readiness} questions={questions} />
            </CardBody>
          </Card>
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

        {live && (
          <Card>
            <CardHeader title="Documents" />
            <DocumentsTab firmId={appt.firm_id} matterId={null} appointmentId={appt.id} documents={documents} timezone={viewerTz} requests={requests} userId={user.id} />
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
