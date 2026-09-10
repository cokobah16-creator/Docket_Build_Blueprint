// Booking wizard placeholder — the full wizard (service → lawyer → slot →
// intake → pay) ships in slice 1 on top of available_slots / book_appointment.
// Until then this page is honest about it and routes people to the firm.

import { notFound } from "next/navigation";
import { firmBySlug } from "@/lib/tenant";
import { Alert } from "@/components/ui/alert";

export const metadata = { title: "Book a Consultation" };

export default async function BookPage({
  params,
}: {
  params: Promise<{ firm: string }>;
}) {
  const { firm: slug } = await params;
  const firm = await firmBySlug(slug);
  if (!firm) notFound();

  const contact = firm.brand.contact;

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="font-heading text-3xl font-semibold text-brand">
        Book a Consultation
      </h1>
      <p className="mt-3 text-gray-600">
        Online booking and payment are almost ready. Until they launch, reach{" "}
        {firm.name} directly and we will schedule your consultation.
      </p>
      <div className="mt-6 space-y-3">
        {contact?.phone && (
          <p className="text-gray-800">
            Phone: <a className="font-medium text-brand underline" href={`tel:${contact.phone}`}>{contact.phone}</a>
          </p>
        )}
        {contact?.email && (
          <p className="text-gray-800">
            Email: <a className="font-medium text-brand underline" href={`mailto:${contact.email}`}>{contact.email}</a>
          </p>
        )}
        {!contact?.phone && !contact?.email && (
          <Alert kind="info">
            Contact details will appear here once the firm completes its
            profile.
          </Alert>
        )}
      </div>
      {firm.policies.cancellation?.text ? (
        <p className="mt-8 text-sm text-gray-500">
          {String(firm.policies.cancellation.text)}
        </p>
      ) : null}
    </div>
  );
}
