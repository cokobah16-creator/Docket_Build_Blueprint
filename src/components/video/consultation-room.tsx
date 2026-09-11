"use client";

// Consultation room on Daily Prebuilt with Docket controls around it.
// - Preflight: camera and microphone test before joining.
// - Join window: opens 10 minutes before the start (the Edge Function enforces the same rule).
// - Client (participant) knocks; the lawyer (owner) sees the knock and admits from here.
// - Timer and connection quality; "End and write notes" for the owner.
// Recording is never enabled on the room or the token and no control for it is exposed.
//
// Bandwidth honesty (design/pwa): a Nigerian client on mobile data pays for
// this call by the megabyte, so the room never degrades silently. Audio-only
// is offered before joining with its cost named, a weak connection says so and
// offers the cheaper path rather than quietly dropping frames, and the call
// ends by showing what it actually used.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { joinConsultation, recordSessionEvent, type SessionEvent } from "@/lib/actions/video";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Icon } from "@/components/ui/icon";
import { SettingRow, Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";

type Phase = "preflight" | "connecting" | "lobby" | "in-call" | "ended" | "error";
type Quality = "good" | "low" | "very-low" | "unknown";

const JOIN_BEFORE_MS = 10 * 60 * 1000;

/**
 * What a minute of this call costs, in megabytes. Rounded from Daily's own
 * published bitrates; only ever shown as "about", and superseded by the real
 * byte counters once the call reports them.
 */
const MB_PER_MIN = { video: 6, audio: 0.5 } as const;

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
function mb(value: number) {
  return value >= 10 ? `${Math.round(value)} MB` : `${value.toFixed(1)} MB`;
}

export function ConsultationRoom({
  appointmentId,
  role,
  startsAt,
  endsAt,
  counterpartLabel,
  contextLabel,
  accent,
  notesHref,
  doneHref,
}: {
  appointmentId: string;
  role: "owner" | "participant";
  startsAt: string;
  endsAt: string;
  counterpartLabel: string;
  /** The line under the title: the firm for a client, the reference for staff. */
  contextLabel?: string;
  accent: string;
  notesHref?: string;
  doneHref: string;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const frameRef = useRef<any>(null);
  const streamRef = useRef<any>(null);

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
  const [micOn, setMicOn] = useState(true);
  const [bytes, setBytes] = useState(0);
  const [dismissedWarning, setDismissedWarning] = useState(false);
  const [endedAfterMs, setEndedAfterMs] = useState(0);
  const [endedAudioOnly, setEndedAudioOnly] = useState(false);
  const [endedBytes, setEndedBytes] = useState(0);

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
        setDeviceMessage(
          name === "NotAllowedError"
            ? "Allow camera and microphone access in your browser, then reload this page."
            : "We couldn't find a camera or microphone. You can still join and listen.",
        );
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

  // Real bytes where the call reports them; the per-minute estimate is only a
  // fallback, so the figure on screen is never worse than an honest guess.
  useEffect(() => {
    if (phase !== "in-call") return;
    const id = setInterval(async () => {
      const f = frameRef.current;
      if (!f?.getNetworkStats) return;
      try {
        const stats = await f.getNetworkStats();
        const total =
          (stats?.stats?.latest?.totalSendBytes ?? 0) + (stats?.stats?.latest?.totalRecvBytes ?? 0);
        if (total > 0) setBytes(total);
      } catch {
        /* keep the estimate */
      }
    }, 5000);
    return () => clearInterval(id);
  }, [phase]);

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
        showLeaveButton: false,
        showFullscreenButton: true,
        iframeStyle: { width: "100%", height: "100%", border: "0" },
        theme: { colors: { accent, accentText: "#FFFFFF" } },
      });
      frameRef.current = frame;
      frame
        .on("joined-meeting", () => {
          if (role === "owner") {
            setPhase("in-call");
            setJoinedAt(Date.now());
            emit("started");
          } else if (accessLevel(frame) === "full") {
            setPhase("in-call");
            setJoinedAt(Date.now());
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
            setJoinedAt(Date.now());
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
        startVideoOff: audioOnly,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the room.");
      setPhase("error");
      await leave();
    }
  }, [accent, appointmentId, audioOnly, emit, leave, role, stopPreview]);

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

  /** Turning the camera off mid-call is the cheap path, not a punishment. */
  const setCamera = useCallback((on: boolean) => {
    setAudioOnly(!on);
    setDismissedWarning(true);
    try {
      frameRef.current?.setLocalVideo?.(on);
    } catch {
      /* the switch still reflects the intent */
    }
  }, []);

  const toggleMic = useCallback(() => {
    setMicOn((on) => {
      try {
        frameRef.current?.setLocalAudio?.(!on);
      } catch {
        /* ignore */
      }
      return !on;
    });
  }, []);

  const elapsed = joinedAt ? now - joinedAt : 0;

  const finish = useCallback(
    async (goToNotes: boolean) => {
      setEndedAfterMs(joinedAt ? Date.now() - joinedAt : 0);
      setEndedAudioOnly(audioOnly);
      setEndedBytes(bytes);
      emit(role === "owner" ? "ended" : "left");
      await leave();
      setPhase("ended");
      if (goToNotes && notesHref) router.push(notesHref);
    },
    [audioOnly, bytes, emit, joinedAt, leave, notesHref, role, router],
  );

  const untilOpen = opensAt - now;
  const weak = quality === "low" || quality === "very-low";
  const qualityLabel: Record<Quality, string> = {
    good: "Connection good",
    low: "Connection weak",
    "very-low": "Connection poor",
    unknown: "Connecting…",
  };
  const connectionLabel = audioOnly ? `Audio only · ${qualityLabel[quality].toLowerCase()}` : qualityLabel[quality];

  /** Bytes if the call reported them, otherwise minutes × the published rate. */
  const usedMb = (ms: number, byteCount: number, audio: boolean) =>
    byteCount > 0 ? byteCount / 1_000_000 : (ms / 60_000) * (audio ? MB_PER_MIN.audio : MB_PER_MIN.video);
  // Every phase renders in one tree, hidden rather than swapped, because the
  // Daily iframe lives inside `containerRef`: unmounting that node to show a
  // different phase would tear the call down mid-consultation.
  const inRoom = phase === "lobby" || phase === "in-call" || phase === "error";
  const used = usedMb(elapsed, bytes, audioOnly);
  const showWarning = phase === "in-call" && weak && !audioOnly && !dismissedWarning;
  const minutes = Math.max(1, Math.round(endedAfterMs / 60_000));
  const endedUsed = usedMb(endedAfterMs, endedBytes, endedAudioOnly);

  return (
    <>
      {/* ── preflight ─────────────────────────────────────────────────── */}
      <div className={cn("flex-col gap-3.5", phase === "preflight" || phase === "connecting" ? "flex" : "hidden")}>
        {error && phase !== "error" && <Alert kind="error">{error}</Alert>}

        <div className="relative aspect-[4/3] overflow-hidden rounded-card border border-gray-200 bg-[#0B0B0C]">
          <video ref={previewRef} playsInline autoPlay muted className="size-full object-cover" />
          {devicesOk !== true && (
            <div className="absolute inset-0 grid place-items-center text-white/50">
              <div className="flex flex-col items-center gap-2.5">
                <Icon name="camera" size={34} strokeWidth={1.4} />
                <span className="text-[11.5px] uppercase tracking-[0.06em]">Your camera preview</span>
              </div>
            </div>
          )}
          <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-white/[0.12] px-2.5 py-1.5 text-[11.5px] font-semibold text-white">
            <Icon name="mic" size={13} strokeWidth={1.8} />
            Mic on
          </span>
        </div>

        <Alert kind={devicesOk === false ? "warning" : "success"}>{deviceMessage}</Alert>

        <div className="flex flex-col gap-3 rounded-card border border-gray-200 bg-white p-[15px]">
          <SettingRow
            title="Join with audio only"
            hint={`Uses about ${MB_PER_MIN.audio} MB a minute instead of ${MB_PER_MIN.video} MB. Best on a weak network.`}
            divided={false}
          >
            <Switch label="Join with audio only" checked={audioOnly} onChange={setAudioOnly} />
          </SettingRow>
          <p className="flex items-center gap-2 border-t border-gray-100 pt-[11px] text-[11.5px] text-gray-500">
            <span
              aria-hidden="true"
              className={cn("size-[7px] shrink-0 rounded-full", weak && !audioOnly ? "bg-[#D97706]" : "bg-[#16A34A]")}
            />
            {connectionLabel}
          </p>
        </div>

        {!windowOpen && now < opensAt && (
          <Alert kind="info">
            The room opens 10 minutes before your consultation. Opens in <strong>{mmss(untilOpen)}</strong>.
          </Alert>
        )}
        {now > closesAt && <Alert kind="warning">This consultation has ended.</Alert>}

        <Button size="lg" className="w-full" onClick={join} disabled={!windowOpen || phase === "connecting"}>
          {phase === "connecting" ? "Connecting…" : role === "owner" ? "Open the room" : "Join and wait to be admitted"}
        </Button>
      </div>

      {/* ── ended ─────────────────────────────────────────────────────── */}
      <div className={cn("flex-col gap-3.5", phase === "ended" ? "flex" : "hidden")}>
        <Alert kind="success" title={`Call ended · ${minutes} minute${minutes === 1 ? "" : "s"}`}>
          {role === "owner"
            ? "Write the consultation notes now while it is fresh. Your client sees only the summary."
            : `Thank you. ${counterpartLabel}'s summary will appear on your appointment once it is written.`}
        </Alert>

        <div className="flex flex-col gap-2.5 rounded-card border border-gray-200 bg-white p-[15px]">
          <p className="text-xs uppercase tracking-[0.07em] text-gray-500">Data used</p>
          <p className="font-heading text-[26px] font-semibold text-brand">{mb(endedUsed)}</p>
          <p className="text-xs leading-[1.45] text-gray-500">
            {endedAudioOnly
              ? `Audio only, ${minutes} minute${minutes === 1 ? "" : "s"}. About a tenth of what video would have cost (${mb((endedAfterMs / 60_000) * MB_PER_MIN.video)}).`
              : `Video, ${minutes} minute${minutes === 1 ? "" : "s"}. Audio only would have used about ${mb((endedAfterMs / 60_000) * MB_PER_MIN.audio)}.`}
            {endedBytes === 0 && " Estimated — this call did not report its usage."}
          </p>
        </div>

        {role === "owner" && notesHref && (
          <Button size="lg" className="w-full" onClick={() => router.push(notesHref)}>Write notes</Button>
        )}
        <Button
          variant={role === "owner" ? "ghost" : "primary"}
          size="lg"
          className="w-full"
          onClick={() => router.push(doneHref)}
        >
          Back to appointment
        </Button>
        {now <= closesAt && (
          <Button variant="ghost" size="lg" className="w-full" onClick={() => { setPhase("preflight"); setDismissedWarning(false); }}>
            Rejoin
          </Button>
        )}
      </div>

      {/* ── lobby, in-call, error: the call takes the whole phone ──────── */}
      <div
        className={cn(
          "fixed inset-0 z-50 flex-col bg-[#0B0B0C] pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]",
          inRoom ? "flex" : "hidden",
        )}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 px-4 py-3.5">
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold text-white">
              {phase === "lobby" ? "Waiting room" : phase === "in-call" ? `In consultation · ${mmss(elapsed)}` : "Room"}
            </p>
            <p className="mt-0.5 truncate text-[11.5px] text-white/55">
              {counterpartLabel}
              {contextLabel ? ` · ${contextLabel}` : ""}
            </p>
          </div>
          <span
            aria-live="polite"
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold",
              weak && !audioOnly
                ? "border-amber-300/30 bg-amber-700/20 text-amber-200"
                : "border-emerald-200/40 bg-emerald-800/25 text-emerald-200",
            )}
          >
            <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
            {connectionLabel}
          </span>
        </header>

        {error && (
          <div className="shrink-0 px-4 pb-2.5">
            <Alert kind="error">{error}</Alert>
          </div>
        )}

        {role === "owner" && waitingCount > 0 && (
          <div className="mx-4 mb-3 flex shrink-0 items-center justify-between gap-3 rounded-[11px] border border-white/15 bg-white/[0.08] p-3.5">
            <p className="min-w-0 text-[13px] font-semibold text-white">
              {waitingCount === 1 ? `${counterpartLabel} is waiting` : `${waitingCount} people are waiting`}
              <span className="mt-0.5 block text-[11.5px] font-normal text-white/55">Admit when you are ready — nothing is recorded.</span>
            </p>
            <Button size="md" className="shrink-0 bg-white text-[#0B0B0C] hover:bg-white/90" onClick={admitAll}>
              Admit
            </Button>
          </div>
        )}

        <div className="relative min-h-0 flex-1 px-4">
          {/* The one and only Daily mount point, for the life of the component. */}
          <div
            ref={containerRef}
            className={cn(
              "size-full overflow-hidden rounded-card",
              phase === "lobby" && "pointer-events-none absolute inset-0 opacity-0",
            )}
          />
          {phase === "lobby" && (
            <div className="grid size-full place-items-center" role="status">
              <div className="flex max-w-[260px] flex-col items-center gap-3.5 text-center">
                <span className="grid size-[72px] animate-[dkPulse_2s_ease-in-out_infinite] place-items-center rounded-full border border-white/20 text-white/80">
                  <Icon name="clock" size={28} strokeWidth={1.5} />
                </span>
                <p className="text-[14.5px] font-semibold text-white">Waiting for {counterpartLabel}</p>
                <p className="text-[12.5px] leading-relaxed text-white/60">
                  You are in the waiting room. Keep this screen open — you will be let in shortly.
                </p>
              </div>
            </div>
          )}
        </div>

        {showWarning && (
          <div className="mx-4 mt-2.5 flex shrink-0 items-start gap-2.5 rounded-[10px] border border-amber-300/30 bg-amber-700/20 p-3.5">
            <Icon name="warning" size={16} strokeWidth={1.8} className="mt-px shrink-0 text-amber-300" />
            <div className="text-xs leading-[1.45] text-amber-100">
              <span className="font-semibold">Your connection is weak.</span> Turn the camera off to keep the audio clear.
              <button
                type="button"
                onClick={() => setCamera(false)}
                className="mt-1.5 block font-semibold underline underline-offset-2"
              >
                Switch to audio only
              </button>
            </div>
          </div>
        )}

        <div className="flex shrink-0 flex-col gap-3 px-4 pb-5 pt-3">
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={toggleMic}
              aria-pressed={!micOn}
              className={cn(
                "grid size-[50px] place-items-center rounded-full border",
                micOn ? "border-white/20 bg-white/10 text-white" : "border-white/10 bg-white/5 text-white/35",
              )}
            >
              <Icon name="mic" size={21} label={micOn ? "Mute microphone" : "Unmute microphone"} />
            </button>
            <button
              type="button"
              onClick={() => setCamera(audioOnly)}
              aria-pressed={audioOnly}
              className={cn(
                "grid size-[50px] place-items-center rounded-full border",
                audioOnly ? "border-white/10 bg-white/5 text-white/35" : "border-white/20 bg-white/10 text-white",
              )}
            >
              <Icon name="video" size={21} label={audioOnly ? "Turn camera on" : "Turn camera off"} />
            </button>
            {role === "owner" ? (
              <button
                type="button"
                onClick={() => void finish(true)}
                className="inline-flex min-h-[54px] items-center gap-2.5 rounded-full bg-[#B42318] px-5 text-[13px] font-bold text-white"
              >
                <Icon name="phone-off" size={19} strokeWidth={1.8} />
                End &amp; write notes
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void finish(false)}
                className="grid size-[54px] place-items-center rounded-full bg-[#B42318] text-white"
              >
                <Icon name="phone-off" size={22} strokeWidth={1.8} label="End call" />
              </button>
            )}
          </div>
          <p className="text-center text-[11px] text-white/40">
            {role === "owner"
              ? "Private room · not recorded · you hold the only owner token"
              : phase === "in-call"
                ? `${audioOnly ? "Audio only" : "Video"} · ${mb(used)} used · about ${audioOnly ? MB_PER_MIN.audio : MB_PER_MIN.video} MB a minute`
                : "Private · not recorded"}
          </p>
          {role === "owner" && phase === "in-call" && (
            <p className="text-center text-[11px] text-white/40">
              {participants > 0 ? `${participants} other participant${participants > 1 ? "s" : ""} in the room` : "No one else in the room yet"}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
