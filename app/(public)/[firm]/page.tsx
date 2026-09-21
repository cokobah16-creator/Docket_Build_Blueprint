import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { firmBySlug } from "@/lib/tenant";
import { activeServices, formatMoneyMinor } from "@/lib/services";
import { publicLawyers, lawyerDisplayName } from "@/lib/public-data";
import { legalServiceJsonLd, siteOrigin } from "@/lib/site";

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

  return (
    <div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <section className="firm-home-hero border-b border-hairline">
        <div className="mx-auto grid max-w-[1180px] gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1fr_0.78fr] lg:items-center lg:gap-16 lg:px-8">
          <div>
            <p className="text-11 font-semibold uppercase tracking-[0.16em] text-brand-accent">
              Counsel · clarity · continuity
            </p>
            <h1 className="mt-5 max-w-[13ch] font-heading text-44 font-semibold leading-[1.02] tracking-[-0.035em] text-brand sm:text-56">
              {firm.brand.tagline ?? `Legal work handled with clarity by ${firm.name}.`}
            </h1>
            <p className="mt-6 max-w-[58ch] text-17 leading-7 text-ink-muted">
              Begin with a structured consultation, meet the lawyer handling your work, and follow every important development through one secure client record.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={`${base}/book`} className="inline-flex min-h-[50px] items-center rounded-control bg-brand px-6 text-15 font-semibold text-brand-on hover:opacity-90">
                {firm.brand.cta ?? "Book a Consultation"}
              </Link>
              <Link href={`${base}/services`} className="inline-flex min-h-[50px] items-center rounded-control border border-edge bg-raised px-6 text-15 font-semibold text-brand hover:bg-hover">
                Explore services
              </Link>
            </div>
            <div className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-11 font-medium text-ink-muted">
              <span>Secure online booking</span>
              <span>Virtual or in-person consultation</span>
              <span>Mobile client portal</span>
            </div>
          </div>

          <aside className="firm-brief border border-hairline bg-raised shadow-e2">
            <div className="border-b border-hairline bg-brand px-5 py-4 text-brand-on">
              <p className="text-11 font-semibold uppercase tracking-[0.13em] opacity-70">Consultation brief</p>
              <p className="mt-1 font-heading text-21">Start with the right information</p>
            </div>
            <div className="p-5">
              <dl className="grid grid-cols-2 gap-4 border-b border-hairline pb-5">
                <div>
                  <dt className="text-11 uppercase tracking-[0.1em] text-ink-muted">Services</dt>
                  <dd className="mt-1 font-heading text-26 text-brand">{services.length}</dd>
                </div>
                <div>
                  <dt className="text-11 uppercase tracking-[0.1em] text-ink-muted">Lawyers</dt>
                  <dd className="mt-1 font-heading text-26 text-brand">{lawyers.length}</dd>
                </div>
              </dl>
              <div className="mt-5 space-y-4">
                {services.slice(0, 3).map((service, index) => (
                  <div key={service.id} className="grid grid-cols-[28px_1fr_auto] items-start gap-3 border-b border-hairline pb-4 last:border-0 last:pb-0">
                    <span className="font-heading text-15 text-brand-accent">0{index + 1}</span>
                    <div>
                      <p className="text-13 font-semibold text-ink">{service.name}</p>
                      <p className="mt-0.5 text-11 text-ink-muted">{service.duration_min} minutes</p>
                    </div>
                    <p className="text-right text-11 font-semibold text-brand">{formatMoneyMinor(service.price_minor, service.currency)}</p>
                  </div>
                ))}
                {services.length === 0 && <p className="text-13 text-ink-muted">Consultation services are being prepared.</p>}
              </div>
              <Link href={`${base}/book`} className="mt-6 inline-flex min-h-[46px] w-full items-center justify-center rounded-control border border-brand text-13 font-semibold text-brand hover:bg-hover">
                Start a booking
              </Link>
            </div>
          </aside>
        </div>
      </section>

      <section aria-labelledby="process-heading" className="border-b border-hairline bg-raised">
        <div className="mx-auto grid max-w-[1180px] px-4 sm:px-6 md:grid-cols-3 lg:px-8">
          {[
            ["01", "Explain the issue", "Choose a service and give the lawyer the details needed to prepare."],
            ["02", "Choose your meeting", "Select the lawyer, format and live appointment time that work for you."],
            ["03", "Follow the matter", "Receive dates, documents, messages and invoices through your client portal."],
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
              <h2 id="services-heading" className="mt-3 font-heading text-32 font-semibold tracking-[-0.025em] text-brand sm:text-44">How we can help</h2>
            </div>
            <Link href={`${base}/services`} className="text-13 font-semibold text-brand underline underline-offset-4">View every service</Link>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3">
            {services.slice(0, 6).map((service, index) => (
              <Link key={service.id} href={`${base}/services/${service.slug}`} className={`group flex min-h-[250px] flex-col border-b border-hairline py-8 sm:px-7 ${index % 3 === 0 ? "lg:pl-0" : ""} ${index % 3 !== 2 ? "lg:border-r" : ""}`}>
                <p className="text-11 font-semibold uppercase tracking-[0.12em] text-brand-accent">Service {String(index + 1).padStart(2, "0")}</p>
                <h3 className="mt-6 font-heading text-21 font-semibold leading-7 text-brand group-hover:underline">{service.name}</h3>
                {service.description && <p className="mt-3 text-13 leading-5 text-ink-muted">{service.description}</p>}
                <p className="mt-auto pt-6 text-13 font-semibold text-brand">{formatMoneyMinor(service.price_minor, service.currency)} · {service.duration_min} minutes</p>
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
                <h2 id="lawyers-heading" className="mt-3 max-w-[10ch] font-heading text-32 font-semibold tracking-[-0.025em] text-brand sm:text-44">Meet the lawyers handling the work.</h2>
                <Link href={`${base}/lawyers`} className="mt-6 inline-block text-13 font-semibold text-brand underline underline-offset-4">View the legal team</Link>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {lawyers.slice(0, 4).map((lawyer) => {
                  const name = lawyerDisplayName(lawyer, firm.name);
                  return (
                    <Link key={lawyer.id} href={`${base}/lawyers/${lawyer.slug ?? lawyer.id}`} className="group flex min-h-[160px] items-start gap-4 border border-hairline bg-paper p-5 hover:border-brand">
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
            <p className="text-11 font-semibold uppercase tracking-[0.13em] opacity-70">Begin with a consultation</p>
            <h2 className="mt-3 max-w-[18ch] font-heading text-32 font-semibold leading-tight tracking-[-0.025em]">Tell us what requires attention. We will start from there.</h2>
          </div>
          <Link href={`${base}/book`} className="inline-flex min-h-[50px] items-center justify-center rounded-control bg-brand-on px-6 text-15 font-semibold text-brand">
            {firm.brand.cta ?? "Book a Consultation"}
          </Link>
        </div>
      </section>
    </div>
  );
}
