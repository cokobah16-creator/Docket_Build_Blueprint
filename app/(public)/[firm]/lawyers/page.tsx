import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { firmBySlug } from "@/lib/tenant";
import { lawyerDisplayName, publicLawyers } from "@/lib/public-data";
import { Card, CardBody } from "@/components/ui/card";
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
    <PageShell title="Our lawyers" intro="You choose which lawyer to meet when you book a consultation.">
      {lawyers.length === 0 ? (
        <p className="text-ink-muted">Lawyer profiles are being set up.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {lawyers.map((l) => (
            <Link key={l.id} href={`/${firm.slug}/lawyers/${l.slug ?? l.id}`} className="block">
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
