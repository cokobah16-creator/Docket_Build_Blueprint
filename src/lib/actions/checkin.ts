"use server";

// Before a consultation: the client's answers to what is still missing, the firm's request for
// a document on the consultation, and the firm's confirmation of a held booking.
//
// Rules enforced here: amend_intake_response() and confirm_appointment() decide (the client of
// the consultation; staff_w and appointment_ready), the request is a plain insert under
// document_requests_insert, no service key is used, and every refusal is the database's own
// sentence. Nothing here computes readiness: appointment_readiness() does, and the screens read it.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";

type Err = { error: string } | undefined;
const uuid = z.string().uuid();

function refresh(appointmentId: string) {
  revalidatePath(`/app/appointments/${appointmentId}`);
  revalidatePath(`/firm/appointments/${appointmentId}`);
  revalidatePath("/firm/appointments");
  revalidatePath("/app/appointments");
}

/** The client answers only what the form still requires. A new row; answers are never edited. */
export async function amendIntakeAnswers(appointmentId: string, answers: Record<string, string | string[]>): Promise<Err> {
  if (!uuid.safeParse(appointmentId).success) return { error: "Unknown appointment." };
  const clean: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(answers)) {
    if (!/^[a-z0-9_]{1,64}$/i.test(k)) continue;
    if (Array.isArray(v)) { const arr = v.map((x) => String(x).trim().slice(0, 500)).filter(Boolean); if (arr.length) clean[k] = arr; }
    else { const t = String(v).trim().slice(0, 8000); if (t) clean[k] = t; }
  }
  if (Object.keys(clean).length === 0) return { error: "Answer at least one question." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error } = await supabase.rpc("amend_intake_response", { p_appointment: appointmentId, p_answers: clean });
  if (error) return { error: error.message };
  refresh(appointmentId);
  return undefined;
}

/** Staff confirm a held booking. The database refuses until everything required is in. */
export async function confirmAppointment(appointmentId: string): Promise<Err> {
  if (!uuid.safeParse(appointmentId).success) return { error: "Unknown appointment." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error } = await supabase.rpc("confirm_appointment", { p_appointment: appointmentId });
  if (error) return { error: error.message };
  refresh(appointmentId);
  return undefined;
}

const plainDay = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Give the day as YYYY-MM-DD.");

/** Ask the client for a document before the consultation. Under document_requests_insert. */
export async function requestAppointmentDocument(appointmentId: string, firmId: string, input: { title: string; why?: string | null; dueOn?: string | null }, clientRef?: string | null): Promise<Err> {
  if (!uuid.safeParse(appointmentId).success || !uuid.safeParse(firmId).success) return { error: "Unknown appointment." };
  const schema = z.object({
    title: z.string().trim().min(2, "Say what document you need.").max(200),
    why: z.string().trim().max(2000).nullish(),
    dueOn: plainDay.nullish().or(z.literal("")),
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the request and try again." };
  const d = parsed.data;
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: "Not signed in." };
  const ref = clientRef && uuid.safeParse(clientRef).success ? clientRef : null;
  const { error } = await supabase.from("document_requests").insert({
    firm_id: firmId, appointment_id: appointmentId, matter_id: null,
    title: d.title, why: d.why || null, due_on: d.dueOn || null, requested_by: auth.user.id, client_ref: ref,
  });
  // The same reference is the same request (migration 36): a retry after a lost reply asks once.
  if (error && !(ref && error.code === "23505")) return { error: error.message };
  refresh(appointmentId);
  return undefined;
}

export async function withdrawAppointmentDocumentRequest(requestId: string, appointmentId: string): Promise<Err> {
  if (!uuid.safeParse(requestId).success || !uuid.safeParse(appointmentId).success) return { error: "Unknown request." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error, count } = await supabase.from("document_requests").update({ cancelled_at: new Date().toISOString() }, { count: "exact" }).eq("id", requestId).is("cancelled_at", null).is("fulfilled_at", null);
  if (error) return { error: error.message };
  if (count === 0) return { error: "That request is already answered or withdrawn." };
  refresh(appointmentId);
  return undefined;
}
