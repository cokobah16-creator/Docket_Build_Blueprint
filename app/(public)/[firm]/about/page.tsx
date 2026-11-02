import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { firmBySlug } from "@/lib/tenant";
import { publishedContent } from "@/lib/public-data";
import { buttonClasses } from "@/components/ui/button";
import { ContentBody, PageShell } from "../_components/page-shell";
import { ctaLabel } from "../_components/site-words";

export async function generateMetadata({ params }: { params: Promise<{ firm: string }> }): Promise<Metadata> {
  const { firm: slug } = await params;
  const firm = await firmBySlug(slug);
  return firm ? { title: `About · ${firm.name}`, description: firm.brand.tagline ?? undefined } : {};
}

export default async function AboutPage({ params }: { params: Promise<{ firm: string }> }) {
  const { firm: slug } = await params;
  const firm = await firmBySlug(slug);
  if (!firm) notFound();
  const page = await publishedContent(firm.id, "page", "about");

  return (
    <PageShell title={page?.title ?? `About ${firm.name}`} intro={firm.brand.tagline ?? undefined}>
      {page?.body ? (
        <ContentBody body={page.body} />
      ) : (
        <div className="space-y-4 text-ink">
          <p>
            {firm.name} has not written this page yet. You can still see its services and lawyers, and book
            a consultation online.
          </p>
        </div>
      )}
      {/* The one thing a visitor who has read about the firm can do next. It is this page's
          filled button, so the header's turns quiet here (data-header-cta, layout.tsx). */}
      <div data-header-cta="quiet" className="mt-8">
        <Link href={`/${firm.slug}/book`} className={buttonClasses("primary", "lg")}>
          {ctaLabel(firm.brand)}
        </Link>
      </div>
    </PageShell>
  );
}
