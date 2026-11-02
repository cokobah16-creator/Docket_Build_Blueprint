// The invoice, or once it is paid the receipt, as a PDF the client can keep or pass on. Written by
// src/lib/pdf.ts (no third-party renderer), and read with the caller's own session, so RLS decides
// whether they may see it.
//
// THE PDF CANNOT DRAW "₦". Its two fonts carry WinAnsi only, so every amount here is written with
// formatMoneyPlain() ("NGN 50,000.00"): the one place a client reads "NGN" (docs/VOICE.md, rule 8).
// scripts/check-pdf.ts holds the writer to that in CI.
//
// The figures are the screen's. buildBreakdown() is given the same invoice row the invoice page
// gives it, and only the rows it returns are printed, so the paper has no "VAT 0.00" or "Paid 0.00"
// that the screen leaves out. Who is paid is the firm's legal name and RC number, as on the screen.

import { redirect } from "next/navigation";
import { loginPath } from "@/lib/auth-redirect-server";
import { supabaseServer } from "@/lib/supabase/server";
import { firmById } from "@/lib/tenant";
import { siteOrigin } from "@/lib/site";
import { formatMoneyPlain } from "@/lib/money";
import { buildBreakdown } from "@/lib/payment-breakdown";
import { clientStatusLabel } from "@/lib/client-words";
import { calendarDayWords, dayWords } from "@/lib/notifications-copy";
import { textPdf, PdfEncodingError, winAnsiBytes, type PdfLine } from "@/lib/pdf";
import {
  INVOICE_COLUMNS,
  PAYABLE_STATUSES,
  invoiceBreakdownInput,
  invoiceContext,
  type ClientInvoice,
  type InvoiceLine,
} from "../../invoice-data";

const TEXT_HEADERS = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" };

/** The status in words where clientStatusLabel() keeps the pill's own: "Paid", not "paid". */
const STATUS_WORDS: Record<string, string> = { paid: "Paid", overdue: "Overdue", cancelled: "Cancelled" };

/** Paystack by name, never the column's code. */
const PROVIDER_NAMES: Record<string, string> = { paystack: "Paystack", flutterwave: "Flutterwave" };

