import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { firmBySlug } from "@/lib/tenant";
import { activeServices, formatMoneyMinor } from "@/lib/services";
import { Card, CardBody } from "@/components/ui/card";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ firm: string }>;
}): Promise<Metadata> {
  const { firm: slug } = await params;
  const firm = await firmBySlug(slug);
  if (!firm) return {};
  return {
    title: firm.name,
    description: firm.brand.tagline ?? `Legal services by ${firm.name}`,
    openGraph: {
      title: firm.name,
      description: firm.brand.tagline ?? undefined,
    },
  };
}

export default async function FirmHome({
  params,
}: {
  params: Promise<{ firm: string }>;
}) {
  const { firm: slug } = await params;
  const firm = await firmBySlug(slug);
  if (!firm) notFound();

  const services = await activeServices(firm.id);

  return (
    <div className="mx-auto max-w-5xl px-4">
      <section className="py-16 sm:py-24">
        <h1 className="max-w-2xl font-heading text-4xl font-semibold leading-tight text-brand sm:text-5xl">
          {firm.brand.tagline ?? `Legal help from ${firm.name}`}
        </h1>
        <p className="mt-4 max-w-xl text-lg text-gray-600">
          Tell us what you need, book a time that works for you, and meet your
          lawyer face to face — from your phone.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href={`/${firm.slug}/book`}
            className="rounded-lg bg-brand px-6 py-3.5 text-base font-medium text-white hover:opacity-90"
          >
            {firm.brand.cta ?? "Book a Consultation"}
          </Link>
          <Link
            href="/app/login"
            className="rounded-lg border border-gray-300 px-6 py-3.5 text-base font-medium text-brand hover:bg-black/5"
          >
            Client sign in
          </Link>
        </div>
      </section>

      {services.length > 0 && (
        <section aria-labelledby="services-heading" className="pb-16">
          <h2 id="services-heading" className="font-heading text-2xl font-semibold text-gray-900">
            How we can help
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((service) => (
              <Card key={service.id}>
                <CardBody className="space-y-2">
                  <h3 className="font-heading text-base font-semibold text-gray-900">
                    {service.name}
                  </h3>
                  {service.description && (
                    <p className="text-sm text-gray-600">{service.description}</p>
                  )}
                  <p className="text-sm font-medium text-brand">
                    {formatMoneyMinor(service.price_minor, service.currency)} ·{" "}
                    {service.duration_min} minutes
                    {service.virtual_available ? " · virtual available" : ""}
                  </p>
                </CardBody>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
