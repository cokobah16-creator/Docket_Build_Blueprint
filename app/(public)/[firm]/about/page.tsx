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
        <div className="space-y-4 text-gray-700">
          <p>
            {firm.legal_name ?? firm.name} is a Nigerian law practice built around one idea:
            clients should always know where their matter stands.
          </p>
          <p>
            From your first consultation to the last court date, you get updates in plain
            language, on your phone, from the lawyers handling your case.
          </p>
        </div>
      )}
    </PageShell>
  );
}
