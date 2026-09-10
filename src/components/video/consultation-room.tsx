"use client";

// Consultation room on Daily Prebuilt with Docket controls around it.
// - Preflight: camera and microphone test before joining.
// - Join window: opens 10 minutes before the start (the Edge Function enforces the same rule).
// - Client (participant) knocks; the lawyer (owner) sees the knock and admits from here.
// - Timer and connection quality; "End and write notes" for the owner.
// Recording is never enabled on the room or the token and no control for it is exposed.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { joinConsultation, recordSessionEvent, type SessionEvent } from "@/lib/actions/video";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/cn";

type Phase = "preflight" | "connecting" | "lobby" | "in-call" | "ended" | "error";
type Quality = "good" | "low" | "very-low" | "unknown";

const JOIN_BEFORE_MS = 10 * 60 * 1000;

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

  const [phase, setPhase] = useState<Phase>("preflight");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [devicesOk, setDevicesOk] = useState<boolean | null>(null);
  const [deviceMessage, setDeviceMessage] = useState<string>("Checking your camera and microphone…");
  const [joinedAt, setJoinedAt] = useState<number | null>(null);
  const [quality, setQuality] = useState<Quality>("unknown");
  const [waitingCount, setWaitingCount] = useState(0);
  const [participants, setParticipants] = useState(0);

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
        iframeStyle: { width: "100%", height: "100%", border: "0", borderRadius: "12px" },
        theme: { colors: { accent, accentText: "#FFFFFF" } },
      });
      frameRef.current = frame;
      frame
        .on("joined-meeting", () => {
          if (role === "owner") {
            setPhase("in-call");
            setJoinedAt(Date.now());
            emit("started");
          } else if (frame.accessState?.()?.access?.level === "full") {
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
      await frame.join({ url: info.room_url, token: info.token ?? undefined, userName: info.user_name });
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
    emit("ended");
    await leave();
    setPhase("ended");
    if (notesHref) router.push(notesHref);
  }, [emit, leave, notesHref, router]);

  const untilOpen = opensAt - now;
  const elapsed = joinedAt ? now - joinedAt : 0;
  const qualityLabel: Record<Quality, string> = {
    good: "Connection good",
    low: "Connection weak",
    "very-low": "Connection poor",
    unknown: "Connecting…",
  };

  return (
    <div className="space-y-4">
      {error && <Alert kind="error">{error}</Alert>}

      {(phase === "preflight" || phase === "connecting") && (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-card border border-gray-200 bg-black">
            <video ref={previewRef} playsInline autoPlay muted className="aspect-video w-full object-cover" />
          </div>
          <p
            className={cn("text-sm", devicesOk === false ? "text-amber-800" : "text-gray-600")}
            role="status"
          >
            {deviceMessage}
          </p>
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
      )}

      <div className={cn(phase === "lobby" || phase === "in-call" || phase === "error" ? "block" : "hidden")}>
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 text-sm text-gray-700">
          <span className="font-medium">
            {phase === "lobby"
              ? `Waiting for ${counterpartLabel}…`
              : phase === "in-call"
                ? `In consultation · ${mmss(elapsed)}`
                : ""}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs",
              quality === "good" && "border-emerald-200 bg-emerald-50 text-emerald-900",
              quality === "low" && "border-amber-200 bg-amber-50 text-amber-900",
              quality === "very-low" && "border-red-200 bg-red-50 text-red-900",
              quality === "unknown" && "border-gray-200 bg-gray-50 text-gray-600",
            )}
            aria-live="polite"
          >
            <span aria-hidden="true">●</span> {qualityLabel[quality]}
          </span>
        </div>
        {role === "owner" && waitingCount > 0 && (
          <Alert kind="info" className="mb-2">
            <span className="mr-3">
              {waitingCount === 1 ? "Your client is waiting to be admitted." : `${waitingCount} people are waiting.`}
            </span>
            <Button size="sm" onClick={admitAll}>
              Admit
            </Button>
          </Alert>
        )}
        <div ref={containerRef} className="aspect-[4/3] w-full overflow-hidden rounded-card bg-black sm:aspect-video" />
        {phase === "lobby" && (
          <p className="mt-2 text-sm text-gray-600" role="status">
            You are in the waiting room. {counterpartLabel} will let you in shortly. Keep this page open.
          </p>
        )}
        {role === "owner" && phase === "in-call" && (
          <div className="mt-3 flex flex-wrap gap-3">
            <Button variant="danger" onClick={endAndNotes}>
              End and write notes
            </Button>
            <span className="self-center text-xs text-gray-500">
              {participants > 0 ? `${participants} other participant${participants > 1 ? "s" : ""} in the room` : "No one else in the room yet"}
            </span>
          </div>
        )}
      </div>

      {phase === "ended" && (
        <div className="space-y-3">
          <Alert kind="success" title="Call ended">
            {role === "owner"
              ? "Write the consultation notes now while it is fresh. Your client sees only the summary."
              : "Thank you. Your lawyer's summary will appear on your appointment page once it is written."}
          </Alert>
          <div className="flex flex-wrap gap-3">
            {role === "owner" && notesHref && (
              <Button onClick={() => router.push(notesHref)}>Write notes</Button>
            )}
            <Button variant="ghost" onClick={() => router.push(doneHref)}>
              Back to appointment
            </Button>
            {now <= closesAt && (
              <Button variant="ghost" onClick={() => setPhase("preflight")}>
                Rejoin
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
