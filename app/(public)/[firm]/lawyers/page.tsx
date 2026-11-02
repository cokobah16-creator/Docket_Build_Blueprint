import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { firmBySlug } from "@/lib/tenant";
import { lawyerDisplayName, publicLawyers } from "@/lib/public-data";
import { Card, CardBody, EmptyState } from "@/components/ui/card";
import { PageShell } from "../_components/page-shell";

export async function generateMetadata({ params }: { params: Promise<{ firm: string }> }): Promise<Metadata> {
  const { firm: slug } = await params;
  const firm = await firmBySlug(slug);
  return firm ? { title: `Lawyers · ${firm.name}` } : {};
}

export default async function LawyersPage({ params }: { params: Promise<{ firm: string }> }) {
  const { firm: slug } = await params;
  const firm = await firmBySlug(slug);
  if (!firm) notFound();
  const lawyers = await publicLawyers(firm.id);

  return (
    <PageShell title="Lawyers" intro="You choose which lawyer to meet when you book a consultation.">
      {lawyers.length === 0 ? (
        // The booking wizard reads the same list (book/page.tsx), so with no lawyers here there is
        // no time to book online either, and the way forward is the firm's contact page.
        <EmptyState
          align="start"
          title="No lawyers listed yet"
          hint={`Once ${firm.name} adds its lawyers, each one shows here.`}
          action={
            <Link
              href={`/${firm.slug}/contact`}
              className="inline-flex min-h-11 items-center text-15 font-semibold text-brand underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              Contact {firm.name}
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {lawyers.map((l) => (
            <Link key={l.id} href={`/${firm.slug}/lawyers/${l.slug ?? l.id}`} className="block rounded-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
              <Card className="public-list-card h-full">
                <CardBody className="space-y-1">
                  <p className="text-11 font-semibold uppercase tracking-[0.12em] text-brand-accent">Legal team</p>
                  <h2 className="font-heading text-21 font-semibold text-brand">
                    {lawyerDisplayName(l, firm.name)}
                  </h2>
                  {l.title && <p className="text-15 text-ink-muted">{l.title}</p>}
                  {l.practice_areas.length > 0 && (
                    <p className="text-13 text-ink-muted">{l.practice_areas.join(" · ")}</p>
                  )}
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </PageShell>
  );
}
