"use server";

// Client-portal server actions. Every write runs as the signed-in user; RLS
// is the authorization. Nothing here uses a service key or marks anything paid.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { siteOrigin } from "@/lib/site";
import { paymentProviderFor, type Currency, type PaymentChannel } from "@/lib/providers/payments";
import { SELECTED_FIRM_COOKIE, clientFirms } from "@/lib/portal-firm";
import type { MessageAttachment } from "@/lib/db/types";

type Err = { error: string } | undefined;

async function userClient() {
  const supabase = await supabaseServer();
  if (!supabase) return { supabase: null, user: null };
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

/** Pay any open invoice (consultation or matter). Redirects to the provider checkout. */
export async function startInvoicePayment(invoiceId: string, channel?: PaymentChannel | null): Promise<Err> {
  const { supabase, user } = await userClient();
  if (!supabase) return { error: "Payments are not configured yet." };
  if (!user) redirect("/app/login");

  const { data: row } = await supabase
    .from("invoices")
    .select("id, number, total_minor, paid_minor, currency, status")
    .eq("id", invoiceId)
    .maybeSingle();
  const invoice = row as { id: string; number: string; total_minor: number; paid_minor: number; currency: Currency; status: string } | null;
  if (!invoice) return { error: "Invoice not found." };
  const resultPath = `/app/payments/${invoice.id}/payment-result`;
  if (invoice.status === "paid") redirect(resultPath);
  if (invoice.status === "cancelled") return { error: "This invoice was cancelled." };
  const outstanding = invoice.total_minor - invoice.paid_minor;
  if (outstanding <= 0) redirect(resultPath);

  let email = user.email ?? null;
  if (!email) {
    const { data: profile } = await supabase.from("profiles").select("email").eq("id", user.id).maybeSingle();
    email = (profile as { email: string | null } | null)?.email ?? null;
  }
  if (!email) return { error: "Add an email address on your profile first so we can send your receipt." };

  // Fees settle to the firm's own Paystack subaccount; record_payment() refuses money settled anywhere else.
  const { data: settlement } = await supabase.rpc("invoice_settlement", { p_invoice: invoice.id });
  const subaccount = (settlement as { paystack_subaccount: string | null } | null)?.paystack_subaccount ?? null;
  if (!subaccount) return { error: "This firm is not yet set up to receive payments. Please contact the firm." };

  const origin = await siteOrigin();
  let checkoutUrl: string;
  try {
    const result = await paymentProviderFor(invoice.currency).initialize({
      invoiceNumber: invoice.number,
      amountMinor: outstanding,
      currency: invoice.currency,
      email,
      description: `Invoice ${invoice.number}`,
      callbackUrl: `${origin}${resultPath}`,
      cancelUrl: `${origin}/app/payments/${invoice.id}`,
      subaccount,
      channel: channel ?? null,
    });
    checkoutUrl = result.checkoutUrl;
  } catch (err) {
    return { error: err instanceof Error ? `Could not start payment: ${err.message}` : "Could not start payment." };
  }
  redirect(checkoutUrl);
}

// ---------------------------------------------------------------- documents
const createDocumentSchema = z.object({
  matterId: z.string().uuid().nullable(),
  appointmentId: z.string().uuid().nullable(),
  firmId: z.string().uuid(),
  name: z.string().min(1).max(200),
  mime: z.string().max(100),
  sizeBytes: z.number().int().positive().max(26_214_400),
});

/**
 * Step 1 of a client upload: create the document + version ids so the storage
 * policy (which checks the documents row) lets the browser upload to
 * documents/{firm}/{document}/{version}.{ext}. No RETURNING: the select
 * policy's helper cannot see a row inserted by the same statement.
 */
export async function createDocument(input: z.infer<typeof createDocumentSchema>): Promise<
  { ok: true; documentId: string; versionId: string; storagePath: string } | { ok: false; error: string }
> {
  const parsed = createDocumentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid upload." };
  const { supabase, user } = await userClient();
  if (!supabase || !user) return { ok: false, error: "Sign in first." };
  const { matterId, appointmentId, firmId, name, mime, sizeBytes } = parsed.data;
  if (!matterId && !appointmentId) return { ok: false, error: "Choose a matter." };

  const documentId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const ext = (name.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
  const storagePath = `${firmId}/${documentId}/${versionId}.${ext}`;

  const { error } = await supabase.from("documents").insert({
    id: documentId,
    firm_id: firmId,
    matter_id: matterId,
    appointment_id: appointmentId,
    name,
    category: "client_upload",
    client_visible: true,
    uploaded_by: user.id,
  });
  if (error) return { ok: false, error: error.message };
  void mime; void sizeBytes;
  return { ok: true, documentId, versionId, storagePath };
}

/**
 * Link an upload to the request it answers. fulfil_document_request() (migration 31) is the one
 * door: it checks the document is on the same matter and that the request is open, marks it
 * answered once, and tells whoever asked.
 */
export async function fulfilDocumentRequest(requestId: string, documentId: string): Promise<Err> {
  if (!z.string().uuid().safeParse(requestId).success || !z.string().uuid().safeParse(documentId).success) return { error: "Unknown request." };
  const { supabase, user } = await userClient();
  if (!supabase || !user) return { error: "Sign in first." };
  const { error } = await supabase.rpc("fulfil_document_request", { p_request: requestId, p_document: documentId });
  if (error) return { error: error.message };
  revalidatePath("/app");
  return undefined;
}

/** Step 2: after the browser uploaded the file, record the version (trigger sets current_version_id). */
export async function finalizeDocumentVersion(input: {
  documentId: string; versionId: string; storagePath: string; mime: string; sizeBytes: number;
  /** Hex SHA-256 of the uploaded file, computed in the browser. */
  checksum?: string | null;
}): Promise<Err> {
  const { supabase, user } = await userClient();
  if (!supabase || !user) return { error: "Sign in first." };
  // A checksum is recorded only when it is a real one: anything that is not 64
  // hex characters is dropped rather than filed as if it proved something.
  const checksum = typeof input.checksum === "string" && /^[0-9a-f]{64}$/.test(input.checksum) ? input.checksum : null;
  const { error } = await supabase.from("document_versions").insert({
    id: input.versionId,
    document_id: input.documentId,
    storage_path: input.storagePath,
    mime: input.mime,
    size_bytes: input.sizeBytes,
    checksum,
    uploaded_by: user.id,
  });
  if (error) return { error: error.message };
  revalidatePath("/app");
  revalidatePath("/app/matters");
  return undefined;
}

// ---------------------------------------------------------------- messages
export async function sendMessage(input: {
  firmId: string; matterId: string | null; appointmentId: string | null; body: string; attachments: MessageAttachment[];
  /** Minted by the composer per message: a retry after a lost reply lands once, on the key. */
  id?: string | null;
}): Promise<Err> {
  const { supabase, user } = await userClient();
  if (!supabase || !user) return { error: "Sign in first." };
  const body = input.body.trim();
  if (!body && input.attachments.length === 0) return { error: "Write a message or attach a document." };
  if (body.length > 4000) return { error: "Keep messages under 4,000 characters." };
  const id = input.id && z.string().uuid().safeParse(input.id).success ? input.id : undefined;
  const { error } = await supabase.from("messages").insert({
    ...(id ? { id } : {}),
    firm_id: input.firmId,
    matter_id: input.matterId,
    appointment_id: input.appointmentId,
    sender_id: user.id,
    body: body || null,
    attachments: input.attachments.slice(0, 5),
  });
  // The same message sent twice (a retry whose first reply was lost) is refused by the primary
  // key: that is success, not a failure to show.
  if (error && error.code === "23505" && id) return undefined;
  if (error) return { error: error.message };
  return undefined;
}

/** Retire a documents row that never received its file: an upload that stopped. retire_empty_document() decides. */
export async function retireEmptyDocument(documentId: string): Promise<Err> {
  if (!z.string().uuid().safeParse(documentId).success) return { error: "Unknown document." };
  const { supabase, user } = await userClient();
  if (!supabase || !user) return { error: "Sign in first." };
  const { error } = await supabase.rpc("retire_empty_document", { p_document: documentId });
  if (error) return { error: error.message };
  revalidatePath("/app");
  revalidatePath("/firm");
  return undefined;
}

/**
 * Read receipts. mark_thread_read() (migration 25) writes a per-reader receipt for every tracked
 * message from the other side of the thread, and keeps messages.read_at honest for the client's
 * "seen by your firm". It replaced a direct update that set read_at firm-wide on mount — so the
 * first staff member to open a thread marked it read for every colleague, permanently, and that
 * column was exactly what Today counted as unread. The RPC is the only door: the table's write
 * grant was removed.
 */
export async function markThreadRead(input: { matterId: string | null; appointmentId: string | null }): Promise<void> {
  const { supabase, user } = await userClient();
  if (!supabase || !user) return;
  if (!input.matterId && !input.appointmentId) return;
  await supabase.rpc("mark_thread_read", { p_matter: input.matterId, p_appointment: input.appointmentId });
}

// ---------------------------------------------------------------- notifications
export async function markNotificationsRead(ids: string[] | "all"): Promise<void> {
  const { supabase, user } = await userClient();
  if (!supabase || !user) return;
  let q = supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("channel", "in_app").is("read_at", null);
  if (ids !== "all") q = q.in("id", ids.slice(0, 200));
  await q;
  revalidatePath("/app/notifications");
  revalidatePath("/app");
}

const prefSchema = z.array(z.object({
  event: z.string().min(1).max(64),
  channel: z.enum(["in_app", "push", "email", "sms", "whatsapp"]),
  enabled: z.boolean(),
})).max(100);

export async function savePreferences(prefs: z.infer<typeof prefSchema>): Promise<Err> {
  const parsed = prefSchema.safeParse(prefs);
  if (!parsed.success) return { error: "Invalid preferences." };
  const { supabase, user } = await userClient();
  if (!supabase || !user) return { error: "Sign in first." };
  const rows = parsed.data.map((p) => ({ user_id: user.id, event: p.event, channel: p.channel, enabled: p.enabled }));
  const { error } = await supabase.from("notification_preferences").upsert(rows, { onConflict: "user_id,event,channel" });
  if (error) return { error: error.message };
  revalidatePath("/app/notifications/preferences");
  return undefined;
}

// ---------------------------------------------------------------- profile
const profileSchema = z.object({
  fullName: z.string().trim().max(120),
  email: z.string().trim().email().max(200).or(z.literal("")),
  timezone: z.string().min(1).max(64),
  // No whatsapp: nothing delivers on it yet, and a channel that delivers nothing is not a choice.
  preferredChannel: z.enum(["in_app", "push", "email", "sms"]),
  quietStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).or(z.literal("")),
  quietEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).or(z.literal("")),
});

