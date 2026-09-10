"use server";

// Counsel on the other side, and service of court processes.
//
// Screens served: the counsel roster and the serve-a-process sheet on the matter
// workbench, and the filing and withdrawal actions on the service inbox.
//
// Rules enforced here:
//  · The database is the authorization layer. Every write below runs as the
//    signed-in staff member — staff_w() (firm member + MFA + firm not suspended)
//    decides, never this file, and no service key is ever used.
//  · The refusals are the rules of court themselves ("an originating process may
//    only be served on counsel who has undertaken to accept service, or under an
//    order for substituted service", "that firm has not undertaken to accept
//    service through Docket — serve at its address for service"). They are
//    returned verbatim so the lawyer reads the rule, not a shrug.
//  · Counsel is an address for service, never portal access: a matter_counsel row
//    grants the other side nothing but sight of a process actually served on it.
//  · Nothing firm-specific: the firm is read from the matter, never hard-coded.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { isE164, normalizeNigerianPhone } from "@/lib/nigeria";
import { SERVICE_METHODS } from "@/lib/db/types";

type Err = { error: string } | undefined;

const SIDES = new Set(["opposing", "co_counsel", "other"]);
const PARTY_SIDES = new Set([
  "claimant", "defendant", "appellant", "respondent", "applicant",
  "prosecution", "accused", "interested", "other",
]);
const METHODS = new Set(SERVICE_METHODS.map((m) => m.value));

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the form and try again.";
}

const uuid = z.string().uuid();

/** An instant the database keeps in UTC; the forms send one from the viewer's zone. */
const instant = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: "That date and time could not be read." })
  .transform((v) => new Date(v).toISOString());

/** A calendar date column (deemed service, response due): keep the day, not the instant. */
const plainDay = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: "That date could not be read." })
  .transform((v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : new Date(v).toISOString().slice(0, 10)));

function refreshMatter(matterId?: string | null) {
  revalidatePath("/firm");
  revalidatePath("/firm/matters");
  if (matterId) revalidatePath(`/firm/matters/${matterId}`);
}

// ---------------------------------------------------------------- counsel roster
const counselSchema = z.object({
  side: z.string().refine((v) => SIDES.has(v), {
    message: "Say whether this is opposing counsel, a co-counsel or someone else.",
  }),
  partyName: z.string().trim().max(200).nullish(),
  partySide: z.string().refine((v) => PARTY_SIDES.has(v), { message: "That is not a side a party can be on." }).nullish(),
  counselFirmId: uuid.nullish(),
  counselName: z.string().trim().max(200).nullish(),
  counselFirmName: z.string().trim().max(200).nullish(),
  scn: z.string().trim().max(40).nullish(),
  email: z.string().trim().max(200).nullish(),
  phone: z.string().trim().max(40).nullish(),
  addressForService: z.string().trim().max(600).nullish(),
  onRecord: z.boolean().optional(),
  acceptsService: z.boolean().optional(),
  note: z.string().trim().max(2000).nullish(),
});

export type CounselInput = z.input<typeof counselSchema>;
export type CounselPatch = Partial<CounselInput>;
export type AddCounselResult = { error: string } | { counselId: string };

/** Normalise the contact columns once, so the roster and the patch agree. */
function contactFields(d: z.infer<typeof counselSchema>): { row: Record<string, unknown> } | { error: string } {
  const rawEmail = (d.email ?? "").trim().toLowerCase();
  if (rawEmail && !z.string().email().safeParse(rawEmail).success) {
    return { error: "That email address does not look right." };
  }
  const rawPhone = (d.phone ?? "").trim();
  let phone: string | null = null;
  if (rawPhone) {
    phone = normalizeNigerianPhone(rawPhone) ?? (isE164(rawPhone) ? rawPhone : null);
    if (!phone) return { error: "That phone number does not look right. Use 0803… or +234…" };
  }
  return {
    row: {
      side: d.side,
      party_name: d.partyName || null,
      party_side: d.partySide || null,
      counsel_firm_id: d.counselFirmId || null,
      counsel_name: d.counselName || null,
      counsel_firm_name: d.counselFirmName || null,
      scn: d.scn || null,
      email: rawEmail || null,
      phone,
      address_for_service: d.addressForService || null,
      on_record: d.onRecord ?? false,
      accepts_service: d.acceptsService ?? false,
      note: d.note || null,
    },
  };
}

/**
 * Record counsel for one of the other parties: a firm on Docket, or an address
 * for service off it. The row belongs to the firm that owns the matter (a
 * database trigger insists on it) and is created by the signed-in staff member,
 * which the insert policy checks. The id is generated here and nothing is
 * returned by the insert: the select policy cannot see a row the same statement
 * is writing.
 */
