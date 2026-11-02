import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { firmBySlug } from "@/lib/tenant";
import { activeServices } from "@/lib/services";
import { Card, CardBody, EmptyState } from "@/components/ui/card";
import { PageShell } from "../_components/page-shell";
import { priceIncludingVat } from "../_components/site-words";

export async function generateMetadata({ params }: { params: Promise<{ firm: string }> }): Promise<Metadata> {
  const { firm: slug } = await params;
  const firm = await firmBySlug(slug);
  return firm ? { title: `Services · ${firm.name}` } : {};
}

export default async function ServicesPage({ params }: { params: Promise<{ firm: string }> }) {
  const { firm: slug } = await params;
  const firm = await firmBySlug(slug);
  if (!firm) notFound();
  const services = await activeServices(firm.id);
  // Prices are shown as the client will pay them: with the firm's VAT, as book_appointment() adds it.
  const vatRate = Number(firm.vat_rate) || 0;

  return (
    <PageShell title="Services" intro="Each service starts with a consultation, so your lawyer understands your situation first.">
      {services.length === 0 ? (
        // The booking wizard reads the same list, so with none here there is nothing to book
        // online either, and the way forward is the firm's contact page.
        <EmptyState
          align="start"
          title="No services listed yet"
          hint={`Once ${firm.name} lists its services, each one shows here with its price.`}
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
          {services.map((s) => (
            <Link key={s.id} href={`/${firm.slug}/services/${s.slug}`} className="block rounded-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
              <Card className="public-list-card h-full">
                <CardBody className="space-y-2">
                  <p className="text-11 font-semibold uppercase tracking-[0.12em] text-brand-accent">Consultation</p>
                  <h2 className="font-heading text-21 font-semibold text-brand">{s.name}</h2>
                  {s.description && <p className="text-15 text-ink-muted">{s.description}</p>}
                  <p className="border-t border-hairline pt-3 text-13 font-semibold text-brand">
                    {priceIncludingVat(s.price_minor, s.currency, vatRate)} · {s.duration_min} minutes
                  </p>
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </PageShell>
  );
}