export async function GET(_request: Request, ctx: { params: Promise<{ invoice: string }> }) {
  const { invoice: id } = await ctx.params;
  const supabase = await supabaseServer();
  if (!supabase) {
    return new Response("This invoice cannot be opened right now. Please try again later.\n", { status: 503, headers: TEXT_HEADERS });
  }
  const { data: { user } } = await supabase.auth.getUser();
  // A link opened while signed out goes to sign-in and comes back here, as a page does.
  if (!user) redirect(await loginPath("client"));

  const { data } = await supabase.from("invoices").select(`${INVOICE_COLUMNS}, client_id`).eq("id", id).maybeSingle();
  const inv = (data ?? null) as (ClientInvoice & { client_id: string }) | null;
  if (!inv) return new Response("This invoice could not be found.\n", { status: 404, headers: TEXT_HEADERS });

  const [{ data: itemRows }, { data: paymentRows }, { data: profile }, firm, context, origin] = await Promise.all([
    supabase.from("invoice_items").select("description, quantity, unit_minor").eq("invoice_id", inv.id),
    // Only money that was added to the invoice. A payment that did not go through is not a payment
    // received, and the invoice page is where it is explained.
    supabase
      .from("payments")
      .select("provider, provider_ref, amount_minor, paid_at")
      .eq("invoice_id", inv.id)
      .eq("status", "succeeded")
      .order("paid_at", { ascending: true }),
    supabase.from("profiles").select("full_name, email, phone").eq("id", inv.client_id).maybeSingle(),
    firmById(inv.firm_id),
    invoiceContext(supabase, inv),
    siteOrigin(),
  ]);
  const items = (itemRows ?? []) as InvoiceLine[];
  const payments = (paymentRows ?? []) as Array<{ provider: string; provider_ref: string; amount_minor: number; paid_at: string | null }>;
  // Null when the caller cannot read the client's profile, such as someone acting for the client.
  const client = profile as { full_name: string | null; email: string | null; phone: string | null } | null;
  const b = buildBreakdown(invoiceBreakdownInput(inv, items, firm, context.purpose));
  const money = (minor: number) => formatMoneyPlain(minor, inv.currency);
  // The firm's document, so its dates are in the firm's zone. due_at is a calendar day, which no
  // zone may move to the day before.
  const firmZone = firm?.timezone ?? "Africa/Lagos";
  const firmWords = firm?.name ?? "your firm";
  const contact = firm?.brand?.contact ?? {};
  const appLink = `${origin}/app/payments/${inv.id}`;

  // As the invoice page decides them, so the paper and the screen agree on what this invoice is.
  const cancelled = inv.status === "cancelled" || inv.status === "void";
  const settled = !cancelled && (inv.status === "paid" || b.settled);
  const consultationCancelled = !settled && !cancelled && context.consultation?.status === "cancelled";
  const payable = !cancelled && !settled && !consultationCancelled && PAYABLE_STATUSES.includes(inv.status) && b.chargeMinor > 0;
  const status = clientStatusLabel(inv.status) ?? STATUS_WORDS[inv.status] ?? "";
  const letterhead = firm?.legal_name?.trim() || firm?.name || "";
  // Two lines on paper are help, not the invoice: what the money is for (the Items list below says
  // it too) and the sentence on how to pay. Both can carry free text the standard fonts cannot draw,
  // a matter title with "₦" in it or a lawyer named Adébáyọ̀, and textPdf() refuses the whole
  // document over one such character. So each is printed only when it can be, never altered.
  const printable = (text: string | null | undefined): text is string =>
    Boolean(text) && winAnsiBytes(text as string).unprintable.length === 0;
  const purposeLine = printable(b.purpose) ? b.purpose : null;
  const payeeSentence = printable(b.payeeSentence) ? b.payeeSentence : null;

  const lines: PdfLine[] = [
    ...(letterhead ? [{ text: letterhead, size: 18, bold: true }] : []),
    ...(contact.address ? [{ text: contact.address, size: 10 }] : []),
    ...(contact.email ? [{ text: contact.email, size: 10 }] : []),
    ...(contact.phone ? [{ text: contact.phone, size: 10 }] : []),
    { text: "", gap: 8 },
    { text: `${settled ? "RECEIPT" : "INVOICE"} ${inv.number}`, size: 14, bold: true },
    ...(status ? [{ text: `Status: ${status}`, size: 10 }] : []),
    ...(inv.issued_at ? [{ text: `Date: ${dayWords(inv.issued_at, firmZone)}`, size: 10 }] : []),
    // A consultation's invoice is due the day it is booked, which tells the reader nothing. A
    // matter's invoice has a real due date, and it matters only while there is something to pay.
    ...(payable && !inv.appointment_id && inv.due_at ? [{ text: `Due: ${calendarDayWords(inv.due_at)}`, size: 10 }] : []),
    { text: "", gap: 6 },
    ...(client && (client.full_name || client.email || client.phone)
      ? [
          { text: "Billed to", size: 11, bold: true },
          ...(client.full_name ? [{ text: client.full_name, size: 10 }] : []),
          ...(client.email ? [{ text: client.email, size: 10 }] : []),
          ...(client.phone ? [{ text: client.phone, size: 10 }] : []),
          { text: "", gap: 6 },
        ]
      : []),
    // Who is paid: the firm's legal name and its RC number, as "Before you pay" shows them.
    { text: settled ? "Paid to" : "Payable to", size: 11, bold: true },
    { text: b.payeeLine, size: 10, gap: 6 },
    ...(purposeLine ? [{ text: "For", size: 11, bold: true }, { text: purposeLine, size: 10, gap: 6 }] : []),
    // An invoice on paper names every line, even the single one the screen folds into its total.
    ...(items.length > 0
      ? [
          { text: "Items", size: 11, bold: true },
          ...items.map((it) => {
            const quantity = Number(it.quantity);
            return {
              text: `${it.description}${quantity !== 1 ? ` × ${quantity}` : ""}    ${money(Math.round(Number(it.unit_minor) * quantity))}`,
              size: 10,
            };
          }),
          { text: "", gap: 4 },
        ]
      : []),
    ...(b.free
      ? [{ text: "Nothing to pay", size: 11, bold: true }]
      : b.rows
          .filter((r) => r.kind !== "line")
          .map((r) => ({ text: `${r.label}    ${money(r.minor)}`, size: r.kind === "total" || r.kind === "due" ? 11 : 10, bold: r.kind === "total" || r.kind === "due" }))),
    { text: "", gap: 8 },
    ...(payments.length > 0
      ? [
          { text: "Payments received", size: 11, bold: true },
          ...payments.map((p) => ({
            text: [
              p.paid_at ? dayWords(p.paid_at, firmZone) : "",
              money(Number(p.amount_minor)),
              `${PROVIDER_NAMES[p.provider] ?? "Payment"} reference ${p.provider_ref}`,
            ].filter(Boolean).join("    "),
            size: 10,
          })),
          { text: "", gap: 8 },
        ]
      : []),
    // No fee is passed to the breakdown (invoice-data.ts), so this sentence carries no "₦".
    ...(payable && payeeSentence ? [{ text: payeeSentence, size: 9 }] : []),
    ...(payable ? [{ text: `To pay, open this invoice in the app: ${appLink}`, size: 9 }] : []),
    ...(cancelled ? [{ text: "This invoice was cancelled. It can no longer be paid.", size: 9 }] : []),
    ...(consultationCancelled ? [{ text: "The consultation this invoice is for was cancelled. It can no longer be paid.", size: 9 }] : []),
    ...(settled ? [{ text: "Thank you. This invoice is paid in full.", size: 9 }] : []),
  ];

  // textPdf refuses text the standard fonts cannot draw rather than printing "?" where a name was
  // (src/lib/pdf.ts). The reader is told which characters, that the invoice itself is fine, and
  // where to read it instead: a firm or a lawyer whose name carries a dot-below vowel would
  // otherwise hand its client a bare error.
  let bytes: ReturnType<typeof textPdf>;
  try {
    bytes = textPdf(lines);
  } catch (e) {
    if (e instanceof PdfEncodingError) {
      return new Response(
        `Some words on this invoice use characters the PDF cannot print: ${e.characters.join(" ")}\n\n` +
          `The invoice itself is unaffected. You can read it in the app at ${appLink}\n\n` +
          `If you need it as a PDF, message ${firmWords}.\n`,
        { status: 422, headers: TEXT_HEADERS },
      );
    }
    throw e;
  }
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${inv.number}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
