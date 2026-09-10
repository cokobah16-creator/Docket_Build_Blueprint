import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { firmById } from "@/lib/tenant";
import { formatWhen } from "@/lib/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusPill, type Status } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { ConsultationRoom } from "@/components/video/consultation-room";
import { markNoShow } from "@/lib/actions/video";
import { NotesForm } from "./notes-form";
import { RescheduleForm } from "./reschedule-form";

export const metadata = { title: "Appointment" };

interface Appt {
  id: string; firm_id: string; reference: string; status: string; mode: string; starts_at: string; ends_at: string;
  client_id: string; lawyer_id: string | null; service_id: string | null; client_timezone: string | null; cancellation_reason: string | null;
}

export default async function FirmAppointmentPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string; notes?: string }> }) {
  const { id } = await params;
  const { error: actionError, saved } = await searchParams;
  const supabase = await supabaseServer();
  if (!supabase) redirect("/firm/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/firm/login");

  const { data } = await supabase
    .from("appointments")
    .select("id, firm_id, reference, status, mode, starts_at, ends_at, client_id, lawyer_id, service_id, client_timezone, cancellation_reason")
    .eq("id", id)
    .maybeSingle();
  const appt = (data ?? null) as Appt | null;
  if (!appt) notFound();

  const [{ data: me }, { data: client }, { data: service }, { data: intake }, { data: notesRow }, { data: internalRow }, { data: sessionRow }, firm] = await Promise.all([
    supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle(),
    supabase.from("profiles").select("full_name, phone, email").eq("id", appt.client_id).maybeSingle(),
    appt.service_id ? supabase.from("services").select("name, duration_min").eq("id", appt.service_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("intake_responses").select("answers").eq("appointment_id", appt.id).maybeSingle(),
    supabase.from("consultation_notes").select("client_summary, advice_given, follow_up, updated_at").eq("appointment_id", appt.id).maybeSingle(),
    supabase.from("consultation_internal_notes").select("body").eq("appointment_id", appt.id).maybeSingle(),
    supabase.from("consultation_sessions").select("room_name, started_at, client_admitted_at, ended_at").eq("appointment_id", appt.id).maybeSingle(),
    firmById(appt.firm_id),
  ]);
  const tz = (me as { timezone: string } | null)?.timezone ?? firm?.timezone ?? "Africa/Lagos";
  const cl = client as { full_name: string | null; phone: string | null; email: string | null } | null;
  const svc = service as { name: string; duration_min: number } | null;
  const answers = ((intake as { answers: Record<string, unknown> } | null)?.answers ?? null) as Record<string, unknown> | null;
  const notes = notesRow as { client_summary: string | null; advice_given: string | null; follow_up: string | null; updated_at: string } | null;
  const internal = internalRow as { body: string | null } | null;
  const session = sessionRow as { room_name: string | null; started_at: string | null; client_admitted_at: string | null; ended_at: string | null } | null;

  const live = appt.status === "confirmed" || appt.status === "rescheduled";
  const startMs = new Date(appt.starts_at).getTime();
  const endMs = new Date(appt.ends_at).getTime();
  const nowMs = Date.now();
  const roomOpen = live && appt.mode === "virtual" && nowMs <= endMs + 60 * 60 * 1000;
  const canNoShow = live && nowMs > startMs;
  const appointmentId = appt.id;
  const noShow = async () => {
    "use server";
    const r = await markNoShow(appointmentId);
    redirect(`/firm/appointments/${appointmentId}${r?.error ? `?error=${encodeURIComponent(r.error)}` : ""}`);
  };

  return (
    <div className="space-y-5">
      <p className="text-sm"><Link href="/firm/appointments" className="text-brand underline">← Appointments</Link></p>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-brand">{svc?.name ?? "Consultation"} · {cl?.full_name ?? "Client"}</h1>
          <p className="text-sm text-gray-600">
            {appt.reference} · {formatWhen(appt.starts_at, tz, { dateStyle: "full", timeStyle: "short" })} ({tz}) · {svc?.duration_min ?? Math.round((endMs - startMs) / 60000)} min · {appt.mode.replace("_", " ")}
          </p>
        </div>
        <StatusPill status={appt.status as Status} />
      </header>

      {actionError && <Alert kind="error">{actionError}</Alert>}
      {saved && <Alert kind="success">Notes saved. {appt.status === "completed" ? "The appointment is marked completed and the client can see the summary." : ""}</Alert>}
      {appt.status === "cancelled" && appt.cancellation_reason && <Alert kind="warning">Cancelled: {appt.cancellation_reason}</Alert>}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {roomOpen && (
            <Card>
              <CardHeader title="Consultation room" />
              <CardBody>
                <ConsultationRoom
                  appointmentId={appt.id}
                  role="owner"
                  startsAt={appt.starts_at}
                  endsAt={appt.ends_at}
                  counterpartLabel={cl?.full_name ?? "the client"}
                  accent={firm?.brand?.colours?.primary ?? "#0F2A44"}
                  notesHref={`/firm/appointments/${appt.id}?notes=1#notes`}
                  doneHref={`/firm/appointments/${appt.id}`}
                />
              </CardBody>
            </Card>
          )}

          {(live || appt.status === "completed") && (
            <Card>
              <CardHeader title={notes ? "Consultation notes" : "Write consultation notes"} />
              <CardBody>
                <div id="notes" />
                <NotesForm
                  appointmentId={appt.id}
                  initial={{
                    clientSummary: notes?.client_summary ?? "",
                    adviceGiven: notes?.advice_given ?? "",
                    followUp: notes?.follow_up ?? "",
                    internalNotes: internal?.body ?? "",
                  }}
                  canComplete={live}
                />
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Client" />
            <CardBody>
              <dl className="space-y-2 text-sm">
                <div><dt className="text-gray-500">Name</dt><dd className="font-medium text-gray-900">{cl?.full_name ?? "—"}</dd></div>
                <div><dt className="text-gray-500">Phone</dt><dd className="font-medium text-gray-900">{cl?.phone ?? "—"}</dd></div>
                <div><dt className="text-gray-500">Email</dt><dd className="font-medium text-gray-900">{cl?.email ?? "—"}</dd></div>
                {appt.client_timezone && appt.client_timezone !== tz && (
                  <div><dt className="text-gray-500">Client's time</dt><dd className="font-medium text-gray-900">{formatWhen(appt.starts_at, appt.client_timezone)} ({appt.client_timezone})</dd></div>
                )}
              </dl>
            </CardBody>
          </Card>

          {answers && Object.keys(answers).length > 0 && (
            <Card>
              <CardHeader title="Intake answers" />
              <CardBody>
                <dl className="space-y-2 text-sm">
                  {Object.entries(answers).map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-gray-500">{k.replace(/_/g, " ")}</dt>
                      <dd className="whitespace-pre-wrap font-medium text-gray-900">
                        {Array.isArray(v) ? v.map((x) => (typeof x === "object" && x && "name" in (x as object) ? String((x as { name: string }).name) : String(x))).join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardBody>
            </Card>
          )}

          {session && (
            <Card>
              <CardHeader title="Session" />
              <CardBody>
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between gap-2"><dt className="text-gray-500">Started</dt><dd>{session.started_at ? formatWhen(session.started_at, tz, { timeStyle: "short" }) : "—"}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-gray-500">Client admitted</dt><dd>{session.client_admitted_at ? formatWhen(session.client_admitted_at, tz, { timeStyle: "short" }) : "—"}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-gray-500">Ended</dt><dd>{session.ended_at ? formatWhen(session.ended_at, tz, { timeStyle: "short" }) : "—"}</dd></div>
                </dl>
              </CardBody>
            </Card>
          )}

          {live && (
            <Card>
              <CardHeader title="Reschedule" />
              <CardBody>
                <RescheduleForm appointmentId={appt.id} firmId={appt.firm_id} lawyerId={appt.lawyer_id} serviceId={appt.service_id} timezone={tz} />
              </CardBody>
            </Card>
          )}

          {canNoShow && (
            <Card>
              <CardHeader title="Client did not attend?" />
              <CardBody className="space-y-2">
                <p className="text-sm text-gray-600">Marks the appointment as a no-show. The client keeps their receipt; nothing is refunded automatically.</p>
                <form action={noShow}><Button type="submit" variant="ghost">Mark as no-show</Button></form>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
