import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { firmBySlug } from "@/lib/tenant";
import { formatMoneyMinor } from "@/lib/services";
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

  return (
    <PageShell title={row.name} intro={row.description ?? undefined}>
      <dl className="grid gap-4 rounded-card border border-gray-200 bg-white p-5 sm:grid-cols-3">
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500">Fee</dt>
          <dd className="mt-1 font-medium text-gray-900">{formatMoneyMinor(row.price_minor, row.currency)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500">Duration</dt>
          <dd className="mt-1 font-medium text-gray-900">{row.duration_min} minutes</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500">Format</dt>
          <dd className="mt-1 font-medium text-gray-900">
            In person or by phone
          </dd>
        </div>
      </dl>
      {firm.policies.cancellation?.text ? (
        <p className="mt-4 text-sm text-gray-500">{String(firm.policies.cancellation.text)}</p>
      ) : null}
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
