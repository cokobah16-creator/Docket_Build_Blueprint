// What a client is about to pay, row by row, and the sentences that go with it.
//
// ONE BUILDER, SO THE FIGURE SHOWN IS THE FIGURE CHARGED. The booking review, the
// appointment's pay panel, the invoice page and both pay actions read the same
// numbers from here: `chargeMinor` is what the screen says the client pays and
// what the pay actions ask Paystack for. Two places working the total out on
// their own is how a screen ends up promising one amount while the checkout
// opens on another.
//
// ONLY ROWS THAT EXIST. A VAT line at ₦0, a "Paid ₦0" before anything has been
// paid, a processing fee nobody is charged: each is a row a client has to read
// and discard, and each makes them wonder what it is for. So a row appears only
// when it carries an amount (docs/VOICE.md, rule 7). A free consultation has no
// "₦0" anywhere: it says "Nothing to pay".
//
// WHO PAYS PAYSTACK'S FEE. Today the firm does: the adapter routes every charge to
// the firm's subaccount with bearer 'subaccount' (src/lib/providers/payments/
// paystack.ts), and nothing is added to the client's total. The owner decided on
// 2 November 2026 that a firm may pass the fee to its clients, as Attorneys
// Klinique does on its own app; that arrives with the offers work. When it does,
// a caller passes `processingFeeMinor` and the fee shows as its own row and its
// own sentence. Until then no caller passes it, and no screen shows a fee row.
//
// No React and no imports beyond money.ts, so it runs in a server component, a
// client component and a server action alike.

import { formatMoneyMinor, vatMinor } from "@/lib/money";

export interface BreakdownLine {
  description: string;
  /** numeric in the database; a fractional quantity is allowed. */
  quantity: number;
  unitMinor: number;
}

export interface BreakdownInput {
  currency: string;
  /** The firm being paid. `legalName` heads the register when it is set. */
  payee: { name: string; legalName?: string | null; rcNumber?: string | null };
  /**
   * What the money is for, in words a client recognises: "Legal consultation with
   * Ada Obi, Wednesday 4 November 2026 at 10:00 WAT", or a matter's title. Optional: the
   * booking review already lists the service, lawyer and time just above.
   */
  purpose?: string | null;
  lines: BreakdownLine[];
  subtotalMinor: number;
  vatMinor: number;
  /** The firm's rate, used only for the label, and only when it reproduces vatMinor. */
  vatRatePercent?: number | null;
  totalMinor: number;
  /** What has already been paid against this invoice. */
  paidMinor?: number;
  /** Paystack's fee when the client pays it. 0 or absent: the firm pays it. */
  processingFeeMinor?: number;
}

export type BreakdownRowKind = "line" | "subtotal" | "vat" | "total" | "paid" | "fee" | "due";

export interface BreakdownRow {
  kind: BreakdownRowKind;
  label: string;
  minor: number;
}

export interface Breakdown {
  currency: string;
  /** "Attorneys Klinique · BN 9868241" */
  payeeLine: string;
  /** The trading name, for sentences. */
  payeeName: string;
  purpose: string | null;
  rows: BreakdownRow[];
  /** The invoice total less what has been paid. Never below zero. */
  dueMinor: number;
  /** What Paystack is asked for: what is due, plus the fee when the client pays it. */
  chargeMinor: number;
  /** Nothing to pay at all: a free consultation. */
  free: boolean;
  /** Paid in full: a receipt, not a bill. */
  settled: boolean;
  /** Show kobo on every amount, because at least one of them has kobo. */
  exact: boolean;
  /** The sentence under the register: who is paid, how, and who pays the fee. */
  payeeSentence: string;
}

function lineMinor(line: BreakdownLine): number {
  // Postgres rounds numeric half away from zero; for the positive amounts an
  // invoice carries, Math.round is the same thing.
  return Math.round(line.unitMinor * Number(line.quantity));
}

function lineLabel(line: BreakdownLine): string {
  const q = Number(line.quantity);
  return q === 1 ? line.description : `${line.description} × ${q}`;
}

/** A name that opens a sentence: "Your firm", not "your firm", when a caller falls back to words. */
function sentenceStart(name: string): string {
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : name;
}

/** "7.5" for 7.50, "10" for 10.00: the rate as a person writes it. */
function rateWords(rate: number): string {
  return String(Math.round(rate * 100) / 100);
}

/**
 * What Paystack is asked for: what is still due on the invoice, plus the fee when
 * the client pays it. The pay actions call this with the invoice as the database
 * has it, and buildBreakdown() uses it for `chargeMinor`, so what the screen says
 * and what the checkout opens on cannot drift apart. Zero means nothing to charge.
 */
