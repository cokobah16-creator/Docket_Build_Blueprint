"use server";

// Consultation server actions. Room creation and tokens come from the
// video-session Edge Function (the only writer of consultation_sessions);
// the app forwards the caller's own session, never a service key.

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { restHeaders, supabaseAnonKey, supabaseUrl } from "@/lib/env";
import type { JoinInfo } from "@/lib/db/types";

type Result<T> = { ok: true; data: T } | { ok: false; error: string; opensAt?: string };

async function callVideoSession(body: Record<string, unknown>): Promise<Result<Record<string, unknown>>> {
  const supabase = await supabaseServer();
  const url = supabaseUrl();
  const key = supabaseAnonKey();
  if (!supabase || !url || !key) return { ok: false, error: "Video is not configured." };
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { ok: false, error: "Please sign in again." };

  let res: Response;
  try {
    res = await fetch(`${url}/functions/v1/video-session`, {
      method: "POST",
      headers: { ...restHeaders(key), authorization: `Bearer ${session.access_token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "Could not reach the video service. Check your connection and try again." };
  }
  let payload: Record<string, unknown> = {};
  try {
    payload = (await res.json()) as Record<string, unknown>;
  } catch {
    payload = {};
  }
  if (!res.ok) {
    const error = typeof payload.error === "string" ? payload.error : `Video service error (${res.status}).`;
    return { ok: false, error, opensAt: typeof payload.opens_at === "string" ? payload.opens_at : undefined };
  }
  return { ok: true, data: payload };
}

/** Get-or-create the room and a token for the signed-in caller. */
export async function joinConsultation(appointmentId: string): Promise<Result<JoinInfo>> {
  const r = await callVideoSession({ action: "join", appointment_id: appointmentId });
  if (!r.ok) return r;
  return { ok: true, data: r.data as unknown as JoinInfo };
}

export type SessionEvent = "joined" | "admitted" | "started" | "ended" | "left";

/** Record a session milestone (best effort; never blocks the call). */
export async function recordSessionEvent(appointmentId: string, event: SessionEvent): Promise<void> {
  await callVideoSession({ action: "event", appointment_id: appointmentId, event });
}

/** Lawyer: save notes after the call (client summary vs internal notes are separate tables). */
export async function saveConsultationNotes(input: {
  appointmentId: string;
  clientSummary: string;
  adviceGiven: string;
  followUp: string;
  internalNotes: string;
  markCompleted: boolean;
}): Promise<{ error: string } | undefined> {
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  if (!input.clientSummary.trim()) return { error: "Write the summary your client will see." };
  const { error } = await supabase.rpc("save_consultation_notes", {
    p_appointment: input.appointmentId,
    p_client_summary: input.clientSummary.trim(),
    p_advice_given: input.adviceGiven.trim() || null,
    p_follow_up: input.followUp.trim() || null,
    p_internal_notes: input.internalNotes.trim() || null,
    p_mark_completed: input.markCompleted,
  });
  if (error) return { error: error.message };
  revalidatePath(`/firm/appointments/${input.appointmentId}`);
  revalidatePath(`/app/appointments/${input.appointmentId}`);
  return undefined;
}

/** Staff: move an appointment to a slot the booking engine would offer. */
export async function rescheduleAppointment(
  appointmentId: string,
  startsAt: string,
  reason: string,
): Promise<{ error: string } | undefined> {
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  if (!startsAt || Number.isNaN(Date.parse(startsAt))) return { error: "Pick a new time." };
  const { error } = await supabase.rpc("reschedule_appointment", {
    p_appointment: appointmentId,
    p_starts_at: new Date(startsAt).toISOString(),
    p_reason: reason.trim() || null,
  });
  if (error) return { error: error.message };
  revalidatePath(`/firm/appointments/${appointmentId}`);
  revalidatePath("/firm/appointments");
  revalidatePath(`/app/appointments/${appointmentId}`);
  return undefined;
}

export async function markNoShow(appointmentId: string): Promise<{ error: string } | undefined> {
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error } = await supabase.rpc("mark_no_show", { p_appointment: appointmentId });
  if (error) return { error: error.message };
  revalidatePath(`/firm/appointments/${appointmentId}`);
  revalidatePath("/firm/appointments");
  return undefined;
}