export async function addCounsel(matterId: string, input: CounselInput): Promise<AddCounselResult> {
  if (!uuid.safeParse(matterId).success) return { error: "Unknown matter." };
  const parsed = counselSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const d = parsed.data;
  if (!d.counselFirmId && !(d.counselName ?? "").trim() && !(d.counselFirmName ?? "").trim()) {
    return { error: "Pick their firm on Docket, or type counsel's name or the name of their chambers." };
  }

  const fields = contactFields(d);
  if ("error" in fields) return { error: fields.error };

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in first." };

  const { data: matterRow } = await supabase
    .from("matters")
    .select("id, firm_id")
    .eq("id", matterId)
    .maybeSingle();
  const matter = (matterRow ?? null) as { id: string; firm_id: string } | null;
  if (!matter) return { error: "Matter not found." };
  if (d.counselFirmId && d.counselFirmId === matter.firm_id) {
    return { error: "That is your own firm. Counsel here is the firm on the other side of the case." };
  }

  const counselId = crypto.randomUUID();
  const { error } = await supabase.from("matter_counsel").insert({
    id: counselId,
    firm_id: matter.firm_id,
    matter_id: matter.id,
    created_by: user.id,
    ...fields.row,
  });
  if (error) return { error: error.message };

  refreshMatter(matter.id);
  return { counselId };
}

/**
 * Change what we hold for counsel — the party they act for, whether they are on
 * record, whether they have undertaken to accept service. Only the keys actually
 * passed are written. Re-pointing a counsel row at a different firm after that
 * counsel has been served through Docket is refused by the database; record new
 * counsel as a new row instead.
 */
export async function updateCounsel(counselId: string, patch: CounselPatch): Promise<Err> {
  if (!uuid.safeParse(counselId).success) return { error: "Unknown counsel." };
  const parsed = counselSchema.partial().safeParse(patch);
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  const { data: existingRow } = await supabase
    .from("matter_counsel")
    .select("id, matter_id, firm_id, side, party_name, party_side, counsel_firm_id, counsel_name, counsel_firm_name, scn, email, phone, address_for_service, on_record, accepts_service, note")
    .eq("id", counselId)
    .maybeSingle();
  const existing = (existingRow ?? null) as
    | (Record<string, unknown> & { id: string; matter_id: string; side: string })
    | null;
  if (!existing) return { error: "Counsel not found on this matter." };

  // Merge over what is already on record, so a patch that only flips a checkbox
  // cannot blank the address for service. A key passed as null clears it.
  const current: Record<string, unknown> = existing;
  const given = (key: keyof CounselPatch) => Object.prototype.hasOwnProperty.call(patch, key);
  const take = <T>(key: keyof CounselPatch, column: string): T =>
    (given(key) ? (patch[key] as unknown) : current[column]) as T;
  const merged = counselSchema.safeParse({
    side: given("side") ? patch.side : (current.side as string),
    partyName: take<string | null>("partyName", "party_name"),
    partySide: take<string | null>("partySide", "party_side"),
    counselFirmId: take<string | null>("counselFirmId", "counsel_firm_id"),
    counselName: take<string | null>("counselName", "counsel_name"),
    counselFirmName: take<string | null>("counselFirmName", "counsel_firm_name"),
    scn: take<string | null>("scn", "scn"),
    email: take<string | null>("email", "email"),
    phone: take<string | null>("phone", "phone"),
    addressForService: take<string | null>("addressForService", "address_for_service"),
    onRecord: Boolean(take<boolean>("onRecord", "on_record")),
    acceptsService: Boolean(take<boolean>("acceptsService", "accepts_service")),
    note: take<string | null>("note", "note"),
  });
  if (!merged.success) return { error: firstIssue(merged.error) };
  if (!merged.data.counselFirmId && !(merged.data.counselName ?? "").trim() && !(merged.data.counselFirmName ?? "").trim()) {
    return { error: "Counsel needs a name, a chambers, or a firm on Docket." };
  }

  const fields = contactFields(merged.data);
  if ("error" in fields) return { error: fields.error };

  const { error } = await supabase.from("matter_counsel").update(fields.row).eq("id", counselId);
  if (error) return { error: error.message };

  refreshMatter(existing.matter_id);
  return undefined;
}

/**
 * Take counsel off the roster. Counsel who has already been served through Docket
 * cannot be deleted — the service record is the proof of service and points at
 * this row — and the database says so.
 */
