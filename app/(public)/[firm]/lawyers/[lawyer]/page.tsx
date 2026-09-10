import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { firmBySlug } from "@/lib/tenant";
import { lawyerBySlug, lawyerDisplayName } from "@/lib/public-data";
import { PageShell } from "../../_components/page-shell";

type Params = Promise<{ firm: string; lawyer: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { firm: slug, lawyer } = await params;
  const firm = await firmBySlug(slug);
  if (!firm) return {};
  const row = await lawyerBySlug(firm.id, lawyer);
  return row ? { title: `${lawyerDisplayName(row, firm.name)} · ${firm.name}`, description: row.bio ?? undefined } : {};
}

export default async function LawyerProfilePage({ params }: { params: Params }) {
  const { firm: slug, lawyer } = await params;
  const firm = await firmBySlug(slug);
  if (!firm) notFound();
  const row = await lawyerBySlug(firm.id, lawyer);
  if (!row) notFound();

  return (
    <PageShell title={lawyerDisplayName(row, firm.name)} intro={row.title ?? undefined}>
      {row.practice_areas.length > 0 && (
        <p className="text-sm text-gray-500">{row.practice_areas.join(" · ")}</p>
      )}
      {row.bio && <p className="mt-4 whitespace-pre-line text-gray-700">{row.bio}</p>}
      <div className="mt-8">
        <Link
          href={`/${firm.slug}/book?lawyer=${row.id}`}
          className="inline-block rounded-lg bg-brand px-6 py-3.5 text-base font-medium text-brand-on hover:opacity-90"
        >
          Book a consultation
        </Link>
      </div>
    </PageShell>
  );
}
