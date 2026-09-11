// One invoice: what was billed, what VAT was added, what has been paid and what
// is still owed — with the link that takes the client straight to paying it, the
// payments recorded against it, and the two acts a staff member can perform on
// it: issuing a draft, and cancelling an unpaid one.
//
// Rules enforced here:
//  · The database is the authorization layer. The invoice is readable only
//    because RLS lets a member of the firm that raised it read it; issue_invoice()
//    checks staff_w and cancel_invoice() checks admin_w, so this screen offers
//    "Cancel" to an owner or admin and the database refuses everyone else. No
//    service key is used anywhere, and refusals are shown word for word.
//  · Money is integer minor units, rendered with formatMoneyMinor in the
//    invoice's own currency — a receipt must read correctly in naira and in
//    dollars alike, so there is no hard-coded currency sign on this screen.
//  · Timestamps are UTC in the database and rendered in ctx.timezone;
//    invoices.due_at is a calendar day and is rendered as the day it is.
//  · Nothing is firm-specific: the firm and its VAT registration come from the
//    record, and a staff member who belongs to more than one firm reads this
//    invoice in the firm that raised it.
//  · No dead ends: an invoice with nothing paid says what happens next.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requestedFirmId, staffContext } from "@/lib/firm-data";
import { siteOrigin } from "@/lib/site";
import { formatMoneyMinor } from "@/lib/money";
import { formatWhen } from "@/lib/time";
import { isE164, normalizeNigerianPhone } from "@/lib/nigeria";
import { cancelInvoice, issueInvoice } from "@/lib/actions/invoices";
import { Alert } from "@/components/ui/alert";
import {
  AppButton,
  AppCard,
  AppCardBody,
  AppCardHeader,
  AppDetail,
  AppStatusPill,
  Footnote,
  SubHeader,
  SubHeaderRef,
  appButtonClass,
} from "@/components/app";
import { DocumentIcon, MailIcon } from "@/components/ui/icons";
import { type Status } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import type { InvoiceItemRow, InvoiceRow } from "@/lib/db/types";
import { CopyLink } from "../new/invoice-composer";

export const metadata = { title: "Invoice" };

// The console's own field: neutral edge, 44px of thumb, and a focus ring in the
// shell's ink rather than any firm's colour.
const field =
  "mt-1.5 min-h-[44px] w-full rounded-[9px] border border-dk-field bg-white px-3 py-[11px] text-[14px] text-dk-strong placeholder:text-dk-muted focus:border-dk-pri focus:outline-none";
const labelClass = "text-[13px] font-semibold text-dk-strong";
const hintClass = "mt-0.5 text-[11.5px] leading-snug text-dk-muted";
/** Required is said in words, never in a colour: colour here means late or unpaid. */
const requiredMark = <span className="font-normal text-dk-muted">(required)</span>;
const prose = "text-[12.5px] leading-[1.55] text-dk-soft";

const OWING = new Set(["issued", "partially_paid", "overdue"]);

interface PaymentRow {
  id: string;
  provider: string;
  provider_ref: string;
  status: string;
  amount_minor: number;
  currency: string;
  paid_at: string | null;
}

