import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { firmBySlug } from "@/lib/tenant";
import { activeServices, formatMoneyMinor } from "@/lib/services";
import { publicLawyers, lawyerDisplayName } from "@/lib/public-data";
import { legalServiceJsonLd, siteOrigin } from "@/lib/site";
import { Card, CardBody } from "@/components/ui/card";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ firm: string }>;
}): Promise<Metadata> {
  const { firm: slug } = await params;
  const firm = await firmBySlug(slug);
  if (!firm) return {};
  const description = firm.brand.tagline ?? `Legal services by ${firm.name}`;
  return {
    title: firm.name,
    description,
    openGraph: { title: firm.name, description, type: "website" },
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

  const [services, lawyers, origin] = await Promise.all([
    activeServices(firm.id),
    publicLawyers(firm.id),
    siteOrigin(),
  ]);
  const base = `/${firm.slug}`;
  const jsonLd = legalServiceJsonLd(firm, origin);

  return (
    <div className="mx-auto max-w-5xl px-4">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

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
            href={`${base}/book`}
            className="rounded-lg bg-brand px-6 py-3.5 text-base font-medium text-brand-on hover:opacity-90"
          >
            {firm.brand.cta ?? "Book a Consultation"}
          </Link>
          <Link
            href={`${base}/lawyers`}
            className="rounded-lg border border-gray-300 px-6 py-3.5 text-base font-medium text-brand hover:bg-black/5"
          >
            Speak with a lawyer
          </Link>
        </div>
      </section>

      <section aria-labelledby="how-heading" className="pb-16">
        <h2 id="how-heading" className="font-heading text-2xl font-semibold text-gray-900">
          How it works
        </h2>
        <ol className="mt-6 grid gap-4 sm:grid-cols-3">
          {[
            ["Tell us", "Choose a service and answer a few questions so your lawyer can prepare."],
            ["Book & pay", "Pick a time that suits you and pay securely. Your slot is held for 15 minutes."],
            ["Meet & join", "Join the consultation from your phone, or meet your lawyer in person. You get a reminder before the appointment."],
          ].map(([title, body], i) => (
            <li key={title} className="rounded-card border border-gray-200 bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-accent">Step {i + 1}</p>
              <p className="mt-1 font-heading text-base font-semibold text-gray-900">{title}</p>
              <p className="mt-1 text-sm text-gray-600">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      {services.length > 0 && (
        <section aria-labelledby="services-heading" className="pb-16">
          <div className="flex items-baseline justify-between">
            <h2 id="services-heading" className="font-heading text-2xl font-semibold text-gray-900">
              How we can help
            </h2>
            <Link href={`${base}/services`} className="text-sm font-medium text-brand underline">
              All services
            </Link>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {services.slice(0, 6).map((service) => (
              <Link key={service.id} href={`${base}/services/${service.slug}`} className="block">
                <Card className="h-full transition hover:shadow-md">
                  <CardBody className="space-y-2">
                    <h3 className="font-heading text-base font-semibold text-gray-900">{service.name}</h3>
                    {service.description && <p className="text-sm text-gray-600">{service.description}</p>}
                    <p className="text-sm font-medium text-brand">
                      {formatMoneyMinor(service.price_minor, service.currency)} · {service.duration_min} minutes
                    </p>
                  </CardBody>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {lawyers.length > 0 && (
        <section aria-labelledby="lawyers-heading" className="pb-16">
          <h2 id="lawyers-heading" className="font-heading text-2xl font-semibold text-gray-900">
            Our lawyers
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {lawyers.map((l) => (
              <Link key={l.id} href={`${base}/lawyers/${l.slug ?? l.id}`} className="block">
                <Card className="h-full transition hover:shadow-md">
                  <CardBody>
                    <p className="font-heading text-base font-semibold text-gray-900">
                      {lawyerDisplayName(l, firm.name)}
                    </p>
                    {l.title && <p className="text-sm text-gray-600">{l.title}</p>}
                  </CardBody>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
