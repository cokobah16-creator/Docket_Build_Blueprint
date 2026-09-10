import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { firmBySlug } from "@/lib/tenant";
import { publishedContent } from "@/lib/public-data";
import { ContentBody, PageShell } from "../_components/page-shell";

export async function generateMetadata({ params }: { params: Promise<{ firm: string }> }): Promise<Metadata> {
  const { firm: slug } = await params;
  const firm = await firmBySlug(slug);
  return firm ? { title: `Contact · ${firm.name}` } : {};
}

export default async function ContactPage({ params }: { params: Promise<{ firm: string }> }) {
  const { firm: slug } = await params;
  const firm = await firmBySlug(slug);
  if (!firm) notFound();
  const page = await publishedContent(firm.id, "page", "contact");
  const c = firm.brand.contact ?? {};

  return (
    <PageShell title="Contact" intro="The fastest way to reach us is to book a consultation — otherwise, get in touch below.">
      {page?.body && <ContentBody body={page.body} />}
      <dl className="mt-6 space-y-3 rounded-card border border-gray-200 bg-white p-5">
        {c.phone && (
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Phone</dt>
            <dd><a className="font-medium text-brand underline" href={`tel:${c.phone}`}>{c.phone}</a></dd>
          </div>
        )}
        {c.email && (
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Email</dt>
            <dd><a className="font-medium text-brand underline" href={`mailto:${c.email}`}>{c.email}</a></dd>
          </div>
        )}
        {c.address && (
          <div>
            <dt className="text-xs uppercase tracking-wide text-gray-500">Address</dt>
            <dd className="text-gray-800">{c.address}</dd>
          </div>
        )}
        {!c.phone && !c.email && !c.address && (
          <p className="text-sm text-gray-600">Contact details will appear here once the firm completes its profile.</p>
        )}
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500">Hours</dt>
          <dd className="text-gray-800">Consultations are booked online, in the {firm.timezone} timezone.</dd>
        </div>
      </dl>
    </PageShell>
  );
}
