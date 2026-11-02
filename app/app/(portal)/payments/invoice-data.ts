// What the invoice page, its PDF and its payment result read the same way: the invoice's columns,
// what it is for, and the figures "Before you pay" is built from. One module, so an invoice cannot
// say one thing on the screen and another on paper.
//
// It lives beside the pages because a page or route file may only export what Next.js expects of
// one. It reads with the caller's own client, so RLS decides what it sees.

import type { SupabaseClient } from "@supabase/supabase-js";
import { captureException } from "@/lib/observability";
import { normaliseTin } from "@/lib/nigeria";
import { whenWords } from "@/lib/notifications-copy";
import type { BreakdownInput } from "@/lib/payment-breakdown";
import type { FirmPublic, InvoiceItemRow, InvoiceRow } from "@/lib/db/types";

export const INVOICE_COLUMNS =
  "id, firm_id, number, status, currency, subtotal_minor, vat_minor, total_minor, paid_minor, issued_at, due_at, matter_id, appointment_id";

export type ClientInvoice = Pick<
  InvoiceRow,
  | "id" | "firm_id" | "number" | "status" | "currency" | "subtotal_minor" | "vat_minor" | "total_minor" | "paid_minor"
  | "issued_at" | "due_at" | "matter_id" | "appointment_id"
>;

export type InvoiceLine = Pick<InvoiceItemRow, "description" | "quantity" | "unit_minor">;

/**
 * The statuses an invoice can still be paid in. The same list as startInvoicePayment()'s
 * (src/lib/actions/portal.ts), which refuses anything else: an allow-list, so a status added later
 * is not offered a pay button until someone decides it should be.
 */
export const PAYABLE_STATUSES: readonly string[] = ["issued", "partially_paid", "overdue"];

/** The consultation a booking's invoice is for: whether it is held, and whether it was cancelled. */
export interface InvoiceConsultation {
  id: string;
  status: string;
  hold_expires_at: string | null;
}

/**
 * What the invoice is for, in words the client recognises, and the consultation behind it, if any.
 *
 * A matter's invoice is for the matter, by its title. A consultation's reads as the consultation
 * page reads it: "Legal consultation with Ada Obi, Wednesday 4 November 2026 at 10:00 WAT", in the
 * zone it was booked in. Null when there is neither: invoiceBreakdownInput() then lets the
 * invoice's own lines say it.
 */
