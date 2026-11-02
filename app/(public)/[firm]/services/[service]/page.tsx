import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { firmBySlug } from "@/lib/tenant";
import { formatMoneyMinor, vatMinor } from "@/lib/money";
import { publishedPolicyText } from "@/lib/policy-text";
import { serviceBySlug } from "@/lib/public-data";
import { buttonClasses } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { PageShell } from "../../_components/page-shell";
import { priceIncludingVat } from "../../_components/site-words";

type Params = Promise<{ firm: string; service: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { firm: slug, service } = await params;
  const firm = await firmBySlug(slug);
  if (!firm) return {};
  const row = await serviceBySlug(firm.id, service);
  return row ? { title: `${row.name} · ${firm.name}`, description: row.description ?? undefined } : {};
}

const TERM = "text-11 font-semibold uppercase tracking-[0.06em] text-ink-muted";

export default async function ServiceDetailPage({ params }: { params: Params }) {
  const { firm: slug, service } = await params;
  const firm = await firmBySlug(slug);
  if (!firm) notFound();
  const row = await serviceBySlug(firm.id, service);
  if (!row) notFound();
  // The price as the client will pay it: with the firm's VAT, as book_appointment() adds it.
  const vatRate = Number(firm.vat_rate) || 0;
  const vat = vatMinor(row.price_minor, vatRate);
  const cancellationText = publishedPolicyText(firm.policies.cancellation);
  // When the fee is paid, in the booking wizard's own terms: requires_prepayment defaults to true
  // in the database, so only an explicit false means the booking is made first and paid for later.
  const paidLater = row.requires_prepayment === false;

  return (
    <PageShell title={row.name} intro={row.description ?? undefined}>
      <dl className="grid gap-4 rounded-card border border-hairline bg-raised p-5 sm:grid-cols-3">
        <div>
          <dt className={TERM}>Fee</dt>
          <dd className="mt-1 font-medium text-ink">{priceIncludingVat(row.price_minor, row.currency, vatRate)}</dd>
          {vat > 0 && (
            <dd className="mt-0.5 text-13 text-ink-muted">
              {formatMoneyMinor(row.price_minor, row.currency)} plus {formatMoneyMinor(vat, row.currency)} VAT at {vatRate}%
            </dd>
          )}
        </div>
        <div>
          <dt className={TERM}>Duration</dt>
          <dd className="mt-1 font-medium text-ink">{row.duration_min} minutes</dd>
        </div>
        <div>
          <dt className={TERM}>How you meet</dt>
          {/* The booking wizard always offers a phone call and a meeting in person, and a video
              call only where the service allows it. */}
          <dd className="mt-1 font-medium text-ink">
            {row.virtual_available ? "Video call, phone call or in person" : "Phone call or in person"}
          </dd>
        </div>
      </dl>
      {row.price_minor > 0 && (
        <p className="mt-4 text-15 text-ink-muted">
          {/* Worded as the booking wizard's review step words it, so the two pages never disagree. */}
          {paidLater
            ? "You pay nothing when you book. Booking creates an invoice. You can pay it from Payments in your client portal."
            : "You pay online when you book."}
        </p>
      )}
      {cancellationText ? (
        <Disclosure summary="If plans change" className="mt-4">
          <p className="text-15 text-ink">{cancellationText}</p>
        </Disclosure>
      ) : null}
      {/* This page's filled button, so the header's turns quiet here (data-header-cta, layout.tsx). */}
      <div data-header-cta="quiet" className="mt-8">
        <Link href={`/${firm.slug}/book?service=${row.slug}`} className={buttonClasses("primary", "lg")}>
          Book this consultation
        </Link>
      </div>
    </PageShell>
  );
}
