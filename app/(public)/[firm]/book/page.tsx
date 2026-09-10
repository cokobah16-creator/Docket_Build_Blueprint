// Booking wizard entry: service → mode → lawyer → date → slot → intake →
// sign in → review → book_appointment() → payment. Everything the wizard
// needs is loaded here through the anon-safe views; the wizard itself is a
// client component that talks to available_slots / book_appointment via RPC.

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
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="font-heading text-3xl font-semibold text-brand">Book a Consultation</h1>
      <p className="mt-2 text-gray-600">
        Takes about three minutes. Your slot is held for 15 minutes while you pay.
      </p>
      <div className="mt-8">
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
