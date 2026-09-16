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
      <dl className="mt-6 space-y-3 rounded-card border border-hairline bg-raised p-5">
        {c.phone && (
          <div>
            <dt className="text-13 uppercase tracking-wide text-ink-muted">Phone</dt>
            <dd><a className="font-medium text-brand underline" href={`tel:${c.phone}`}>{c.phone}</a></dd>
          </div>
        )}
        {c.email && (
          <div>
            <dt className="text-13 uppercase tracking-wide text-ink-muted">Email</dt>
            <dd><a className="font-medium text-brand underline" href={`mailto:${c.email}`}>{c.email}</a></dd>
          </div>
        )}
        {c.address && (
          <div>
            <dt className="text-13 uppercase tracking-wide text-ink-muted">Address</dt>
            <dd className="text-ink">{c.address}</dd>
          </div>
        )}
        {!c.phone && !c.email && !c.address && (
          <p className="text-15 text-ink-muted">Contact details will appear here once the firm completes its profile.</p>
        )}
        <div>
          <dt className="text-13 uppercase tracking-wide text-ink-muted">Hours</dt>
          <dd className="text-ink">Consultations are booked online, in the {firm.timezone} timezone.</dd>
        </div>
      </dl>
    </PageShell>
  );
}