/** A date column is a calendar day, not an instant: render it as the day it is. */
function dayLabel(ymd: string): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`));
}

export default async function FirmInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ firm?: string; error?: string; issued?: string; cancelled?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await staffContext(await requestedFirmId({ firm: sp.firm }));

  if (!ctx) {
    return (
      <Alert kind="warning" title="Not configured">
        Supabase environment variables are not set, or this account is not a member of a firm.
        See <code>.env.example</code>, or ask a firm owner to add you.
      </Alert>
    );
  }

  const { supabase, timezone: tz } = ctx;

  const { data } = await supabase
    .from("invoices")
    .select("id, firm_id, number, client_id, matter_id, appointment_id, currency, subtotal_minor, vat_minor, total_minor, paid_minor, status, issued_at, due_at, created_at")
    .eq("id", id)
    .maybeSingle();
  const inv = (data ?? null) as InvoiceRow | null;
  if (!inv) notFound();

  // A member of more than one firm reads this invoice in the firm that raised it.
  const membership = ctx.memberships.find((m) => m.firm_id === inv.firm_id);
  if (!membership) notFound();
  const isAdmin = membership.role === "owner" || membership.role === "admin";

  const [{ data: itemRows }, { data: paymentRows }, { data: clientRow }, { data: matterRow }, { data: firmRow }, origin] =
    await Promise.all([
      supabase.from("invoice_items").select("id, invoice_id, description, quantity, unit_minor").eq("invoice_id", inv.id),
      supabase
        .from("payments")
        .select("id, provider, provider_ref, status, amount_minor, currency, paid_at")
        .eq("invoice_id", inv.id)
        .order("paid_at", { ascending: false }),
      supabase.from("profiles").select("full_name, company_name, phone, email").eq("id", inv.client_id).maybeSingle(),
      inv.matter_id
        ? supabase.from("matters").select("id, reference, title, cause_title").eq("id", inv.matter_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from("firms").select("name, legal_name, tin").eq("id", inv.firm_id).maybeSingle(),
      siteOrigin(),
    ]);

  const items = (itemRows ?? []) as InvoiceItemRow[];
  const payments = (paymentRows ?? []) as PaymentRow[];
  const client = (clientRow ?? null) as { full_name: string | null; company_name: string | null; phone: string | null; email: string | null } | null;
  const matter = (matterRow ?? null) as { id: string; reference: string; title: string; cause_title: string | null } | null;
  const firm = (firmRow ?? null) as { name: string; legal_name: string | null; tin: string | null } | null;

  const clientName = client?.full_name?.trim() || client?.company_name?.trim() || "Client";
  const firmName = firm?.legal_name?.trim() || firm?.name?.trim() || ctx.firmName;
  const money = (minor: number) => formatMoneyMinor(minor, inv.currency);
  const outstanding = Math.max(0, Number(inv.total_minor) - Number(inv.paid_minor));
  const owing = OWING.has(inv.status) && outstanding > 0;
  const isDraft = inv.status === "draft";
  const isCancelled = inv.status === "cancelled";
  const isPaid = inv.status === "paid";
  const payLink = `${origin}/app/payments/${inv.id}`;

  // Raw for params.set(), which encodes for itself; encoded where it is written
  // into an href by hand.
  const firmParam = sp.firm ?? "";
  const firmQuery = firmParam ? `?firm=${encodeURIComponent(firmParam)}` : "";
  const invoiceId = inv.id;
  const listHref = `/firm/invoices${firmQuery}`;

  /** Draft → issued: the moment the invoice reaches the client and they are told. */
  const issue = async (formData: FormData) => {
    "use server";
    const dueOn = String(formData.get("dueOn") ?? "").trim();
    const outcome = await issueInvoice(invoiceId, dueOn || null);
    const params = new URLSearchParams();
    if (firmParam) params.set("firm", firmParam);
    if (outcome?.error) params.set("error", outcome.error);
    else params.set("issued", "1");
    redirect(`/firm/invoices/${invoiceId}?${params.toString()}`);
  };

  /** Cancelling is an owner's or admin's act, and the reason is kept in the audit trail. */
  const cancel = async (formData: FormData) => {
    "use server";
    const reason = String(formData.get("reason") ?? "").trim();
    const outcome = await cancelInvoice(invoiceId, reason);
    const params = new URLSearchParams();
    if (firmParam) params.set("firm", firmParam);
    if (outcome?.error) params.set("error", outcome.error);
    else params.set("cancelled", "1");
    redirect(`/firm/invoices/${invoiceId}?${params.toString()}`);
  };

  // A diaspora client's number is not Nigerian: the normaliser declines it, so an
  // already-E.164 number is used as it stands rather than losing the link.
  const rawPhone = client?.phone?.trim() ?? "";
  const phone = rawPhone ? normalizeNigerianPhone(rawPhone) ?? (isE164(rawPhone) ? rawPhone : null) : null;
  const whatsappMessage =
    `Good day ${clientName}. ${firmName} has sent you invoice ${inv.number} for ${money(outstanding > 0 ? outstanding : Number(inv.total_minor))}` +
    `${inv.due_at ? `, due ${dayLabel(inv.due_at)}` : ""}. You can read it and pay it here: ${payLink}`;
  const whatsappHref = phone ? `https://wa.me/${phone.replace(/^\+/, "")}?text=${encodeURIComponent(whatsappMessage)}` : null;
  const mailHref = client?.email
    ? `mailto:${encodeURIComponent(client.email)}?subject=${encodeURIComponent(`Invoice ${inv.number} from ${firmName}`)}&body=${encodeURIComponent(whatsappMessage)}`
    : null;

  return (
    // The console layout's <main> owns the page gutter, so the sub-header
    // reclaims it to run edge to edge and the body below puts it back.
    <div className="dk-rise -mx-4 -mt-3.5 md:mx-0 md:mt-0">
      <SubHeader backHref={listHref} backLabel="Back to invoices">
        <div className="flex min-w-0 flex-1 items-center justify-between gap-2.5">
          <SubHeaderRef>{inv.number}</SubHeaderRef>
          <AppStatusPill status={inv.status as Status} />
        </div>
      </SubHeader>

      <div className="flex flex-col gap-3.5 px-4 pt-3.5 md:px-0">
        <header>
          <h1 className="font-app-head text-[20px] font-bold leading-[1.25] tracking-[-0.02em] text-dk-strong">
            {isPaid ? "Receipt" : "Invoice"} {inv.number}
          </h1>
          <p className="mt-1 text-[12.5px] leading-snug text-dk-soft">
            {clientName} · {firmName}
            {matter ? " · " : ""}
            {matter && (
              <Link href={`/firm/matters/${matter.id}?tab=invoices`} className="text-dk-pri underline underline-offset-2">
                {matter.reference} · {matter.cause_title ?? matter.title}
              </Link>
            )}
            {!matter && inv.appointment_id ? " · consultation fee" : ""}
          </p>
        </header>

        {/* The figure the screen exists for. What is still owed leads when
            anything is owed; otherwise the total does, and each is named. */}
        <AppCard>
          <AppCardBody className="flex flex-col gap-1">
            <p className="text-[12px] uppercase tracking-[0.07em] text-dk-muted">
              {owing ? "Still outstanding" : isPaid ? "Paid in full" : "Invoice total"}
            </p>
            <p
              className={cn(
                "font-app-head text-[34px] font-semibold leading-[1.1] tracking-[-0.02em]",
                owing ? "text-[#92400E]" : "text-dk-strong",
              )}
            >
              {money(owing ? outstanding : Number(inv.total_minor))}
            </p>
            <p className="mt-0.5 text-[12.5px] leading-[1.5] text-dk-soft">
              {owing ? `of ${money(Number(inv.total_minor))} billed` : `${money(Number(inv.total_minor))} billed`}
              {inv.due_at ? ` · falls due ${dayLabel(inv.due_at)}` : " · no due date"}
            </p>
          </AppCardBody>
        </AppCard>

        {sp.error && <Alert kind="error" title="The database refused this">{sp.error}</Alert>}
        {sp.issued && <Alert kind="success">Issued. {clientName} has been told and can pay from their app.</Alert>}
        {sp.cancelled && <Alert kind="success">Cancelled. It no longer appears as money owed, and the client cannot pay it.</Alert>}

        {isDraft && (
          <Alert kind="warning" title="This is still a draft">
            Nobody outside the firm can see it. Issue it below and {clientName} is notified at once.
          </Alert>
        )}
        {isCancelled && (
          <Alert kind="info" title="This invoice was cancelled">
            It is kept for the firm&rsquo;s records and counts as nothing owed. Raise a fresh invoice if the work is
            still to be billed.
          </Alert>
        )}

        <div className="grid gap-3.5 lg:grid-cols-3">
          <div className="flex flex-col gap-3.5 lg:col-span-2">
            <AppCard>
              <AppCardHeader title="What was billed" />
              <AppCardBody className="flex flex-col gap-3">
                {items.length === 0 ? (
                  <p className={prose}>
                    No lines are recorded against this invoice. Its totals below are the ones the database holds.
                  </p>
                ) : (
                  items.map((item) => {
                    const quantity = Number(item.quantity);
                    const lineMinor = Math.round(Number(item.unit_minor) * quantity);
                    return (
                      <div key={item.id} className="flex justify-between gap-4 text-[13.5px]">
                        <span className="min-w-0 leading-[1.4] text-dk-body">
                          {item.description}
                          {quantity !== 1 && (
                            <span className="mt-0.5 block text-[11.5px] text-dk-muted">
                              {quantity} × {money(Number(item.unit_minor))}
                            </span>
                          )}
                        </span>
                        <span className="flex-none font-semibold text-dk-strong">{money(lineMinor)}</span>
                      </div>
                    );
                  })
                )}
              </AppCardBody>

              <div className="flex flex-col gap-3 border-t border-dk-rule px-[17px] py-[15px]">
                <AppDetail label="Subtotal">{money(Number(inv.subtotal_minor))}</AppDetail>
                <AppDetail label="VAT">{money(Number(inv.vat_minor))}</AppDetail>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-[13px] font-semibold text-dk-soft">Total</span>
                  <span className="font-app-head text-[20px] font-bold leading-none text-dk-strong">
                    {money(Number(inv.total_minor))}
                  </span>
                </div>
                <AppDetail label="Paid">{money(Number(inv.paid_minor))}</AppDetail>
                {/* Outstanding carries the console's amber, and says "outstanding"
                    in words, so the colour is never the only signal. */}
                <div className="flex items-baseline justify-between gap-4 border-t border-dk-rule pt-3">
                  <span className={cn("text-[13px] font-semibold", outstanding > 0 ? "text-[#92400E]" : "text-dk-soft")}>
                    {outstanding > 0 ? "Outstanding" : "Nothing outstanding"}
                  </span>
                  <span
                    className={cn(
                      "font-app-head text-[20px] font-bold leading-none",
                      outstanding > 0 ? "text-[#92400E]" : "text-dk-strong",
                    )}
                  >
                    {money(outstanding)}
                  </span>
                </div>
              </div>

              <div className="border-t border-dk-rule px-[17px] py-[13px]">
                {Number(inv.vat_minor) > 0 && firm?.tin && (
                  <Footnote>VAT charged under TIN {firm.tin}.</Footnote>
                )}
                <Footnote className={Number(inv.vat_minor) > 0 && firm?.tin ? "mt-1" : undefined}>
                  Raised {formatWhen(inv.created_at, tz, { dateStyle: "medium", timeStyle: "short" })}
                  {inv.issued_at ? ` · issued ${formatWhen(inv.issued_at, tz, { dateStyle: "medium", timeStyle: "short" })}` : " · not issued yet"}
                  {inv.due_at ? ` · falls due ${dayLabel(inv.due_at)}` : " · no due date set"} · times in {tz}.
                </Footnote>
              </div>
            </AppCard>

            <AppCard>
              <AppCardHeader title="Payments" />
              <AppCardBody className="flex flex-col gap-3">
                {payments.length === 0 ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-[13.5px] font-semibold text-dk-strong">Nothing has been paid against this invoice yet.</p>
                    <p className={prose}>
                      {isDraft
                        ? "Issue it and the client can pay from their app; the payment is recorded here the moment the provider confirms it."
                        : isCancelled
                          ? "A cancelled invoice cannot be paid."
                          : "Send the client the link below. Payments are recorded here by the payment provider — never by hand — and the money settles into the firm's own account."}
                    </p>
                  </div>
                ) : (
                  payments.map((p) => (
                    <div key={p.id} className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-semibold leading-[1.35] text-dk-strong">
                          {formatMoneyMinor(Number(p.amount_minor), p.currency)} · {p.status.replace(/_/g, " ")}
                        </p>
                        {/* The provider's own reference: the thing a reconciliation
                            is done against, so it stays monospaced and unabridged. */}
                        <p className="mt-[3px] break-all font-mono text-[11.5px] leading-[1.45] text-dk-soft">
                          {p.provider} · {p.provider_ref}
                        </p>
                      </div>
                      <p className="flex-none text-right text-[11.5px] leading-[1.45] text-dk-soft">
                        {p.paid_at ? formatWhen(p.paid_at, tz, { dateStyle: "medium", timeStyle: "short" }) : "not settled"}
                      </p>
                    </div>
                  ))
                )}
              </AppCardBody>
            </AppCard>
          </div>

          <div className="flex flex-col gap-3.5">
            <AppCard>
              <AppCardHeader title={isPaid ? "The client's receipt" : "The client's pay link"} />
              <AppCardBody className="flex flex-col gap-3">
                {isDraft ? (
                  <p className={prose}>
                    The link works once the invoice is issued. Until then the client&rsquo;s app shows them nothing.
                  </p>
                ) : isCancelled ? (
                  <p className={prose}>
                    This invoice was cancelled, so the link only tells the client it can no longer be paid.
                  </p>
                ) : (
                  <>
                    <p className={prose}>
                      {isPaid
                        ? "This opens the receipt in the client's own app."
                        : `This signs ${clientName} in to their own app on this invoice. Anyone holding it can see the invoice, so send it only to the client.`}
                    </p>
                    <CopyLink value={payLink} label="Copy the link" />
                    <div className="flex flex-wrap gap-2">
                      {whatsappHref && (
                        <a href={whatsappHref} target="_blank" rel="noreferrer" className={appButtonClass("primary-sm")}>
                          Send on WhatsApp
                        </a>
                      )}
                      {mailHref && (
                        <a href={mailHref} className={appButtonClass("ghost-sm")}>
                          <MailIcon size={15} />
                          Send by email
                        </a>
                      )}
                    </div>
                    {!whatsappHref && !mailHref && (
                      <p className="text-[11.5px] font-semibold leading-snug text-[#92400E]">
                        {clientName} has neither a phone number nor an email address on file, so copy the link and send
                        it however they prefer.
                      </p>
                    )}
                  </>
                )}
                <a
                  href={`/app/payments/${inv.id}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className={appButtonClass("ghost", "w-full flex-none")}
                >
                  <DocumentIcon size={16} />
                  Open the PDF {isPaid ? "receipt" : "invoice"}
                </a>
              </AppCardBody>
            </AppCard>

            <AppCard>
              <AppCardHeader title="Billed to" />
              <AppCardBody className="flex flex-col gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.06em] text-dk-muted">Client</p>
                  <p className="mt-0.5 text-[13.5px] font-semibold text-dk-strong">
                    <Link href={`/firm/clients/${inv.client_id}${firmQuery}`} className="text-dk-pri underline underline-offset-2">
                      {clientName}
                    </Link>
                  </p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.06em] text-dk-muted">Phone</p>
                  <p className="mt-0.5 text-[13.5px] font-semibold text-dk-strong">{client?.phone ?? "—"}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.06em] text-dk-muted">Email</p>
                  <p className="mt-0.5 break-all text-[13.5px] font-semibold text-dk-strong">
                    {client?.email ?? (
                      <span className="text-[#92400E]">none on file &mdash; no receipt can be emailed</span>
                    )}
                  </p>
                </div>
                {matter && (
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.06em] text-dk-muted">Matter</p>
                    <p className="mt-0.5 text-[13.5px] font-semibold text-dk-strong">
                      <Link href={`/firm/matters/${matter.id}?tab=invoices`} className="text-dk-pri underline underline-offset-2">
                        {matter.reference} · {matter.title}
                      </Link>
                    </p>
                  </div>
                )}
              </AppCardBody>
            </AppCard>

            {isDraft && (
              <AppCard>
                <AppCardHeader title="Issue it" />
                <AppCardBody>
                  <form action={issue} className="flex flex-col gap-3">
                    <div>
                      <label htmlFor="dueOn" className={labelClass}>Falls due on</label>
                      <p className={hintClass}>
                        Optional. {inv.due_at ? `Currently ${dayLabel(inv.due_at)}; leave it empty to keep that day.` : "Leave it empty for no due date."}
                      </p>
                      <input id="dueOn" name="dueOn" type="date" defaultValue="" className={field} />
                    </div>
                    <p className={prose}>
                      Issuing tells {clientName} straight away and lets them pay {money(Number(inv.total_minor))} from
                      their app.
                    </p>
                    <AppButton type="submit" variant="primary">Issue the invoice</AppButton>
                  </form>
                </AppCardBody>
              </AppCard>
            )}

            {!isCancelled && !isPaid && Number(inv.paid_minor) === 0 && (
              <AppCard>
                <AppCardHeader title="Cancel it" />
                <AppCardBody>
                  {inv.appointment_id ? (
                    <p className={prose}>
                      This is a consultation fee. Cancel the appointment instead and its invoice follows &mdash; the database
                      refuses to cancel it on its own.
                    </p>
                  ) : isAdmin ? (
                    <form action={cancel} className="flex flex-col gap-3">
                      <div>
                        <label htmlFor="reason" className={labelClass}>
                          Why {requiredMark}
                        </label>
                        <p className={hintClass}>Kept in the firm&rsquo;s audit trail. The client is not sent this.</p>
                        <textarea id="reason" name="reason" rows={3} required minLength={3} maxLength={500} className={field} />
                      </div>
                      <p className={prose}>
                        Once cancelled the client cannot pay it. A part-paid or paid invoice can never be cancelled &mdash;
                        raise a credit note instead.
                      </p>
                      {/* Neutral, not red: in this console red means late or unpaid,
                          and the button already says what it does. */}
                      <AppButton type="submit" variant="ghost" className="w-full">Cancel this invoice</AppButton>
                    </form>
                  ) : (
                    <p className={prose}>
                      An owner or an admin of {firm?.name ?? ctx.firmName} can cancel an unpaid invoice. The database
                      allows nobody else, so ask one of them.
                    </p>
                  )}
                </AppCardBody>
              </AppCard>
            )}

            {owing && (
              <AppCard>
                <AppCardHeader title="Chase it" />
                <AppCardBody className="flex flex-col gap-2.5">
                  <p className="text-[13.5px] font-semibold leading-[1.4] text-[#92400E]">
                    {money(outstanding)} is still owed
                    {inv.due_at ? `, due ${dayLabel(inv.due_at)}` : ""}.
                  </p>
                  <p className={prose}>
                    Send the link above again, or open the matter and message the client on the file so the exchange is
                    kept with it.
                  </p>
                  {matter && (
                    <Link href={`/firm/matters/${matter.id}?tab=messages`} className={appButtonClass("ghost", "w-full flex-none")}>
                      Message the client on the matter
                    </Link>
                  )}
                </AppCardBody>
              </AppCard>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
