"use client";

// Consultation room on Daily Prebuilt with Docket controls around it.
// - Preflight: camera and microphone test before joining, and the choice to
//   join with audio only.
// - Join window: opens 10 minutes before the start (the Edge Function enforces the same rule).
// - Client (participant) knocks; the lawyer (owner) sees the knock and admits from here.
// - Timer and connection quality; "End and write notes" for the owner.
// Recording is never enabled on the room or the token and no control for it is exposed.
//
// Audio only is the bandwidth-honest path (design/pwa, CLIENT · WAITING ROOM and
// CLIENT · CALL). On a weak Nigerian mobile connection the choice is not between
// a good call and a bad one, it is between a call that works and a call that
// drops — so the cheaper path is offered before joining, named with what it
// costs, and offered again the moment the connection actually degrades, rather
// than the picture silently falling apart.
//
// The megabyte figures are nominal rates, not measurements: Daily reports
// bitrate rather than a running total, so these are elapsed minutes times a
// published rate and every one of them is worded "about".

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { joinConsultation, recordSessionEvent, type SessionEvent } from "@/lib/actions/video";
import { Alert } from "@/components/ui/alert";
import { AppButton, AppCard, AppSwitch, Footnote } from "@/components/app";
import { CameraIcon, MicIcon, WarningIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

type Phase = "preflight" | "connecting" | "lobby" | "in-call" | "ended" | "error";
type Quality = "good" | "low" | "very-low" | "unknown";

const JOIN_BEFORE_MS = 10 * 60 * 1000;

/** Nominal megabytes a minute. Daily gives bitrate, not a running total. */
const MB_PER_MIN_VIDEO = 6;
const MB_PER_MIN_AUDIO = 0.5;

/** Daily reports access as "unknown" or { level: "none" | "lobby" | "full" }. */
function accessLevel(frame: any): string | undefined {
  const access = frame?.accessState?.()?.access;
  return access && typeof access === "object" ? (access as { level?: string }).level : undefined;
}

function pad(n: number) {
  return n < 10 ? `0${n}` : String(n);
}
function mmss(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

function estimateMb(elapsedMs: number, audioOnly: boolean): number {
  const minutes = elapsedMs / 60000;
  const mb = minutes * (audioOnly ? MB_PER_MIN_AUDIO : MB_PER_MIN_VIDEO);
  return mb < 10 ? Math.round(mb * 10) / 10 : Math.round(mb);
}

export function ConsultationRoom({
  appointmentId,
  role,
  startsAt,
  endsAt,
  counterpartLabel,
  accent,
  notesHref,
  doneHref,
}: {
  appointmentId: string;
  role: "owner" | "participant";
  startsAt: string;
  endsAt: string;
  counterpartLabel: string;
  accent: string;
  notesHref?: string;
  doneHref: string;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const frameRef = useRef<any>(null);
  const streamRef = useRef<any>(null);
  // Daily's handlers are registered once, at join, so they close over whatever
  // these were at that moment — joinedAt was still null and audioOnly was the
  // preflight choice. The refs are what the handlers read.
  const joinedAtRef = useRef<number | null>(null);
  const audioOnlyRef = useRef(false);

  const [phase, setPhase] = useState<Phase>("preflight");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [devicesOk, setDevicesOk] = useState<boolean | null>(null);
  const [deviceMessage, setDeviceMessage] = useState<string>("Checking your camera and microphone…");
  const [joinedAt, setJoinedAt] = useState<number | null>(null);
  const [quality, setQuality] = useState<Quality>("unknown");
  const [waitingCount, setWaitingCount] = useState(0);
  const [participants, setParticipants] = useState(0);
  const [audioOnly, setAudioOnly] = useState(false);
  const [dataDismissed, setDataDismissed] = useState(false);
  const [endedElapsed, setEndedElapsed] = useState(0);
  const [endedAudioOnly, setEndedAudioOnly] = useState(false);

  const opensAt = new Date(startsAt).getTime() - JOIN_BEFORE_MS;
  const closesAt = new Date(endsAt).getTime() + 60 * 60 * 1000;
  const windowOpen = now >= opensAt && now <= closesAt;

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Preflight device test: a local preview that is stopped before the real call starts.
  useEffect(() => {
    if (phase !== "preflight") return;
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t: any) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (previewRef.current) {
          previewRef.current.srcObject = stream;
          previewRef.current.muted = true;
          await previewRef.current.play().catch(() => undefined);
        }
        setDevicesOk(true);
        setDeviceMessage("Camera and microphone are working.");
      } catch (e) {
        setDevicesOk(false);
        const name = (e as { name?: string })?.name ?? "";
        if (name === "NotAllowedError") {
          setDeviceMessage("Allow camera and microphone access in your browser, then reload this page.");
        } else {
          // Offer the path that actually exists rather than promising a
          // listen-only mode: audio only still needs a microphone.
          setDeviceMessage("We couldn't find a camera or microphone. Check they are connected and not in use by another app, then reload.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase]);

  const stopPreview = useCallback(() => {
    const s = streamRef.current;
    if (s) {
      s.getTracks().forEach((t: any) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const emit = useCallback(
    (ev: SessionEvent) => {
      recordSessionEvent(appointmentId, ev).catch(() => undefined);
    },
    [appointmentId],
  );

  const leave = useCallback(async () => {
    const f = frameRef.current;
    frameRef.current = null;
    if (f) {
      try {
        await f.leave();
      } catch {
        /* already gone */
      }
      try {
        f.destroy();
      } catch {
        /* already destroyed */
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      stopPreview();
      void leave();
    };
  }, [stopPreview, leave]);

  /** Turning the camera off is the whole of audio-only: it is what costs the data. */
  const applyAudioOnly = useCallback((next: boolean) => {
    setAudioOnly(next);
    audioOnlyRef.current = next;
    const f = frameRef.current;
    if (!f) return;
    try {
      f.setLocalVideo(!next);
    } catch {
      /* the frame is gone or not joined yet; the join carries startVideoOff */
    }
  }, []);

  const join = useCallback(async () => {
    setError(null);
    setPhase("connecting");
    const result = await joinConsultation(appointmentId);
    if (!result.ok) {
      setError(result.error);
      setPhase("preflight");
      return;
    }
    stopPreview();
    const info = result.data;
    try {
      const mod = await import("@daily-co/daily-js");
      const DailyIframe = mod.default;
      if (!containerRef.current) throw new Error("Room container missing");
      const frame = DailyIframe.createFrame(containerRef.current, {
        showLeaveButton: true,
        showFullscreenButton: true,
        iframeStyle: { width: "100%", height: "100%", border: "0" },
        theme: { colors: { accent, accentText: "#FFFFFF" } },
      });
      frameRef.current = frame;
      frame
        .on("joined-meeting", () => {
          if (role === "owner") {
            setPhase("in-call");
            joinedAtRef.current = Date.now();
            setJoinedAt(joinedAtRef.current);
            emit("started");
          } else if (accessLevel(frame) === "full") {
            setPhase("in-call");
            joinedAtRef.current = Date.now();
            setJoinedAt(joinedAtRef.current);
            emit("joined");
          } else {
            // Knocking: the client is in the lobby until the lawyer admits them.
            setPhase("lobby");
            emit("joined");
          }
        })
        .on("access-state-updated", (e: any) => {
          if (e?.access?.level === "full" && role === "participant") {
            setPhase("in-call");
            joinedAtRef.current = joinedAtRef.current ?? Date.now();
            setJoinedAt(joinedAtRef.current);
          }
        })
        .on("waiting-participant-added", () => setWaitingCount((c) => c + 1))
        .on("waiting-participant-removed", () => setWaitingCount((c) => Math.max(0, c - 1)))
        .on("participant-joined", () => {
          setParticipants((p) => p + 1);
          if (role === "owner") emit("admitted");
        })
        .on("participant-left", () => setParticipants((p) => Math.max(0, p - 1)))
        .on("network-quality-change", (e: any) => setQuality((e?.threshold as Quality) ?? "unknown"))
        .on("left-meeting", () => {
          setEndedElapsed(joinedAtRef.current ? Date.now() - joinedAtRef.current : 0);
          setEndedAudioOnly(audioOnlyRef.current);
          setPhase("ended");
          emit("left");
        })
        .on("error", (e: any) => {
          setError(e?.errorMsg ?? "The call hit an error.");
          setPhase("error");
        });
      await frame.join({
        url: info.room_url,
        token: info.token ?? undefined,
        userName: info.user_name,
        startVideoOff: audioOnlyRef.current,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the room.");
      setPhase("error");
      await leave();
    }
  }, [accent, appointmentId, emit, leave, role, stopPreview]);

  const admitAll = useCallback(async () => {
    const f = frameRef.current;
    if (!f) return;
    try {
      await f.updateWaitingParticipants({ "*": { grantRequestedAccess: true } });
      setWaitingCount(0);
      emit("admitted");
    } catch {
      setError("Could not admit. Use the people panel inside the room.");
    }
  }, [emit]);

  const endAndNotes = useCallback(async () => {
    setEndedElapsed(joinedAtRef.current ? Date.now() - joinedAtRef.current : 0);
    setEndedAudioOnly(audioOnlyRef.current);
    emit("ended");
    await leave();
    setPhase("ended");
    if (notesHref) router.push(notesHref);
  }, [emit, leave, notesHref, router]);

  const untilOpen = opensAt - now;
  const elapsed = joinedAt ? now - joinedAt : 0;
  const weak = quality === "low" || quality === "very-low";
  const inRoom = phase === "lobby" || phase === "in-call" || phase === "error";

  const qualityLabel: Record<Quality, string> = {
    good: "Connection good",
    low: "Connection weak",
    "very-low": "Connection poor",
    unknown: "Connecting…",
  };
  const connectionLabel = audioOnly && !weak ? "Audio only · connection good" : qualityLabel[quality];

  return (
    <>
      {/* ── Preflight: the waiting room, before the room ─────────────────── */}
      {(phase === "preflight" || phase === "connecting") && (
        <div className="flex flex-col gap-3.5">
          {error && <Alert kind="error">{error}</Alert>}

          <div className="relative aspect-[4/3] overflow-hidden rounded-card border border-dk-line bg-[#0B0B0C]">
            <video ref={previewRef} playsInline autoPlay muted className="h-full w-full object-cover" />
            {devicesOk !== true && (
              <div className="absolute inset-0 grid place-items-center text-white/50">
                <div className="flex flex-col items-center gap-2">
                  <CameraIcon size={34} />
                  <span className="text-[11.5px] uppercase tracking-[0.06em]">Your camera preview</span>
                </div>
              </div>
            )}
            {devicesOk === true && (
              <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1.5 text-[11.5px] font-semibold text-white">
                <MicIcon size={13} />
                Mic on
              </span>
            )}
          </div>

          <p
            role="status"
            className={cn(
              "flex items-start gap-2.5 rounded-[10px] border px-3.5 py-3 text-[13px]",
              devicesOk === false
                ? "border-[#F3DDA4] bg-[#FFFAEB] text-[#92400E]"
                : "border-[#A7D8BE] bg-[#ECFDF3] text-[#05603A]",
            )}
          >
            {devicesOk === false && <WarningIcon size={16} className="mt-px flex-none" />}
            {deviceMessage}
          </p>

          <AppCard className="flex flex-col gap-3 p-[15px]">
            <div className="flex items-start justify-between gap-3.5">
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold text-dk-strong">Join with audio only</p>
                <p id="audio-only-hint" className="mt-0.5 text-[12px] leading-snug text-dk-muted">
                  Uses about {MB_PER_MIN_AUDIO} MB a minute instead of {MB_PER_MIN_VIDEO} MB. Best on a weak network.
                </p>
              </div>
              <AppSwitch
                checked={audioOnly}
                onChange={applyAudioOnly}
                label="Join with audio only"
                describedBy="audio-only-hint"
              />
            </div>
            <div className="flex items-center gap-2 border-t border-dk-rule pt-3 text-[11.5px] text-dk-muted">
              <span
                aria-hidden="true"
                className={cn(
                  "h-[7px] w-[7px] flex-none rounded-full",
                  weak ? "bg-[#D97706]" : "bg-[#16A34A]",
                )}
              />
              {connectionLabel}
            </div>
          </AppCard>

          {!windowOpen && now < opensAt && (
            <Alert kind="info">
              The room opens 10 minutes before your consultation. Opens in <strong>{mmss(untilOpen)}</strong>.
            </Alert>
          )}
          {now > closesAt && <Alert kind="warning">This consultation has ended.</Alert>}

          <AppButton onClick={join} disabled={!windowOpen || phase === "connecting"}>
            {phase === "connecting"
              ? "Connecting…"
              : role === "owner"
                ? "Open the room"
                : "Join and wait to be admitted"}
          </AppButton>
        </div>
      )}

      {/* ── In the room: full-bleed and dark, Docket's chrome around Daily's ─ */}
      <div
        className={cn(
          "dk-shell-dark fixed inset-0 z-50 flex-col bg-[#0B0B0C]",
          inRoom ? "flex" : "hidden",
        )}
      >
        <div className="dk-safe-top flex-none">
          <div className="px-4 pt-3">
          <div className="flex items-center justify-between gap-3 pb-3">
            <div className="min-w-0">
              <p className="text-[13.5px] font-semibold text-white">
                {phase === "lobby"
                  ? "Waiting room"
                  : phase === "in-call"
                    ? `In consultation · ${mmss(elapsed)}`
                    : "Consultation"}
              </p>
              <p className="mt-0.5 truncate text-[11.5px] text-white/55">{counterpartLabel}</p>
            </div>
            <span
              aria-live="polite"
              className={cn(
                "inline-flex flex-none items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold",
                weak
                  ? "border-[rgba(251,191,36,0.34)] bg-[rgba(180,83,9,0.2)] text-[#FDE68A]"
                  : "border-[rgba(167,216,190,0.4)] bg-[rgba(5,96,58,0.24)] text-[#A7F3D0]",
              )}
            >
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
              {connectionLabel}
            </span>
          </div>

          {error && (
            <div className="mb-3 rounded-[10px] border border-[rgba(251,191,36,0.3)] bg-[rgba(180,83,9,0.16)] px-3.5 py-3 text-[12px] text-[#FDE68A]">
              {error}
            </div>
          )}

          {role === "owner" && waitingCount > 0 && (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-[11px] border border-white/15 bg-white/10 p-3">
              <p className="min-w-0 text-[13px] font-semibold text-white">
                {waitingCount === 1
                  ? `${counterpartLabel} is waiting.`
                  : `${waitingCount} people are waiting.`}
              </p>
              <button
                type="button"
                onClick={admitAll}
                className="min-h-[44px] flex-none rounded-[9px] bg-white px-4 text-[13px] font-bold text-[#0B0B0C]"
              >
                Admit
              </button>
            </div>
          )}
          </div>
        </div>

        <div ref={containerRef} className="min-h-0 flex-1 bg-[#0B0B0C]" />

        <div className="dk-safe-bottom flex-none">
          <div className="px-4 pb-3 pt-2.5">
          {phase === "lobby" && (
            <p role="status" className="pb-2 text-center text-[12.5px] leading-relaxed text-white/60">
              You are in the waiting room. {counterpartLabel} will let you in shortly — keep this
              screen open.
            </p>
          )}

          {phase === "in-call" && weak && !audioOnly && !dataDismissed && (
            <div className="mb-2.5 flex items-start gap-2.5 rounded-[10px] border border-[rgba(251,191,36,0.3)] bg-[rgba(180,83,9,0.16)] px-3.5 py-3">
              <WarningIcon size={16} className="mt-px flex-none text-[#FCD34D]" />
              <div className="text-[12px] leading-snug text-[#FDE68A]">
                <span className="font-semibold">Your connection is weak.</span> Turning the camera
                off keeps the audio clear.
                <span className="mt-1.5 flex gap-4">
                  <button
                    type="button"
                    onClick={() => applyAudioOnly(true)}
                    className="inline-flex min-h-[44px] items-center font-semibold underline underline-offset-2"
                  >
                    Switch to audio only
                  </button>
                  <button
                    type="button"
                    onClick={() => setDataDismissed(true)}
                    className="inline-flex min-h-[44px] items-center text-white/60"
                  >
                    Keep video
                  </button>
                </span>
              </div>
            </div>
          )}

          {role === "owner" && phase === "in-call" && (
            <div className="mb-2.5 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={endAndNotes}
                className="inline-flex min-h-[48px] items-center gap-2 rounded-full bg-[#B42318] px-5 text-[13px] font-bold text-white"
              >
                End &amp; write notes
              </button>
              <span className="text-[11px] text-white/45">
                {participants > 0
                  ? `${participants} other participant${participants > 1 ? "s" : ""} in the room`
                  : "No one else in the room yet"}
              </span>
            </div>
          )}

          {phase === "in-call" && (
            <p className="text-center text-[11px] text-white/45">
              {audioOnly
                ? `Audio only · about ${estimateMb(elapsed, true)} MB so far`
                : `Video · about ${estimateMb(elapsed, false)} MB so far, roughly ${MB_PER_MIN_VIDEO} MB a minute`}
            </p>
          )}
          {role !== "owner" && (
            <p className="mt-1 text-center text-[11px] text-white/35">
              Private room · not recorded
            </p>
          )}
          </div>
        </div>
      </div>

      {/* ── After ────────────────────────────────────────────────────────── */}
      {phase === "ended" && (
        <div className="flex flex-col gap-3.5">
          <div className="flex items-start gap-2.5 rounded-[10px] border border-[#A7D8BE] bg-[#ECFDF3] p-3.5">
            <div className="text-[13px] leading-snug text-[#05603A]">
              <p className="font-bold">
                Call ended{endedElapsed > 0 ? ` · ${Math.max(1, Math.round(endedElapsed / 60000))} minutes` : ""}
              </p>
              <p className="mt-0.5">
                {role === "owner"
                  ? "Write the consultation notes now while it is fresh. Your client sees only the summary."
                  : `Thank you. ${counterpartLabel}'s summary will appear on your appointment once it is written.`}
              </p>
            </div>
          </div>

          {endedElapsed > 0 && (
            <AppCard className="flex flex-col gap-2.5 p-[15px]">
              <p className="text-[12px] uppercase tracking-[0.07em] text-dk-muted">Data used</p>
              <p className="font-app-head text-[26px] font-semibold text-dk-pri">
                about {estimateMb(endedElapsed, endedAudioOnly)} MB
              </p>
              <Footnote>
                {endedAudioOnly
                  ? `Audio only, ${Math.max(1, Math.round(endedElapsed / 60000))} minutes — about a twelfth of what video would have cost.`
                  : `Video, ${Math.max(1, Math.round(endedElapsed / 60000))} minutes. Audio only would have used about ${estimateMb(endedElapsed, true)} MB.`}{" "}
                An estimate from the time on the call, not a measurement from your network.
              </Footnote>
            </AppCard>
          )}

          <div className="flex flex-col gap-2.5">
            {role === "owner" && notesHref && (
              <AppButton onClick={() => router.push(notesHref)}>Write notes</AppButton>
            )}
            <div className="flex gap-2.5">
              <AppButton variant="ghost" onClick={() => router.push(doneHref)}>
                Back to appointment
              </AppButton>
              {now <= closesAt && (
                <AppButton
                  variant="ghost"
                  onClick={() => {
                    joinedAtRef.current = null;
                    setJoinedAt(null);
                    setDataDismissed(false);
                    setPhase("preflight");
                  }}
                >
                  Rejoin
                </AppButton>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
