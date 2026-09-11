// One consultation, on the console's phone kit (design/pwa artboard, LAWYER ·
// APPOINTMENT + NOTES): the reference rides in the sub-header, the client's
// name is the screen, and the rest is cards — who they are, what they said at
// booking, the two notes boxes, and the room.
//
// The console wears no firm's colours. Everything here is the neutral ink, and
// the only colour on the screen is the pair of badges on the notes form, which
// mark the one distinction that matters on this screen: what the client reads
// against what they must never see. Both say it in words as well.
//
// Presentation only: every query, action and redirect below is the one that
// was here before.

import Link from "next/link";
import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { firmById } from "@/lib/tenant";
import { formatWhen } from "@/lib/time";
import {
  AppCard,
  AppCardBody,
  AppCardHeader,
  AppCardList,
  AppDetail,
  AppPill,
  AppStatusPill,
  Footnote,
  SubHeader,
  SubHeaderRef,
  AppButton,
} from "@/components/app";
import { ClockIcon, DocumentIcon } from "@/components/ui/icons";
import type { Status } from "@/components/ui/badge";
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

/** The artboard's quiet pill: a fact about the booking, in no colour at all. */
function MetaPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full border border-dk-line bg-white px-2.5 py-1 text-[11.5px] font-semibold text-dk-soft">
      {children}
    </span>
  );
}

/**
 * The booking wizard stores an intake upload as the storage path it wrote it
 * to — `${firm}/${user}/${epoch}-${index}-${filename}`. This pulls the file
 * name back out so a document reads as a document. It is only the name: the
 * page issues no signed URL, so nothing here is a link.
 */
const UPLOAD_PATH = /^[^/]+\/[^/]+\/\d{10,}-\d+-(.+)$/;

function uploadFileName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = UPLOAD_PATH.exec(value);
  return match ? match[1] : null;
}

