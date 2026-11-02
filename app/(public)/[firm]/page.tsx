import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { firmBySlug } from "@/lib/tenant";
import { activeServices } from "@/lib/services";
import { publicLawyers, lawyerDisplayName } from "@/lib/public-data";
import { legalServiceJsonLd, siteOrigin } from "@/lib/site";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { ctaLabel, priceIncludingVat } from "./_components/site-words";

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

// One filled button on this page, the hero's booking button, which is why it quiets the header's
// (data-header-cta, layout.tsx). The closing panel repeats the same action as an outline, and
// everything else that leads somewhere is a text link.
const TEXT_LINK =
  "inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4 " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export default async function FirmHome({ params }: { params: Promise<{ firm: string }> }) {
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
  // Prices are shown as the client will pay them: with the firm's VAT, as book_appointment() adds it.
  const vatRate = Number(firm.vat_rate) || 0;
  const cta = ctaLabel(firm.brand);

  return (
    <div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <section className="firm-home-hero border-b border-hairline">
        <div className="mx-auto grid max-w-[1180px] gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1fr_0.78fr] lg:items-center lg:gap-16 lg:px-8">
          <div>
            <h1 className="max-w-[16ch] font-heading text-44 font-semibold leading-[1.02] tracking-[-0.035em] text-brand sm:text-56">
              {firm.brand.tagline ?? `Book a consultation with ${firm.name}.`}
            </h1>
            <p className="mt-6 max-w-[58ch] text-17 leading-7 text-ink-muted">
              Pick a service, a lawyer and a time that suits you. You see the full price before you pay. If {firm.name} takes on your matter, you can follow it from your phone.
            </p>
            <div data-header-cta="quiet" className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
              <Link href={`${base}/book`} className={buttonClasses("primary", "lg")}>
                {cta}
              </Link>
              <Link href={`${base}/services`} className={`${TEXT_LINK} text-15`}>
                See all services
              </Link>
            </div>
          </div>

          <aside className="firm-brief border border-hairline bg-raised">
            <div className="border-b border-hairline bg-brand px-5 py-4 text-brand-on">
              <p className="font-heading text-17 font-semibold">What a consultation costs</p>
            </div>
            {/* With no services listed the booking wizard has nothing to offer yet, so the brief
                says why it is empty rather than linking to a booking that cannot be made.
                EmptyState brings its own padding: p-1 plus its px-4 lines its text up with the
                heading's px-5 above. */}
            {services.length === 0 ? (
              <div className="p-1">
                <EmptyState
                  align="start"
                  title="No services listed yet"
                  hint={`Prices show here once ${firm.name} lists its services.`}
                />
              </div>
            ) : (
              <div className="p-5">
                <div className="space-y-3">
                  {services.slice(0, 4).map((service) => (
                    <div key={service.id} className="grid grid-cols-[1fr_auto] items-start gap-3 border-b border-hairline pb-3 last:border-0 last:pb-0">
                      <div>
                        <p className="text-13 font-semibold text-ink">{service.name}</p>
                        <p className="mt-0.5 text-11 text-ink-muted">{service.duration_min} minutes</p>
                      </div>
                      <p className="text-right text-13 font-semibold text-brand">{priceIncludingVat(service.price_minor, service.currency, vatRate)}</p>
                    </div>
                  ))}
                </div>
                <Link href={`${base}/book`} className={`mt-4 ${TEXT_LINK} text-13`}>
                  Start a booking
                </Link>
              </div>
            )}
          </aside>
        </div>
      </section>

      <section aria-labelledby="process-heading" className="border-b border-hairline bg-raised">
        <div className="mx-auto grid max-w-[1180px] px-4 sm:px-6 md:grid-cols-3 lg:px-8">
          {[
            ["01", "Choose a service", "Pick what you need help with. Your answers to any questions help your lawyer prepare."],
            ["02", "Pick a time", "Choose a lawyer, how you meet and a free time. You see the full price before you confirm."],
            ["03", "Follow your matter", `If ${firm.name} takes on your matter, you can follow its dates, documents, messages and invoices from your phone.`],
          ].map(([number, title, body], index) => (
            <article key={number} className={`py-8 md:px-7 ${index === 0 ? "md:pl-0" : ""} ${index < 2 ? "border-b border-hairline md:border-b-0 md:border-r" : ""}`}>
              <p className="font-heading text-21 text-brand-accent">{number}</p>
              <h2 id={index === 0 ? "process-heading" : undefined} className="mt-4 font-heading text-21 font-semibold text-brand">{title}</h2>
              <p className="mt-2 text-13 leading-5 text-ink-muted">{body}</p>
            </article>
          ))}
        </div>
      </section>

      {services.length > 0 && (
        <section aria-labelledby="services-heading" className="mx-auto max-w-[1180px] px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
          <div className="flex flex-wrap items-end justify-between gap-6 border-b border-hairline pb-7">
            <div>
              <p className="text-11 font-semibold uppercase tracking-[0.14em] text-brand-accent">Areas of work</p>
              <h2 id="services-heading" className="mt-3 font-heading text-32 font-semibold tracking-[-0.025em] text-brand sm:text-44">How {firm.name} can help</h2>
            </div>
            <Link href={`${base}/services`} className={`${TEXT_LINK} text-13`}>See all services</Link>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3">
            {services.slice(0, 6).map((service, index) => (
              <Link key={service.id} href={`${base}/services/${service.slug}`} className={`group flex min-h-[250px] flex-col border-b border-hairline py-8 sm:px-7 ${index % 3 === 0 ? "lg:pl-0" : ""} ${index % 3 !== 2 ? "lg:border-r" : ""} focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand`}>
                <p className="text-11 font-semibold uppercase tracking-[0.12em] text-brand-accent">Service {String(index + 1).padStart(2, "0")}</p>
                <h3 className="mt-6 font-heading text-21 font-semibold leading-7 text-brand group-hover:underline">{service.name}</h3>
                {service.description && <p className="mt-3 text-13 leading-5 text-ink-muted">{service.description}</p>}
                <p className="mt-auto pt-6 text-13 font-semibold text-brand">{priceIncludingVat(service.price_minor, service.currency, vatRate)} · {service.duration_min} minutes</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {lawyers.length > 0 && (
        <section aria-labelledby="lawyers-heading" className="border-y border-hairline bg-raised">
          <div className="mx-auto max-w-[1180px] px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
            <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr]">
              <div>
                <p className="text-11 font-semibold uppercase tracking-[0.14em] text-brand-accent">The practice</p>
                <h2 id="lawyers-heading" className="mt-3 max-w-[10ch] font-heading text-32 font-semibold tracking-[-0.025em] text-brand sm:text-44">Meet the lawyers</h2>
                <Link href={`${base}/lawyers`} className={`mt-4 ${TEXT_LINK} text-13`}>See all lawyers</Link>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {lawyers.slice(0, 4).map((lawyer) => {
                  const name = lawyerDisplayName(lawyer, firm.name);
                  return (
                    <Link key={lawyer.id} href={`${base}/lawyers/${lawyer.slug ?? lawyer.id}`} className="group flex min-h-[160px] items-start gap-4 border border-hairline bg-paper p-5 hover:border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
                      <span className="grid size-12 shrink-0 place-items-center rounded-full bg-brand font-heading text-17 text-brand-on">{name.slice(0, 1)}</span>
                      <span>
                        <span className="block font-heading text-17 font-semibold text-brand group-hover:underline">{name}</span>
                        {lawyer.title && <span className="mt-1 block text-13 text-ink-muted">{lawyer.title}</span>}
                        {lawyer.practice_areas.length > 0 && <span className="mt-4 block text-11 leading-4 text-ink-muted">{lawyer.practice_areas.join(" · ")}</span>}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="mx-auto max-w-[1180px] px-4 py-20 sm:px-6 lg:px-8">
        <div className="grid gap-8 bg-brand px-6 py-10 text-brand-on sm:px-10 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <h2 className="max-w-[24ch] font-heading text-26 font-semibold leading-tight">Book a consultation with {firm.name}</h2>
            <p className="mt-2 max-w-[56ch] text-15 opacity-85">Before you pay, you see who you are paying and what the total is made of.</p>
          </div>
          {/* An outline in the panel's own foreground, not a fill: the hero's button is this
              page's one filled button. The hover is the button system's overlay of the label's
              own colour (button.tsx), which reads on any firm's panel. */}
          <Link
            href={`${base}/book`}
            className="relative isolate inline-flex min-h-[50px] items-center justify-center rounded-control border border-brand-on px-6 text-15 font-semibold text-brand-on before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:bg-current before:opacity-0 before:transition-opacity before:duration-fast hover:before:opacity-10 active:before:opacity-20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-on"
          >
            {cta}
          </Link>
        </div>
      </section>
    </div>
  );
}
