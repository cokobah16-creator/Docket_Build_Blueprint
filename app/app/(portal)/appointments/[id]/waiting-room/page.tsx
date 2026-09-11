// The waiting room (design/pwa, CLIENT · WAITING ROOM): what the consultation
// is, whether this device can take it, and the choice to spend less data —
// all before the room opens.

import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { currentFirm } from "@/lib/firm";
import { firmById } from "@/lib/tenant";
import { DEFAULT_TOKENS } from "@/lib/brand";
import { ConsultationRoom } from "@/components/video/consultation-room";
import { Alert } from "@/components/ui/alert";
import { Footnote, PushedScreen, SubHeader, SubHeaderRef } from "@/components/app";

export const metadata = { title: "Waiting room" };

interface Appt {
  id: string; firm_id: string; reference: string; status: string; mode: string;
  starts_at: string; ends_at: string; client_timezone: string | null; lawyer_id: string | null; service_id: string | null;
}

export default async function WaitingRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/app/login?next=/app/appointments/${id}/waiting-room`);

  const { data } = await supabase
    .from("appointments")
    .select("id, firm_id, reference, status, mode, starts_at, ends_at, client_timezone, lawyer_id, service_id")
    .eq("id", id)
    .maybeSingle();
  const appt = (data ?? null) as Appt | null;
  if (!appt) notFound();

  const live = appt.status === "confirmed" || appt.status === "rescheduled";
  const [{ data: lawyer }, { data: service }, firm] = await Promise.all([
    appt.lawyer_id ? supabase.from("lawyer_public").select("full_name, title").eq("id", appt.lawyer_id).maybeSingle() : Promise.resolve({ data: null }),
    appt.service_id ? supabase.from("services").select("name, duration_min").eq("id", appt.service_id).maybeSingle() : Promise.resolve({ data: null }),
    (await currentFirm()) ?? firmById(appt.firm_id),
  ]);
  const law = lawyer as { full_name: string | null; title: string | null } | null;
  const svc = service as { name: string; duration_min: number } | null;
  const tz = appt.client_timezone ?? "Africa/Lagos";
  const when = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: tz }).format(new Date(appt.starts_at));
  const lawyerName = law?.full_name ?? "your lawyer";

  return (
    <PushedScreen
      header={
        <SubHeader backHref={`/app/appointments/${appt.id}`} backLabel="Back to the appointment">
          <SubHeaderRef>{appt.reference}</SubHeaderRef>
        </SubHeader>
      }
    >
      <div>
        <h1 className="font-app-head text-[22px] font-semibold leading-tight tracking-[-0.015em] text-dk-pri">
          {svc?.name ?? "Consultation"}
        </h1>
        <dl className="mt-2.5 flex flex-col gap-1.5 text-[13px]">
          <div className="flex gap-2.5">
            <dt className="w-[62px] flex-none text-dk-muted">With</dt>
            <dd className="font-semibold text-dk-strong">
              {lawyerName}
              {law?.title ? <span className="font-normal text-dk-muted"> · {law.title}</span> : null}
            </dd>
          </div>
          <div className="flex gap-2.5">
            <dt className="w-[62px] flex-none text-dk-muted">When</dt>
            <dd className="font-semibold text-dk-strong">
              {when} <span className="font-normal text-dk-muted">({tz})</span>
            </dd>
          </div>
          {svc && (
            <div className="flex gap-2.5">
              <dt className="w-[62px] flex-none text-dk-muted">Length</dt>
              <dd className="font-semibold text-dk-strong">{svc.duration_min} minutes</dd>
            </div>
          )}
        </dl>
      </div>

      {appt.mode !== "virtual" ? (
        <Alert kind="info">This is an {appt.mode.replace("_", " ")} appointment, so there is no video room.</Alert>
      ) : !live ? (
        <Alert kind="warning">This appointment is {appt.status.replace("_", " ")}, so the room is closed.</Alert>
      ) : (
        <ConsultationRoom
          appointmentId={appt.id}
          role="participant"
          startsAt={appt.starts_at}
          endsAt={appt.ends_at}
          counterpartLabel={lawyerName}
          accent={firm?.brand?.colours?.primary ?? DEFAULT_TOKENS.primary}
          doneHref={`/app/appointments/${appt.id}`}
        />
      )}

      <Footnote>
        Consultations are private and are not recorded. Use headphones in a quiet place if you can.
      </Footnote>
    </PushedScreen>
  );
}
