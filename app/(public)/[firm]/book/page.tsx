// Booking wizard entry: service → format → day and time → details → review
// → book_appointment() → payment. Everything the wizard needs is loaded here
// through the anon-safe views. The client asks available_slots() directly for browsing, then
// submits the booking through the server action; book_appointment() enforces its own rate limit.

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { firmBySlug } from "@/lib/tenant";
import { activeServices } from "@/lib/services";
import { activeIntakeForms, publicLawyers } from "@/lib/public-data";
import { BookingWizard } from "./booking-wizard";

export async function generateMetadata({ params }: { params: Promise<{ firm: string }> }): Promise<Metadata> {
  const { firm: slug } = await params;
  const firm = await firmBySlug(slug);
  return firm ? { title: `Book a Consultation · ${firm.name}`, robots: { index: false } } : {};
}

export default async function BookPage({
  params,
  searchParams,
}: {
  params: Promise<{ firm: string }>;
  searchParams: Promise<{ service?: string; lawyer?: string; resume?: string }>;
}) {
  const { firm: slug } = await params;
  const sp = await searchParams;
  const firm = await firmBySlug(slug);
  if (!firm) notFound();

  const [services, lawyers, forms] = await Promise.all([
    activeServices(firm.id),
    publicLawyers(firm.id),
    activeIntakeForms(firm.id),
  ]);

  return (
    <section className="booking-page border-b border-hairline">
      <div className="mx-auto grid max-w-[1180px] gap-10 px-4 py-10 sm:px-6 sm:py-16 lg:grid-cols-[0.78fr_1.22fr] lg:gap-16 lg:px-8 lg:py-20">
        <aside className="lg:sticky lg:top-8 lg:self-start">
          <p className="text-11 font-semibold uppercase tracking-[0.15em] text-brand-accent">Private consultation</p>
          <h1 className="mt-4 max-w-[12ch] font-heading text-44 font-semibold leading-[1.03] tracking-[-0.035em] text-brand sm:text-56">
            Book time with {firm.name}.
          </h1>
          <p className="mt-5 max-w-[46ch] text-15 leading-6 text-ink-muted">
            Choose the legal service, meeting format and available time. Your answers give the lawyer a useful brief before you meet.
          </p>
          <div className="mt-8 border-t border-hairline">
            {[
              ["01", "Choose the service"],
              ["02", "Select a lawyer and time"],
              ["03", "Sign in, review and confirm"],
            ].map(([number, label]) => (
              <div key={number} className="flex items-center gap-4 border-b border-hairline py-4">
                <span className="font-heading text-17 text-brand-accent">{number}</span>
                <span className="text-13 font-semibold text-ink">{label}</span>
              </div>
            ))}
          </div>
          <p className="mt-6 text-11 leading-5 text-ink-muted">
            Your slot is held for 15 minutes while you pay. Submitting a booking does not by itself create a lawyer-client relationship.
          </p>
        </aside>

        <div className="booking-workspace border border-hairline bg-raised px-4 pb-6 shadow-e2 sm:px-7 sm:pb-8">
          <div className="border-b border-hairline py-5 lg:hidden">
            <p className="font-heading text-26 font-semibold text-brand">Book a Consultation</p>
            <p className="mt-1 text-13 text-ink-muted">Usually takes about three minutes.</p>
          </div>
          <BookingWizard
            firm={firm}
            services={services}
            lawyers={lawyers}
            forms={forms}
            initialServiceSlug={sp.service ?? null}
            initialLawyerId={sp.lawyer ?? null}
            resume={sp.resume === "1"}
          />
        </div>
      </div>
    </section>
  );
}
