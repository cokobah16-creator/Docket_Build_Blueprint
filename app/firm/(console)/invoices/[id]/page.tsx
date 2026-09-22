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

import { WorkspaceUnavailable } from "@/components/ui/unavailable";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requestedFirmId, staffContext } from "@/lib/firm-data";
import { siteOrigin } from "@/lib/site";
import { formatMoneyMinor } from "@/lib/money";
import { formatWhen } from "@/lib/time";
import { isE164, normalizeNigerianPhone } from "@/lib/nigeria";
import { cancelInvoice, issueInvoice } from "@/lib/actions/invoices";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusPill, type Status } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import type { InvoiceItemRow, InvoiceRow } from "@/lib/db/types";
import { CopyLink } from "../new/invoice-composer";

export const metadata = { title: "Invoice" };

const field = "mt-1 min-h-[44px] w-full rounded-lg border border-edge px-3 py-2 text-base text-ink focus:border-brand focus:outline focus:outline-2 focus:outline-brand";

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
      <WorkspaceUnavailable audience="staff" />
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
    <div className="space-y-5">
      <p className="text-15">
        <Link href={listHref} className="text-brand underline">← Invoices</Link>
      </p>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-21 font-bold tracking-[-0.02em] text-[#141414]">
            {isPaid ? "Receipt" : "Invoice"} {inv.number}
          </h1>
          <p className="text-15 text-ink-muted">
            {clientName} · {firmName}
            {matter ? " · " : ""}
            {matter && (
              <Link href={`/firm/matters/${matter.id}?tab=invoices`} className="text-brand underline">
                {matter.reference} · {matter.cause_title ?? matter.title}
              </Link>
            )}
            {!matter && inv.appointment_id ? " · consultation fee" : ""}
          </p>
        </div>
        <StatusPill status={inv.status as Status} />
      </header>

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

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title="What was billed" />
            <CardBody>
              {items.length === 0 ? (
                <p className="text-15 text-ink-muted">
                  No lines are recorded against this invoice. Its totals below are the ones the database holds.
                </p>
              ) : (
                <ul className="divide-y divide-hairline">
                  {items.map((item) => {
                    const quantity = Number(item.quantity);
                    const lineMinor = Math.round(Number(item.unit_minor) * quantity);
                    return (
                      <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-15 text-ink">{item.description}</p>
                          {quantity !== 1 && (
                            <p className="text-13 text-ink-muted">
                              {quantity} × {money(Number(item.unit_minor))}
                            </p>
                          )}
                        </div>
                        <p className="shrink-0 text-15 font-medium text-ink">{money(lineMinor)}</p>
                      </li>
                    );
                  })}
                </ul>
              )}

              <dl className="mt-4 space-y-2 border-t border-hairline pt-4 text-15">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-ink-muted">Subtotal</dt>
                  <dd className="text-ink">{money(Number(inv.subtotal_minor))}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-ink-muted">VAT</dt>
                  <dd className="text-ink">{money(Number(inv.vat_minor))}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="font-heading text-base font-semibold text-brand">Total</dt>
                  <dd className="font-heading text-base font-semibold text-brand">{money(Number(inv.total_minor))}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-ink-muted">Paid</dt>
                  <dd className="text-ink">{money(Number(inv.paid_minor))}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 border-t border-hairline pt-2">
                  <dt className={cn("font-medium", outstanding > 0 ? "text-amber-800" : "text-emerald-800")}>
                    {outstanding > 0 ? "Outstanding" : "Nothing outstanding"}
                  </dt>
                  <dd className={cn("font-semibold", outstanding > 0 ? "text-amber-800" : "text-emerald-800")}>
                    {money(outstanding)}
                  </dd>
                </div>
              </dl>

              {Number(inv.vat_minor) > 0 && firm?.tin && (
                <p className="mt-3 text-13 text-ink-muted">VAT charged under TIN {firm.tin}.</p>
              )}
              <p className="mt-3 text-13 text-ink-muted">
                Raised {formatWhen(inv.created_at, tz, { dateStyle: "medium", timeStyle: "short" })}
                {inv.issued_at ? ` · issued ${formatWhen(inv.issued_at, tz, { dateStyle: "medium", timeStyle: "short" })}` : " · not issued yet"}
                {inv.due_at ? ` · falls due ${dayLabel(inv.due_at)}` : " · no due date set"} · times in {tz}.
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Payments" />
            <CardBody>
              {payments.length === 0 ? (
                <div className="space-y-2">
                  <p className="text-15 text-ink">Nothing has been paid against this invoice yet.</p>
                  <p className="text-15 text-ink-muted">
                    {isDraft
                      ? "Issue it and the client can pay from their app; the payment is recorded here the moment the provider confirms it."
                      : isCancelled
                        ? "A cancelled invoice cannot be paid."
                        : "Send the client the link below. Payments are recorded here by the payment provider — never by hand — and the money settles into the firm's own account."}
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-hairline">
                  {payments.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-15 text-ink">
                          {formatMoneyMinor(Number(p.amount_minor), p.currency)} · {p.status.replace(/_/g, " ")}
                        </p>
                        <p className="break-all text-13 text-ink-muted">
                          {p.provider} · {p.provider_ref}
                        </p>
                      </div>
                      <p className="shrink-0 text-13 text-ink-muted">
                        {p.paid_at ? formatWhen(p.paid_at, tz, { dateStyle: "medium", timeStyle: "short" }) : "not settled"}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title={isPaid ? "The client's receipt" : "The client's pay link"} />
            <CardBody className="space-y-3">
              {isDraft ? (
                <p className="text-15 text-ink-muted">
                  The link works once the invoice is issued. Until then the client&rsquo;s app shows them nothing.
                </p>
              ) : isCancelled ? (
                <p className="text-15 text-ink-muted">
                  This invoice was cancelled, so the link only tells the client it can no longer be paid.
                </p>
              ) : (
                <>
                  <p className="text-15 text-ink-muted">
                    {isPaid
                      ? "This opens the receipt in the client's own app."
                      : `This signs ${clientName} in to their own app on this invoice. Anyone holding it can see the invoice, so send it only to the client.`}
                  </p>
                  <CopyLink value={payLink} label="Copy the link" />
                  <div className="flex flex-wrap gap-2">
                    {whatsappHref && (
                      <a
                        href={whatsappHref}
                        target="_blank"
                        rel="noreferrer"
                        className="flex min-h-[44px] items-center rounded-lg bg-brand px-4 text-15 font-medium text-brand-on hover:opacity-90"
                      >
                        Send on WhatsApp
                      </a>
                    )}
                    {mailHref && (
                      <a
                        href={mailHref}
                        className="flex min-h-[44px] items-center rounded-lg border border-edge px-4 text-15 font-medium text-brand hover:bg-hover"
                      >
                        Send by email
                      </a>
                    )}
                  </div>
                  {!whatsappHref && !mailHref && (
                    <p className="text-13 text-amber-800">
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
                className="flex min-h-[44px] items-center justify-center rounded-lg border border-edge px-4 text-15 font-medium text-brand hover:bg-hover"
              >
                Open the PDF {isPaid ? "receipt" : "invoice"}
              </a>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Billed to" />
            <CardBody>
              <dl className="space-y-2 text-15">
                <div>
                  <dt className="text-ink-muted">Client</dt>
                  <dd className="font-medium text-ink">
                    <Link href={`/firm/clients/${inv.client_id}${firmQuery}`} className="text-brand underline">
                      {clientName}
                    </Link>
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Phone</dt>
                  <dd className="font-medium text-ink">{client?.phone ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Email</dt>
                  <dd className="break-all font-medium text-ink">
                    {client?.email ?? <span className="text-amber-800">none on file — no receipt can be emailed</span>}
                  </dd>
                </div>
                {matter && (
                  <div>
                    <dt className="text-ink-muted">Matter</dt>
                    <dd className="font-medium text-ink">
                      <Link href={`/firm/matters/${matter.id}?tab=invoices`} className="text-brand underline">
                        {matter.reference} · {matter.title}
                      </Link>
                    </dd>
                  </div>
                )}
              </dl>
            </CardBody>
          </Card>

          {isDraft && (
            <Card>
              <CardHeader title="Issue it" />
              <CardBody className="space-y-3">
                <form action={issue} className="space-y-3">
                  <div>
                    <label htmlFor="dueOn" className="text-15 font-medium text-ink">Falls due on</label>
                    <p className="text-13 text-ink-muted">
                      Optional. {inv.due_at ? `Currently ${dayLabel(inv.due_at)}; leave it empty to keep that day.` : "Leave it empty for no due date."}
                    </p>
                    <input id="dueOn" name="dueOn" type="date" defaultValue="" className={field} />
                  </div>
                  <p className="text-15 text-ink-muted">
                    Issuing tells {clientName} straight away and lets them pay {money(Number(inv.total_minor))} from
                    their app.
                  </p>
                  <Button type="submit" size="lg">Issue the invoice</Button>
                </form>
              </CardBody>
            </Card>
          )}

          {!isCancelled && !isPaid && Number(inv.paid_minor) === 0 && (
            <Card>
              <CardHeader title="Cancel it" />
              <CardBody className="space-y-3">
                {inv.appointment_id ? (
                  <p className="text-15 text-ink-muted">
                    This is a consultation fee. Cancel the appointment instead and its invoice follows — the database
                    refuses to cancel it on its own.
                  </p>
                ) : isAdmin ? (
                  <form action={cancel} className="space-y-3">
                    <div>
                      <label htmlFor="reason" className="text-15 font-medium text-ink">
                        Why <span className="text-red-700">*</span>
                      </label>
                      <p className="text-13 text-ink-muted">Kept in the firm&rsquo;s audit trail. The client is not sent this.</p>
                      <textarea id="reason" name="reason" rows={3} required minLength={3} maxLength={500} className={field} />
                    </div>
                    <p className="text-15 text-ink-muted">
                      Once cancelled the client cannot pay it. A part-paid or paid invoice can never be cancelled —
                      raise a credit note instead.
                    </p>
                    <Button type="submit" variant="danger">Cancel this invoice</Button>
                  </form>
                ) : (
                  <p className="text-15 text-ink-muted">
                    An owner or an admin of {firm?.name ?? ctx.firmName} can cancel an unpaid invoice. The database
                    allows nobody else, so ask one of them.
                  </p>
                )}
              </CardBody>
            </Card>
          )}

          {owing && (
            <Card>
              <CardHeader title="Chase it" />
              <CardBody className="space-y-2">
                <p className="text-15 text-ink">
                  {money(outstanding)} is still owed
                  {inv.due_at ? `, due ${dayLabel(inv.due_at)}` : ""}.
                </p>
                <p className="text-15 text-ink-muted">
                  Send the link above again, or open the matter and message the client on the file so the exchange is
                  kept with it.
                </p>
                {matter && (
                  <Link
                    href={`/firm/matters/${matter.id}?tab=messages`}
                    className="flex min-h-[44px] items-center justify-center rounded-lg border border-edge px-4 text-15 font-medium text-brand hover:bg-hover"
                  >
                    Message the client on the matter
                  </Link>
                )}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
