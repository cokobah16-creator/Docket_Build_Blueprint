// Booking wizard entry: service → how you meet → day and time → details → check
// and book → book_appointment() → payment. Everything the wizard needs is loaded
// here through the anon-safe views; the wizard itself is a client component that
// talks to available_slots over RPC and books through the booking server actions.
//
// On a phone the wizard is the page. The side panel's title, introduction and
// list of steps only repeat what each step already says, so below `lg` they are
// hidden and the wizard's own title is the page's heading. The urgent-help link
// is not a repeat, so it shows at every width, above the wizard on a phone.
//
// The wizard draws this page's one filled button (Continue, the booking button,
// or the sign-in form's), so the workspace carries data-header-cta="quiet" and
// the header's own booking button turns into a ghost button here (layout.tsx).

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { firmBySlug } from "@/lib/tenant";
import { activeServices } from "@/lib/services";
import { activeIntakeForms, publicLawyers } from "@/lib/public-data";
import { firmPath } from "@/lib/site";
import { BookingWizard, UrgentHelpLink } from "./booking-wizard";

export async function generateMetadata({ params }: { params: Promise<{ firm: string }> }): Promise<Metadata> {
  const { firm: slug } = await params;
  const firm = await firmBySlug(slug);
  return firm ? { title: `Book a consultation · ${firm.name}`, robots: { index: false } } : {};
}

const STEPS = [
  ["01", "Choose a service"],
  ["02", "Choose how and when you meet"],
  ["03", "Sign in, check the details and book"],
] as const;

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
      <div className="mx-auto grid max-w-[1180px] gap-4 px-4 py-6 sm:px-6 sm:py-10 lg:grid-cols-[0.78fr_1.22fr] lg:gap-16 lg:px-8 lg:py-20">
        <aside className="lg:sticky lg:top-8 lg:self-start">
          <div className="hidden lg:block">
            <p className="text-11 font-semibold uppercase tracking-[0.15em] text-brand-accent">Private consultation</p>
            <h1 className="mt-4 max-w-[20ch] font-heading text-26 font-semibold tracking-[-0.02em] text-brand">
              Book a consultation with {firm.name}.
            </h1>
            <p className="mt-4 max-w-[46ch] text-15 text-ink-muted">
              Choose a service and a time that suits you. Before you pay anything, you see who you are paying and what
              the total is made of.
            </p>
            <ol className="mt-8 border-t border-hairline">
              {STEPS.map(([number, label]) => (
                <li key={number} className="flex items-center gap-4 border-b border-hairline py-4">
                  <span aria-hidden="true" className="font-heading text-17 text-brand-accent">{number}</span>
                  <span className="text-13 font-semibold text-ink">{label}</span>
                </li>
              ))}
            </ol>
          </div>
          <UrgentHelpLink href={firmPath(firm, "/urgent")} className="lg:mt-6" />
        </aside>

        <div
          data-header-cta="quiet"
          className="booking-workspace border border-hairline bg-raised px-4 pb-6 shadow-e1 sm:px-7 sm:pb-8"
        >
          <div className="border-b border-hairline py-5 lg:hidden">
            <h1 className="font-heading text-21 font-semibold text-brand">Book a consultation</h1>
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