/** Unchanged from the first cut: arrays join, objects with a name give it, everything else stringifies. */
function answerText(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((x) => (typeof x === "object" && x && "name" in (x as object) ? String((x as { name: string }).name) : String(x)))
      .join(", ");
  }
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
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
  // The room component only lets anyone in from ten minutes before the start
  // (windowOpen in consultation-room.tsx). The card above it has to say the
  // same thing, or it announces "Room open" for a consultation that is days
  // away and then hosts a component counting down to it.
  const roomOpenNow = roomOpen && nowMs >= startMs - 10 * 60 * 1000;
  const canNoShow = live && nowMs > startMs;
  const appointmentId = appt.id;
  const noShow = async () => {
    "use server";
    const r = await markNoShow(appointmentId);
    redirect(`/firm/appointments/${appointmentId}${r?.error ? `?error=${encodeURIComponent(r.error)}` : ""}`);
  };

  const minutes = svc?.duration_min ?? Math.round((endMs - startMs) / 60000);
  // The client's waiting room opens ten minutes before the start — the same
  // rule the client app and the room component itself keep.
  const opensAt = new Date(startMs - 10 * 60 * 1000).toISOString();
  // A bare time reads as today. Once the room is open it is today, so the time
  // alone is right; before then the day has to be on it.
  const opensAtLabel = roomOpenNow
    ? formatWhen(opensAt, tz, { timeStyle: "short" })
    : formatWhen(opensAt, tz, {
        weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
      });
  const whenPill = formatWhen(appt.starts_at, tz, {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });

  const intakeEntries = answers
    ? Object.entries(answers).map(([key, value]) => {
        const files = Array.isArray(value)
          ? value.map(uploadFileName).filter((name): name is string => name !== null)
          : [];
        const isFiles = Array.isArray(value) && value.length > 0 && files.length === value.length;
        return { key, label: key.replace(/_/g, " "), files, isFiles, text: isFiles ? "" : answerText(value) };
      })
    : [];
  const hasUploads = intakeEntries.some((entry) => entry.isFiles);

  return (
    // The console layout's <main> owns the page gutter, so the sub-header
    // reclaims it to run edge to edge and the body below puts it back.
    <div className="dk-rise -mx-4 -mt-3.5 md:mx-0 md:mt-0">
      <SubHeader backHref="/firm/appointments" backLabel="Back to consultations">
        <SubHeaderRef>{appt.reference}</SubHeaderRef>
      </SubHeader>

      <div className="flex flex-col gap-3.5 px-4 pt-3.5 md:px-0">
        <header>
          <h1 className="font-app-head text-[20px] font-bold leading-[1.25] tracking-[-0.02em] text-dk-strong">
            {cl?.full_name ?? "Client"}
          </h1>
          <p className="mt-1 text-[12.5px] leading-snug text-dk-soft">
            {svc?.name ?? "Consultation"} · {appt.mode.replace("_", " ")} · {minutes} minutes
          </p>
          <div className="mt-[9px] flex flex-wrap items-center gap-[7px]">
            <AppStatusPill status={appt.status as Status} />
            <MetaPill>
              <ClockIcon size={12} />
              {whenPill}
            </MetaPill>
          </div>
        </header>

        {actionError && <Alert kind="error">{actionError}</Alert>}
        {saved && (
          <Alert kind="success">
            Notes saved.{" "}
            {appt.status === "completed" ? "The appointment is marked completed and the client can see the summary." : ""}
          </Alert>
        )}
        {appt.status === "cancelled" && appt.cancellation_reason && (
          <Alert kind="warning">Cancelled: {appt.cancellation_reason}</Alert>
        )}

        {roomOpen && (
          <AppCard>
            <AppCardHeader
              title={roomOpenNow ? "Room open" : "Consultation room"}
              action={
                <MetaPill>
                  <ClockIcon size={12} />
                  {roomOpenNow ? "Open" : `Opens ${opensAtLabel}`}
                </MetaPill>
              }
            />
            <AppCardBody className="flex flex-col gap-3">
              <p className="text-[12.5px] leading-[1.5] text-dk-soft">
                {roomOpenNow
                  ? "The client can knock now. You admit them from here."
                  : `The client can knock from ${opensAtLabel}. You admit them from here.`}
              </p>
              {/* accent is the console's own ink, not the firm's. The client's
                  waiting room passes the firm's primary, because a client is
                  dealing with their lawyers; a lawyer is holding the same
                  working tool whichever firm they opened it for, so the room's
                  chrome here is #141414 — the literal .dk-shell-console sets,
                  written out because Daily's theme takes a colour value rather
                  than a CSS variable. */}
              <ConsultationRoom
                appointmentId={appt.id}
                role="owner"
                startsAt={appt.starts_at}
                endsAt={appt.ends_at}
                counterpartLabel={cl?.full_name ?? "the client"}
                accent="#141414"
                notesHref={`/firm/appointments/${appt.id}?notes=1#notes`}
                doneHref={`/firm/appointments/${appt.id}`}
              />
            </AppCardBody>
          </AppCard>
        )}

        <AppCard>
          <AppCardHeader title="Client" />
          <AppCardList>
            <div className="flex items-center justify-between gap-4 px-[17px] py-[13px] text-[13.5px]">
              <span className="flex-none text-dk-muted">Name</span>
              <span className="text-right font-semibold text-dk-strong">{cl?.full_name ?? "—"}</span>
            </div>
            {/* A lawyer reading this is holding a phone, so the number dials
                and the address opens a mail app. Both rows are 52px tall. */}
            <div className="flex min-h-[52px] items-center justify-between gap-4 px-[17px] py-[13px] text-[13.5px]">
              <span className="flex-none text-dk-muted">Phone</span>
              {cl?.phone ? (
                <a href={`tel:${cl.phone}`} className="flex min-h-[44px] items-center justify-end text-right font-semibold text-dk-pri underline underline-offset-2">
                  {cl.phone}
                </a>
              ) : (
                <span className="text-right font-semibold text-dk-strong">—</span>
              )}
            </div>
            <div className="flex min-h-[52px] items-center justify-between gap-4 px-[17px] py-[13px] text-[13.5px]">
              <span className="flex-none text-dk-muted">Email</span>
              {cl?.email ? (
                <a href={`mailto:${cl.email}`} className="flex min-h-[44px] min-w-0 items-center justify-end break-all text-right font-semibold text-dk-pri underline underline-offset-2">
                  {cl.email}
                </a>
              ) : (
                <span className="text-right font-semibold text-dk-strong">—</span>
              )}
            </div>
            {appt.client_timezone && appt.client_timezone !== tz && (
              <div className="px-[17px] py-[13px]">
                <AppDetail label="Client's time">
                  {formatWhen(appt.starts_at, appt.client_timezone)} ({appt.client_timezone})
                </AppDetail>
              </div>
            )}
          </AppCardList>
        </AppCard>

        {intakeEntries.length > 0 && (
          <AppCard>
            <AppCardHeader title="Intake" />
            <AppCardBody className="flex flex-col gap-[10px] text-[12.5px]">
              {intakeEntries.map((entry) => (
                <div key={entry.key}>
                  <span className="text-dk-soft">{entry.label}</span>
                  {entry.isFiles ? (
                    <ul className="mt-1.5 flex flex-col gap-1.5">
                      {entry.files.map((name, i) => (
                        <li key={`${entry.key}-${i}`} className="flex items-start gap-2 text-dk-strong">
                          <DocumentIcon size={15} className="mt-px flex-none text-dk-soft" />
                          <span className="min-w-0 break-all font-semibold">{name}</span>
                        </li>
                      ))}
                    </ul>
                  ) : entry.text.length > 70 ? (
                    <p className="mt-[3px] whitespace-pre-wrap leading-[1.5] text-dk-body">{entry.text}</p>
                  ) : (
                    <p className="mt-0.5 whitespace-pre-wrap font-semibold text-dk-strong">{entry.text}</p>
                  )}
                </div>
              ))}
              {hasUploads && <Footnote>Documents the client attached when booking, by name.</Footnote>}
            </AppCardBody>
          </AppCard>
        )}

        {(live || appt.status === "completed") && (
          <AppCard>
            <AppCardHeader
              title="Consultation notes"
              action={
                notes?.client_summary ? (
                  <AppPill kind="confirmed">
                    Saved {formatWhen(notes.updated_at, tz, { dateStyle: "medium" })}
                  </AppPill>
                ) : (
                  <AppPill kind="awaiting">Not written yet</AppPill>
                )
              }
            />
            <AppCardBody>
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
            </AppCardBody>
          </AppCard>
        )}

        {session && (
          <AppCard>
            <AppCardHeader title="Session" />
            <AppCardBody className="flex flex-col gap-2.5">
              <AppDetail label="Started">
                {session.started_at ? formatWhen(session.started_at, tz, { timeStyle: "short" }) : "—"}
              </AppDetail>
              <AppDetail label="Client admitted">
                {session.client_admitted_at ? formatWhen(session.client_admitted_at, tz, { timeStyle: "short" }) : "—"}
              </AppDetail>
              <AppDetail label="Ended">
                {session.ended_at ? formatWhen(session.ended_at, tz, { timeStyle: "short" }) : "—"}
              </AppDetail>
            </AppCardBody>
          </AppCard>
        )}

        {live && (
          <AppCard>
            <AppCardHeader title="Reschedule" />
            <AppCardBody>
              <RescheduleForm
                appointmentId={appt.id}
                firmId={appt.firm_id}
                lawyerId={appt.lawyer_id}
                serviceId={appt.service_id}
                timezone={tz}
              />
            </AppCardBody>
          </AppCard>
        )}

        {canNoShow && (
          <AppCard>
            <AppCardHeader title="Client did not attend?" />
            <AppCardBody className="flex flex-col gap-3">
              <p className="text-[12.5px] leading-[1.5] text-dk-soft">
                Marks the appointment as a no-show. The client keeps their receipt; nothing is refunded automatically.
              </p>
              <form action={noShow}>
                <AppButton type="submit" variant="ghost" className="w-full">
                  Mark as no-show
                </AppButton>
              </form>
            </AppCardBody>
          </AppCard>
        )}

        <Footnote>
          Times on this screen are shown in {tz}, from your profile.{" "}
          <Link href="/firm/appointments" className="text-dk-pri underline underline-offset-2">
            All consultations
          </Link>
          .
        </Footnote>
      </div>
    </div>
  );
}