export function amountToCharge(input: {
  totalMinor: number;
  paidMinor?: number | null;
  processingFeeMinor?: number | null;
}): number {
  const due = Math.max(0, input.totalMinor - Math.max(0, input.paidMinor ?? 0));
  return due > 0 ? due + Math.max(0, input.processingFeeMinor ?? 0) : 0;
}

export function buildBreakdown(input: BreakdownInput): Breakdown {
  const paid = Math.max(0, input.paidMinor ?? 0);
  const fee = Math.max(0, input.processingFeeMinor ?? 0);
  const due = Math.max(0, input.totalMinor - paid);
  const charge = amountToCharge(input);
  const free = input.totalMinor <= 0;
  const settled = !free && due === 0;
  const vat = Math.max(0, input.vatMinor);

  const rows: BreakdownRow[] = [];

  // One line with nothing else around it is the total itself: listing it as a line
  // and again as the total says the same figure twice. Two or more lines, or one
  // line beside VAT, a payment or a fee, is a sum, and a sum shows its parts.
  const showLines = input.lines.length > 1 || vat > 0 || paid > 0 || fee > 0;
  if (showLines) {
    for (const line of input.lines) rows.push({ kind: "line", label: lineLabel(line), minor: lineMinor(line) });
  }
  if (input.lines.length > 1 && vat > 0) rows.push({ kind: "subtotal", label: "Subtotal", minor: input.subtotalMinor });
  if (vat > 0) {
    const rate = Number(input.vatRatePercent);
    // A label naming a rate must be the rate this VAT was worked out at. The rate on
    // file today may not be the rate the invoice was raised at (the invoice does not
    // store one), so the rate is named only when it reproduces the VAT on the invoice,
    // worked out exactly as the database works it out.
    const rateHolds = Number.isFinite(rate) && rate > 0 && vatMinor(input.subtotalMinor, rate) === vat;
    rows.push({ kind: "vat", label: rateHolds ? `VAT at ${rateWords(rate)}%` : "VAT", minor: vat });
  }
  if (!free) rows.push({ kind: "total", label: "Total", minor: input.totalMinor });
  if (paid > 0) rows.push({ kind: "paid", label: settled ? "Paid" : "Paid so far", minor: paid });
  if (fee > 0 && due > 0) rows.push({ kind: "fee", label: "Paystack processing fee", minor: fee });
  // What is still to pay, only when something is and it differs from the total above
  // it. A settled invoice has no "₦0 left" row: its last row is what was paid.
  if (due > 0 && (paid > 0 || fee > 0)) {
    rows.push({ kind: "due", label: fee > 0 ? "To pay now" : "Left to pay", minor: charge });
  }

  const amounts = [...rows.map((r) => r.minor), charge];
  const exact = input.currency === "NGN" && amounts.some((m) => m % 100 !== 0);

  const name = input.payee.name;
  const legal = input.payee.legalName?.trim() || name;
  const rc = input.payee.rcNumber?.trim();
  // The number as the firm typed it, which is normally with its letters, "BN 9868241". Bare digits
  // say nothing to a client about what they are, so they are labelled.
  const rcWords = rc && /^\d/.test(rc) ? `CAC registration ${rc}` : rc;
  const payeeLine = rcWords ? `${legal} · ${rcWords}` : legal;

  // The sentence carries no amount of its own. Every figure is in the rows above it, and the
  // invoice PDF prints this sentence with a font that cannot draw "₦" (src/lib/pdf.ts). "Nothing
  // is added" rather than "the total is what you pay", because on a part-paid invoice what the
  // client pays now is what is left, not the total.
  const lead = `You pay ${name} through Paystack, and the money goes straight to the firm's own account.`;
  const payeeSentence =
    fee > 0
      ? `${lead} Paystack's processing fee, shown above, goes to Paystack, not to ${name}. Docket never holds your money.`
      : `${lead} ${sentenceStart(name)} pays Paystack's processing fee, so nothing is added to what you pay. ` +
        `Docket never holds your money.`;

  return {
    currency: input.currency,
    payeeLine,
    payeeName: name,
    purpose: input.purpose?.trim() || null,
    rows,
    dueMinor: due,
    chargeMinor: charge,
    free,
    settled,
    exact,
    payeeSentence,
  };
}

/** One amount from a breakdown, formatted the way every other amount in it is. */
export function breakdownMoney(b: Pick<Breakdown, "currency" | "exact">, minor: number): string {
  return formatMoneyMinor(minor, b.currency, { exact: b.exact });
}

/**
 * The one-line sentence for paying by bank transfer, which is where people pay
 * twice: Paystack's account number is good for one payment only, and a transfer
 * can take minutes to confirm.
 */
export const BANK_TRANSFER_NOTE =
  "Paystack shows an account number that is for this payment only. Send the exact amount to it from your bank app. " +
  "It can take a few minutes to confirm. Please do not pay again while you wait, or you will be charged twice.";
