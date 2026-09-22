import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { firmBySlug } from "@/lib/tenant";
import { publishedContent } from "@/lib/public-data";
import { ContentBody, PageShell } from "../_components/page-shell";

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
            {firm.legal_name ?? firm.name} has not published an About page yet. Its services, its lawyers
            and their consultation times are listed on this site, and you can book a consultation online.
          </p>
        </div>
      )}
    </PageShell>
  );
}
