import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { firmBySlug } from "@/lib/tenant";
import { activeServices, formatMoneyMinor } from "@/lib/services";
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

  return (
    <PageShell title="Services" intro="Every engagement starts with a consultation so your lawyer understands your situation first.">
      {services.length === 0 ? (
        <p className="text-gray-600">Services are being set up. Please contact the firm directly.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {services.map((s) => (
            <Link key={s.id} href={`/${firm.slug}/services/${s.slug}`} className="block">
              <Card className="h-full transition hover:shadow-md">
                <CardBody className="space-y-2">
                  <h2 className="font-heading text-base font-semibold text-gray-900">{s.name}</h2>
                  {s.description && <p className="text-sm text-gray-600">{s.description}</p>}
                  <p className="text-sm font-medium text-brand">
                    {formatMoneyMinor(s.price_minor, s.currency)} · {s.duration_min} minutes
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
