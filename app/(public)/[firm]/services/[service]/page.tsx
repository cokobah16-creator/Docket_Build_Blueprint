import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { firmBySlug } from "@/lib/tenant";
import { formatMoneyMinor, formatPriceWithVat, vatMinor } from "@/lib/money";
import { publishedPolicyText } from "@/lib/policy-text";
import { serviceBySlug } from "@/lib/public-data";
import { PageShell } from "../../_components/page-shell";

type Params = Promise<{ firm: string; service: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { firm: slug, service } = await params;
  const firm = await firmBySlug(slug);
  if (!firm) return {};
  const row = await serviceBySlug(firm.id, service);
  return row ? { title: `${row.name} · ${firm.name}`, description: row.description ?? undefined } : {};
}

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

  return (
    <PageShell title={row.name} intro={row.description ?? undefined}>
      <dl className="grid gap-4 rounded-card border border-hairline bg-raised p-5 sm:grid-cols-3">
        <div>
          <dt className="text-13 uppercase tracking-wide text-ink-muted">Fee</dt>
          <dd className="mt-1 font-medium text-ink">{formatPriceWithVat(row.price_minor, row.currency, vatRate)}</dd>
          {vat > 0 && (
            <dd className="mt-0.5 text-13 text-ink-muted">
              {formatMoneyMinor(row.price_minor, row.currency)} plus {formatMoneyMinor(vat, row.currency)} VAT at {vatRate}%
            </dd>
          )}
        </div>
        <div>
          <dt className="text-13 uppercase tracking-wide text-ink-muted">Duration</dt>
          <dd className="mt-1 font-medium text-ink">{row.duration_min} minutes</dd>
        </div>
        <div>
          <dt className="text-13 uppercase tracking-wide text-ink-muted">Format</dt>
          <dd className="mt-1 font-medium text-ink">
            {row.virtual_available ? "Virtual or in person" : "In person"}
          </dd>
        </div>
      </dl>
      {cancellationText ? <p className="mt-4 text-15 text-ink-muted">{cancellationText}</p> : null}
      <div className="mt-8">
        <Link
          href={`/${firm.slug}/book?service=${row.slug}`}
          className="inline-block rounded-lg bg-brand px-6 py-3.5 text-base font-medium text-brand-on hover:opacity-90"
        >
          Book this consultation
        </Link>
      </div>
    </PageShell>
  );
}