export async function updateProfile(formData: FormData): Promise<void> {
  const parsed = profileSchema.safeParse({
    fullName: formData.get("fullName") ?? "",
    email: formData.get("email") ?? "",
    timezone: formData.get("timezone") ?? "Africa/Lagos",
    preferredChannel: formData.get("preferredChannel") ?? "sms",
    quietStart: formData.get("quietStart") ?? "",
    quietEnd: formData.get("quietEnd") ?? "",
  });
  if (!parsed.success) redirect(`/app/profile?error=${encodeURIComponent("Check the form: " + parsed.error.issues[0]?.message)}`);
  const { supabase, user } = await userClient();
  if (!supabase || !user) redirect("/app/login");
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: parsed.data.timezone });
  } catch {
    redirect(`/app/profile?error=${encodeURIComponent("Unknown timezone.")}`);
  }
  const d = parsed.data;
  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: d.fullName || null,
      email: d.email || null,
      timezone: d.timezone,
      preferred_channel: d.preferredChannel,
      quiet_hours_start: d.quietStart || null,
      quiet_hours_end: d.quietEnd || null,
    })
    .eq("id", user.id);
  if (error) redirect(`/app/profile?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/app/profile");
  revalidatePath("/app");
  redirect("/app/profile?saved=1");
}

/** Sign out of every device (global scope), then back to login. */
export async function signOutEverywhere(): Promise<void> {
  const supabase = await supabaseServer();
  if (supabase) await supabase.auth.signOut({ scope: "global" });
  redirect("/app/login");
}

const selectFirmSchema = z.object({ firmId: z.string().uuid() });

/**
 * Switch which firm the portal is reading — its name, its colours, its rows.
 *
 * The cookie is only ever set to a firm that already acts for this client, so
 * a forged form post selects nothing. It is a view preference either way: RLS
 * decides what every query returns, not this cookie.
 */
export async function selectFirm(formData: FormData): Promise<void> {
  const parsed = selectFirmSchema.safeParse({ firmId: formData.get("firmId") });
  if (!parsed.success) return;

  const supabase = await supabaseServer();
  if (!supabase) return;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const firms = await clientFirms(supabase);
  if (!firms.some((f) => f.id === parsed.data.firmId)) return;

  const jar = await cookies();
  jar.set(SELECTED_FIRM_COOKIE, parsed.data.firmId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/app",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/app", "layout");
}
