"use server";

// Invoicing server actions: raise a manual invoice, issue a draft, cancel an
// unpaid one. Shared by the invoice composer, the invoices list, the invoice
// screen and the money tab of a matter.
//
// Rules enforced here:
//  · The database is the authorization layer. create_invoice(), issue_invoice()
//    and cancel_invoice() all run as the signed-in staff member, so staff_w()
//    (firm member + MFA + firm not suspended) and admin_w() decide, never this
//    file, and no service key is ever used. Refusals are returned word for word
//    so a lawyer reads the real reason ("a part-paid or paid invoice cannot be
//    cancelled — raise a credit note") instead of a shrug.
//  · Money is integer minor units in the database. The console collects naira
//    and dollars the way a lawyer types them, so the rounding to kobo/cents
//    happens HERE — never in SQL, and never in the browser.
//  · Nothing is firm-specific: the firm always arrives from the caller's
//    context, and the currency defaults to the firm's own when none is given.
//
// A note on naming: the item field is `unitMajor` because that is what it holds
// — the amount as a lawyer types it, in naira or dollars. toMinorUnits() below
// is the single place it becomes the integer the RPC wants, so a field name can
// never disagree with its contents.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import type { InvoiceResult } from "@/lib/db/types";

type Err = { error: string } | undefined;

/** create_invoice() refuses more than fifty lines; say so before the round trip. */
const MAX_ITEMS = 50;

/**
 * Major units → integer minor units. Multiplying money by 100 in binary floating
 * point is a trap (19.99 * 100 is 1998.9999999999998), so the product is fixed to
 * four places before it is rounded.
 */
function toMinorUnits(major: number): number {
  return Math.round(Number((major * 100).toFixed(4)));
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the invoice and try again.";
}

/** invoices.due_at is a calendar day: accept a plain day or an instant, keep the day. */
const dueOnField = z
  .string()
  .trim()
  .refine((v) => v === "" || !Number.isNaN(Date.parse(v)), { message: "That due date could not be read." })
  .transform((v) => (v === "" ? null : /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : new Date(v).toISOString().slice(0, 10)))
  .nullish();

const itemSchema = z.object({
  description: z.string().trim().min(1, "Every line needs a description.").max(300),
  quantity: z
    .number({ invalid_type_error: "Every line needs a quantity." })
    .finite("Every line needs a quantity.")
    .positive("Every line needs a quantity above zero.")
    .max(100_000, "That quantity is too large."),
  /** MAJOR units as typed on the screen — converted to minor units below. */
  unitMajor: z
    .number({ invalid_type_error: "Every line needs an amount." })
    .finite("Every line needs an amount.")
    .nonnegative("An amount cannot be negative.")
    .max(1_000_000_000, "That amount is too large."),
});

const createSchema = z.object({
  firmId: z.string().uuid(),
  clientId: z.string().uuid("Choose the client this invoice is for."),
  items: z
    .array(itemSchema)
    .min(1, "An invoice needs at least one line.")
    .max(MAX_ITEMS, `An invoice takes at most ${MAX_ITEMS} lines.`),
  matterId: z.string().uuid().nullish(),
  currency: z.enum(["NGN", "USD"]).optional(),
  dueOn: dueOnField,
  issue: z.boolean(),
  note: z.string().trim().max(2000).nullish(),
});

export type CreateInvoiceInput = z.input<typeof createSchema>;

function refresh(invoiceId?: string | null, matterId?: string | null) {
  revalidatePath("/firm");
  revalidatePath("/firm/invoices");
  revalidatePath("/firm/overview");
  revalidatePath("/firm/clients");
  if (invoiceId) {
    revalidatePath(`/firm/invoices/${invoiceId}`);
    revalidatePath(`/app/payments/${invoiceId}`);
  }
  if (matterId) revalidatePath(`/firm/matters/${matterId}`);
  revalidatePath("/app/payments");
}

/**
 * Raise an invoice. create_invoice() mints the number (next_reference() is
 * service-only), applies the firm's own VAT rate, writes the items and — when
 * `issue` is true — issues it, notifies the client and posts the client-visible
 * "Invoice issued" entry on the matter, all in one transaction.
 */
export async function createInvoice(input: CreateInvoiceInput): Promise<{ error: string } | InvoiceResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const d = parsed.data;

  // The same arithmetic create_invoice() does, so the screen and the database
  // never disagree about what the invoice comes to.
  const items = d.items.map((item) => ({
    description: item.description,
    quantity: item.quantity,
    unit_minor: toMinorUnits(item.unitMajor),
  }));
  const subtotalMinor = items.reduce((sum, item) => sum + Math.round(item.unit_minor * item.quantity), 0);
  if (subtotalMinor <= 0) return { error: "An invoice must come to more than zero." };

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  const { data, error } = await supabase.rpc("create_invoice", {
    p_firm: d.firmId,
    p_client: d.clientId,
    p_items: items,
    p_matter: d.matterId || null,
    p_currency: d.currency ?? null,
    p_due_on: d.dueOn ?? null,
    p_issue: d.issue,
    p_note: d.note || null,
  });
  if (error) return { error: error.message };

  const result = (data ?? null) as InvoiceResult | null;
  if (!result?.invoice_id || !result.number) return { error: "The invoice could not be raised. Try again." };

  refresh(result.invoice_id, d.matterId ?? null);
  return result;
}

/**
 * Draft → issued. The client only ever sees issued invoices (invoices_select),
 * so this is the moment the invoice reaches them and the notification is sent.
 */
export async function issueInvoice(invoiceId: string, dueOn?: string | null): Promise<Err> {
  if (!z.string().uuid().safeParse(invoiceId).success) return { error: "Unknown invoice." };
  const parsedDue = dueOnField.safeParse(dueOn ?? null);
  if (!parsedDue.success) return { error: firstIssue(parsedDue.error) };

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  const { error } = await supabase.rpc("issue_invoice", {
    p_invoice: invoiceId,
    p_due_on: parsedDue.data ?? null,
  });
  if (error) return { error: error.message };

  const { data: row } = await supabase.from("invoices").select("matter_id").eq("id", invoiceId).maybeSingle();
  refresh(invoiceId, (row as { matter_id: string | null } | null)?.matter_id ?? null);
  return undefined;
}

/**
 * Cancel an unpaid invoice. admin_w() — an owner or an admin — decides; a
 * part-paid or paid invoice is refused, because the receipt is the client's
 * record, and a consultation fee is refused because the appointment owns it.
 * The reason is written to the audit trail, so it is required here.
 */
export async function cancelInvoice(invoiceId: string, reason: string): Promise<Err> {
  const parsed = z
    .object({
      invoiceId: z.string().uuid("Unknown invoice."),
      reason: z
        .string()
        .trim()
        .min(3, "Say why the invoice is being cancelled — it is kept in the audit trail.")
        .max(500),
    })
    .safeParse({ invoiceId, reason });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  const { data: row } = await supabase.from("invoices").select("matter_id").eq("id", parsed.data.invoiceId).maybeSingle();
  const { error } = await supabase.rpc("cancel_invoice", {
    p_invoice: parsed.data.invoiceId,
    p_reason: parsed.data.reason,
  });
  if (error) return { error: error.message };

  refresh(parsed.data.invoiceId, (row as { matter_id: string | null } | null)?.matter_id ?? null);
  return undefined;
}
