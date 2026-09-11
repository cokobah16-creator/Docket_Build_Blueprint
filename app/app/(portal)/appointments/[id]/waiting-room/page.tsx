import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { firmById } from "@/lib/tenant";
import { ConsultationRoom } from "@/components/video/consultation-room";
import { Alert } from "@/components/ui/alert";
import { Screen, ScreenHeader } from "@/components/portal/screen";

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
    firmById(appt.firm_id),
  ]);
  const law = lawyer as { full_name: string | null; title: string | null } | null;
  const svc = service as { name: string; duration_min: number } | null;
  const tz = appt.client_timezone ?? "Africa/Lagos";
  const when = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: tz }).format(new Date(appt.starts_at));
  const lawyerName = law?.full_name ?? "your lawyer";

  return (
    <>
      <ScreenHeader back={`/app/appointments/${appt.id}`} backLabel={`Back to appointment ${appt.reference}`} title="Waiting room" />
      <Screen>
        <header>
          <h1 className="font-heading text-[22px] font-semibold leading-tight tracking-[-0.015em] text-brand">{svc?.name ?? "Consultation"}</h1>
          <dl className="mt-2.5 space-y-1.5 text-[13px]">
            <div className="flex gap-2.5"><dt className="w-[62px] shrink-0 text-gray-500">With</dt><dd className="font-semibold text-gray-900">{lawyerName}{law?.title ? ` · ${law.title}` : ""}</dd></div>
            <div className="flex gap-2.5"><dt className="w-[62px] shrink-0 text-gray-500">When</dt><dd className="font-semibold text-gray-900">{when} <span className="font-normal text-gray-500">({tz})</span></dd></div>
            {svc && <div className="flex gap-2.5"><dt className="w-[62px] shrink-0 text-gray-500">Length</dt><dd className="font-semibold text-gray-900">{svc.duration_min} minutes</dd></div>}
          </dl>
        </header>

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
            contextLabel={firm?.name}
            accent={firm?.brand?.colours?.primary ?? "#0F2A44"}
            doneHref={`/app/appointments/${appt.id}`}
          />
        )}
        <p className="text-[11.5px] leading-relaxed text-gray-500">
          Consultations are private and are not recorded. Use headphones in a quiet place if you can.
        </p>
      </Screen>
    </>
  );
}