export async function removeCounsel(counselId: string): Promise<Err> {
  if (!uuid.safeParse(counselId).success) return { error: "Unknown counsel." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  const { data: row } = await supabase.from("matter_counsel").select("id, matter_id").eq("id", counselId).maybeSingle();
  const found = (row ?? null) as { id: string; matter_id: string } | null;
  if (!found) return { error: "Counsel not found on this matter." };

  const { error } = await supabase.from("matter_counsel").delete().eq("id", counselId);
  if (error) {
    // process_service.counsel_id is ON DELETE RESTRICT, and the raw foreign-key
    // message is not a sentence a lawyer can act on. Lead with the rule, keep the
    // database's own words after it.
    return {
      error:
        error.code === "23503"
          ? `This counsel has already been served through Docket, so the entry cannot be removed — the service record is your proof of service and points at it. Correct the address for service instead. (${error.message})`
          : error.message,
    };
  }

  refreshMatter(found.matter_id);
  return undefined;
}

// ---------------------------------------------------------------- serve a process
const serveSchema = z.object({
  matterId: uuid,
  counselId: uuid,
  documentId: uuid,
  processTitle: z.string().trim().min(2, "Give the process its title, as it reads on its face.").max(300),
  method: z.string().refine((v) => METHODS.has(v), { message: "Choose how the process was served." }),
  servedAt: instant.nullish(),
  note: z.string().trim().max(4000).nullish(),
  isOriginating: z.boolean().optional(),
  substitutedByOrder: z.boolean().optional(),
  authorityDocumentId: uuid.nullish(),
  servedOnName: z.string().trim().max(200).nullish(),
  servedOnCapacity: z.string().trim().max(200).nullish(),
  servedAtAddress: z.string().trim().max(600).nullish(),
  serverName: z.string().trim().max(200).nullish(),
  outsideIssuingState: z.boolean().optional(),
  deemedServedOn: plainDay.nullish(),
});

export type ServeProcessInput = z.input<typeof serveSchema>;
export type ServeProcessResult = { error: string } | { serviceId: string };

/**
 * serve_process() writes the service record, snapshots the document version and
 * its checksum (so what was served can never be swapped afterwards), posts the
 * client-visible "… served on …" entry on our own timeline, and — for service
 * through Docket — puts the process in the other firm's inbox and notifies it.
 *
 * It refuses, in the words of the rules of court: a document with no uploaded
 * version, a firm that has not undertaken to accept service here, an originating
 * process on counsel without an undertaking and without an order for substituted
 * service, and substituted service with no order attached. Those refusals are
 * returned as they are written.
 */
export async function serveProcess(input: ServeProcessInput): Promise<ServeProcessResult> {
  const parsed = serveSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const d = parsed.data;
  if (d.substitutedByOrder && !d.authorityDocumentId) {
    return { error: "Substituted service needs the court's order attached — pick it from the matter's documents." };
  }

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  const { data, error } = await supabase.rpc("serve_process", {
    p_matter: d.matterId,
    p_counsel: d.counselId,
    p_document: d.documentId,
    p_process_title: d.processTitle,
    p_method: d.method,
    // Service through Docket is stamped by the database at the moment it lands.
    p_served_at: d.method === "platform" ? null : d.servedAt || null,
    p_note: d.note || null,
    p_is_originating: d.isOriginating ?? false,
    p_substituted_by_order: d.substitutedByOrder ?? false,
    p_authority_document: d.authorityDocumentId || null,
    p_served_on_name: d.servedOnName || null,
    p_served_on_capacity: d.servedOnCapacity || null,
    p_served_at_address: d.servedAtAddress || null,
    p_server_name: d.serverName || null,
    p_outside_issuing_state: d.outsideIssuingState ?? false,
    p_deemed_served_on: d.deemedServedOn || null,
  });
  if (error) return { error: error.message };

  const serviceId = typeof data === "string" ? data : null;
  if (!serviceId) {
    return { error: "The database did not return the service record. Open the matter and check before serving again." };
  }

  refreshMatter(d.matterId);
  revalidatePath("/firm/inbox");
  revalidatePath("/app/matters");
  revalidatePath(`/app/matters/${d.matterId}`);
  return { serviceId };
}

// ---------------------------------------------------------------- the served firm's side
const linkSchema = z.object({
  serviceId: uuid,
  matterId: uuid,
  responseDueOn: plainDay.nullish(),
  note: z.string().trim().max(2000).nullish(),
});

/**
 * File a process served on us against one of our own matters and diarise the
 * date the response falls due. link_service_to_matter() refuses a matter that is
 * not ours, and files an internal timeline entry on that matter — the other side
 * never sees it.
 */
export async function linkServiceToMatter(
  serviceId: string,
  matterId: string,
  responseDueOn?: string | null,
  note?: string | null,
): Promise<Err> {
  const parsed = linkSchema.safeParse({ serviceId, matterId, responseDueOn, note });
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const d = parsed.data;

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  const { error } = await supabase.rpc("link_service_to_matter", {
    p_service: d.serviceId,
    p_matter: d.matterId,
    p_response_due_on: d.responseDueOn || null,
    p_note: d.note || null,
  });
  if (error) return { error: error.message };

  revalidatePath("/firm/inbox");
  refreshMatter(d.matterId);
  return undefined;
}

const revokeSchema = z.object({
  serviceId: uuid,
  reason: z.string().trim().min(3, "Say why the service is being withdrawn.").max(500),
});

/**
 * Withdraw a process served in error. The other firm's access ends at once — the
 * inbox view and the storage policies both key on a service that has not been
 * revoked. Only an owner or admin of the serving firm may do it; the database
 * checks that, not this file.
 */
export async function revokeService(serviceId: string, reason: string): Promise<Err> {
  const parsed = revokeSchema.safeParse({ serviceId, reason });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  const { error } = await supabase.rpc("revoke_service", {
    p_service: parsed.data.serviceId,
    p_reason: parsed.data.reason,
  });
  if (error) return { error: error.message };

  revalidatePath("/firm/inbox");
  refreshMatter(null);
  return undefined;
}
