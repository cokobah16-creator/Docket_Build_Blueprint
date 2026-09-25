import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { firmBySlug } from "@/lib/tenant";
import { activeServices } from "@/lib/services";
import { formatPriceWithVat } from "@/lib/money";
import { Card, CardBody } from "@/components/ui/card";
import { PageShell } from "../_components/page-shell";

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
    <PageShell title="Services" intro="Every engagement starts with a consultation so your lawyer understands your situation first.">
      {services.length === 0 ? (
        <p className="text-ink-muted">Services are being set up. Please contact the firm directly.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {services.map((s) => (
            <Link key={s.id} href={`/${firm.slug}/services/${s.slug}`} className="block">
              <Card className="public-list-card h-full">
                <CardBody className="space-y-2">
                  <p className="text-11 font-semibold uppercase tracking-[0.12em] text-brand-accent">Consultation</p>
                  <h2 className="font-heading text-21 font-semibold text-brand">{s.name}</h2>
                  {s.description && <p className="text-15 text-ink-muted">{s.description}</p>}
                  <p className="border-t border-hairline pt-3 text-13 font-semibold text-brand">
                    {formatPriceWithVat(s.price_minor, s.currency, vatRate)} · {s.duration_min} minutes
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
