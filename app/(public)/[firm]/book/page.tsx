// Booking wizard entry: service → format → day and time → details → review
// → book_appointment() → payment. Everything the wizard needs is loaded here
// through the anon-safe views; the wizard itself is a client component that
// talks to available_slots / book_appointment via RPC.

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
    <div className="mx-auto max-w-lg px-4 pb-12 pt-6">
      <h1 className="font-heading text-[26px] font-semibold leading-tight tracking-[-0.015em] text-brand">Book a Consultation</h1>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-gray-600">
        Takes about three minutes. Your slot is held for 15 minutes while you pay.
      </p>
      <div className="mt-5">
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
  );
}
