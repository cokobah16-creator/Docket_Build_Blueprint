import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { firmBySlug } from "@/lib/tenant";
import { lawyerBySlug, lawyerDisplayName } from "@/lib/public-data";
import { buttonClasses } from "@/components/ui/button";
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
  const name = lawyerDisplayName(row, firm.name);

  return (
    <PageShell title={name} intro={row.title ?? undefined}>
      {row.practice_areas.length > 0 && (
        <p className="text-15 text-ink-muted">{row.practice_areas.join(" · ")}</p>
      )}
      {row.bio && <p className="mt-4 whitespace-pre-line text-ink">{row.bio}</p>}
      {/* This page's filled button, so the header's turns quiet here (data-header-cta, layout.tsx). */}
      <div data-header-cta="quiet" className="mt-8">
        {/* Names the lawyer only when there is a name: a profile with none yet reads
            "{firm} lawyer", which is not a person to book. */}
        <Link href={`/${firm.slug}/book?lawyer=${row.id}`} className={buttonClasses("primary", "lg")}>
          {row.full_name ? `Book a consultation with ${row.full_name}` : "Book a consultation"}
        </Link>
      </div>
    </PageShell>
  );
}