export async function invoiceContext(
  supabase: SupabaseClient,
  inv: Pick<ClientInvoice, "matter_id" | "appointment_id">,
): Promise<{ purpose: string | null; consultation: InvoiceConsultation | null }> {
  const [{ data: matterRow }, { data: appointmentRow }] = await Promise.all([
    inv.matter_id
      ? supabase.from("matters").select("title").eq("id", inv.matter_id).maybeSingle()
      : Promise.resolve({ data: null }),
    inv.appointment_id
      ? supabase
          .from("appointments")
          .select("id, status, hold_expires_at, starts_at, client_timezone, service_id, lawyer_id")
          .eq("id", inv.appointment_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const appt = appointmentRow as
    | (InvoiceConsultation & { starts_at: string; client_timezone: string | null; service_id: string | null; lawyer_id: string | null })
    | null;
  const consultation = appt ? { id: appt.id, status: appt.status, hold_expires_at: appt.hold_expires_at } : null;

  const title = (matterRow as { title: string | null } | null)?.title?.trim();
  if (title) return { purpose: title, consultation };
  if (!appt) return { purpose: null, consultation };

  const [{ data: service }, { data: lawyer }] = await Promise.all([
    appt.service_id ? supabase.from("services").select("name").eq("id", appt.service_id).maybeSingle() : Promise.resolve({ data: null }),
    appt.lawyer_id ? supabase.from("lawyer_public").select("full_name").eq("id", appt.lawyer_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const serviceName = (service as { name: string } | null)?.name ?? "Consultation";
  const lawyerName = (lawyer as { full_name: string | null } | null)?.full_name ?? null;
  const when = whenWords(appt.starts_at, appt.client_timezone ?? "Africa/Lagos");
  return { purpose: `${serviceName}${lawyerName ? ` with ${lawyerName}` : ""}${when ? `, ${when}` : ""}`, consultation };
}

/** Who issued an invoice, as invoice_issuer() gives it. Each part is null when the firm has not given it. */
export interface InvoiceIssuer {
  /** The name clients know the firm by. */
  name: string | null;
  legalName: string | null;
  rcNumber: string | null;
  /** Only on an invoice that charges VAT. */
  tin: string | null;
}

/**
 * Who issued the invoice, from invoice_issuer() (migration 59), or null when it was not needed.
 *
 * It gives two things firm_public cannot. The firm's TIN, which the view leaves out on purpose
 * (migration 51): the function gives it only to someone who may read the invoice, and only when
 * the invoice charges VAT. And the firm's name, registered name and RC/BN when the view has no row
 * for the firm, as once a firm is suspended: its client can still open the invoice, which must
 * still say who it is from.
 *
 * So it is asked only for one of those: an invoice that charges VAT, or a firm whose public row
 * came back empty. It takes the caller's firmById() promise rather than its answer, so that a VAT
 * invoice asks for both at once.
 *
 * A database that does not have the function yet, because the app was deployed before the
 * migration was applied, answers with an error. The invoice then opens as it did before, without
 * the TIN, and the error is reported: a VAT invoice without its TIN is a problem for the firm, not
 * one the client can do anything about.
 */
export async function invoiceIssuer(
  supabase: SupabaseClient,
  inv: Pick<ClientInvoice, "id" | "vat_minor">,
  firm: Promise<FirmPublic | null>,
): Promise<InvoiceIssuer | null> {
  if (!(Number(inv.vat_minor) > 0) && (await firm)) return null;
  const { data, error } = await supabase.rpc("invoice_issuer", { p_invoice: inv.id });
  if (error) {
    await captureException(new Error(`invoice_issuer: ${error.message}`), {
      where: "client invoice: who issued it",
      tags: { code: error.code || "none" },
      extra: { invoice: inv.id },
    });
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const row = data as { name?: unknown; legal_name?: unknown; rc_number?: unknown; tin?: unknown };
  const text = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);
  // Tidied as a TIN saved today is (src/lib/nigeria.ts), so one saved before that prints too.
  const tin = text(row.tin);
  return {
    name: text(row.name),
    legalName: text(row.legal_name),
    rcNumber: text(row.rc_number),
    tin: tin ? normaliseTin(tin) || null : null,
  };
}

/** The sentence a VAT invoice carries, worded as the firm's own invoice screen words it. */
export function vatTinSentence(tin: string): string {
  return `VAT charged under TIN ${tin}.`;
}

/**
 * The invoice as buildBreakdown() takes it: who is paid (the firm's legal name and RC number, from
 * its public row, or from invoice_issuer() when there is no public row), what for, and the figures
 * as the database has them.
 *
 * An invoice with no matter and no consultation is for what its lines say. Two or more lines are
 * listed in the register anyway; a single one is not (it would repeat the total), so its words
 * become the purpose instead, or the register would not say what the money is for.
 */
export function invoiceBreakdownInput(
  inv: ClientInvoice,
  items: InvoiceLine[],
  firm: FirmPublic | null,
  purpose: string | null,
  issuer?: InvoiceIssuer | null,
): BreakdownInput {
  return {
    currency: inv.currency,
    payee: firm
      ? { name: firm.name, legalName: firm.legal_name, rcNumber: firm.rc_number }
      : { name: issuer?.name ?? issuer?.legalName ?? "your firm", legalName: issuer?.legalName, rcNumber: issuer?.rcNumber },
    purpose: purpose ?? (items.length === 1 ? items[0].description : null),
    lines: items.map((i) => ({ description: i.description, quantity: Number(i.quantity), unitMinor: Number(i.unit_minor) })),
    subtotalMinor: Number(inv.subtotal_minor),
    vatMinor: Number(inv.vat_minor),
    vatRatePercent: firm?.vat_rate ?? null,
    totalMinor: Number(inv.total_minor),
    paidMinor: Number(inv.paid_minor),
    // No processingFeeMinor. The firm pays Paystack's fee today, and startInvoicePayment() charges
    // amountToCharge() with no fee, so a fee row here would be a figure nobody is charged.
  };
}
