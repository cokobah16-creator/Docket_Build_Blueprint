// The waiting room for a video consultation. It says what happens, how long it takes and what the
// client does (docs/VOICE.md, rule 10), and then hands over to the room itself
// (src/components/video/consultation-room.tsx), which tests the camera and microphone, opens 10
// minutes before the start, and holds the client until their lawyer lets them in. The room's own
// join button is this screen's one main action, so nothing above it is filled.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { loginPath } from "@/lib/auth-redirect-server";
import { supabaseServer } from "@/lib/supabase/server";
import { firmById } from "@/lib/tenant";
import { DEFAULT_TOKENS } from "@/lib/brand";
import { modeLabel } from "@/lib/client-words";
import { timeWords, whenWords } from "@/lib/notifications-copy";
import { ConsultationRoom } from "@/components/video/consultation-room";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Screen, ScreenHeader } from "@/components/portal/screen";

export const metadata = { title: "Waiting room" };

interface Appt {
  id: string; firm_id: string; status: string; mode: string;
  starts_at: string; ends_at: string; client_timezone: string | null; lawyer_id: string | null; service_id: string | null;
}

/** The room opens ten minutes before the start (consultation-room.tsx and the video-session function). */
const ROOM_OPENS_BEFORE_MS = 10 * 60 * 1000;
/** And closes an hour after the end. */
const ROOM_CLOSES_AFTER_MS = 60 * 60 * 1000;

export default async function WaitingRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(await loginPath("client"));

  const { data } = await supabase
    .from("appointments")
    .select("id, firm_id, status, mode, starts_at, ends_at, client_timezone, lawyer_id, service_id")
    .eq("id", id)
    .maybeSingle();
  const appt = (data ?? null) as Appt | null;
  if (!appt) notFound();

  const [{ data: lawyer }, { data: service }, owner] = await Promise.all([
    appt.lawyer_id ? supabase.from("lawyer_public").select("full_name, title").eq("id", appt.lawyer_id).maybeSingle() : Promise.resolve({ data: null }),
    appt.service_id ? supabase.from("services").select("name, duration_min").eq("id", appt.service_id).maybeSingle() : Promise.resolve({ data: null }),
    firmById(appt.firm_id),
  ]);
  const law = lawyer as { full_name: string | null; title: string | null } | null;
  const svc = service as { name: string; duration_min: number } | null;
  // The consultation's time in the zone it was booked in, as on the consultation page.
  const tz = appt.client_timezone ?? "Africa/Lagos";
  const start = new Date(appt.starts_at);
  const when = whenWords(start, tz);
  const opensAt = timeWords(new Date(start.getTime() - ROOM_OPENS_BEFORE_MS), tz);
  const lawyerName = law?.full_name ?? null;
  const firm = owner?.name ?? "your firm";
  const Firm = owner?.name ?? "Your firm";
  const back = `/app/appointments/${appt.id}`;

  const over = Date.now() > new Date(appt.ends_at).getTime() + ROOM_CLOSES_AFTER_MS;

  // Why there is no room to go into, when there is not, in the client's words. Null: the room is
  // there. A room for a time that has passed is not mounted at all, because the first thing it
  // does is ask for the camera.
  const closed = ((): string | null => {
    if (appt.mode === "in_person") return `This consultation is in person, at ${firm}'s office, so there is no video room.`;
    if (appt.mode === "phone") return `This consultation is a phone call, so there is no video room. ${lawyerName ?? Firm} will call you at ${timeWords(start, tz)}.`;
    if (appt.mode !== "virtual") return "This consultation has no video room.";
    switch (appt.status) {
      case "confirmed":
      case "rescheduled":
        return over ? "The time for this consultation has passed, so the room is closed." : null;
      case "awaiting_payment":
        return "This booking is not paid yet, so the room is not open. Your consultation page says what to do next.";
      case "pending":
        return `${Firm} has not confirmed this booking yet, so the room is not open. Once ${firm} confirms it, the room opens at ${opensAt}.`;
      case "completed":
        return "This consultation has ended, so the room is closed.";
      case "cancelled":
        return "This consultation was cancelled, so the room is closed.";
      case "no_show":
        return "This consultation was missed, so the room is closed.";
      default:
        return "This booking is not confirmed, so the room is not open.";
    }
  })();

  return (
    <>
      <ScreenHeader back={back} backLabel="Back to your consultation" title="Waiting room" />
      <Screen>
        <header className="flex flex-col gap-1">
          <h1 className="font-heading text-21 font-semibold leading-tight tracking-[-0.015em] text-brand">{svc?.name ?? "Consultation"}</h1>
          <p className="text-15 font-semibold text-ink">{when}</p>
          <p className="text-15 text-ink-muted">
            {modeLabel(appt.mode)} with {lawyerName ? `${lawyerName}${law?.title ? `, ${law.title}` : ""}` : `a lawyer from ${firm}`}
          </p>
        </header>

        {closed ? (
          <Card>
            <CardBody className="flex flex-col gap-3">
              <p className="text-15 leading-relaxed text-ink">{closed}</p>
              <Link href={back} className={buttonClasses("primary", "lg", "w-full")}>
                See your consultation
              </Link>
            </CardBody>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader title="What happens" />
              <CardBody>
                <ol className="flex list-decimal flex-col gap-2 pl-5 text-15 leading-relaxed text-ink">
                  <li>Test your camera and microphone below. On a weak connection, join with audio only. It uses less data.</li>
                  <li>The room opens at {opensAt}, 10 minutes before your consultation. Join it from then.</li>
                  <li>
                    You wait in the waiting room until {lawyerName ?? "your lawyer"} lets you in. Keep this screen open while you
                    wait.
                  </li>
                </ol>
                {svc && <p className="mt-3 text-15 leading-relaxed text-ink">Your consultation lasts {svc.duration_min} minutes.</p>}
              </CardBody>
            </Card>

            <ConsultationRoom
              appointmentId={appt.id}
              role="participant"
              startsAt={appt.starts_at}
              endsAt={appt.ends_at}
              counterpartLabel={lawyerName ?? "your lawyer"}
              contextLabel={owner?.name}
              accent={owner?.brand?.colours?.primary ?? DEFAULT_TOKENS.primary}
              doneHref={back}
            />

            <p className="text-13 leading-relaxed text-ink-muted">
              Consultations are held in a private room. Docket does not turn recording on. Use
              headphones in a quiet place if you can.
            </p>
          </>
        )}
      </Screen>
    </>
  );
}
