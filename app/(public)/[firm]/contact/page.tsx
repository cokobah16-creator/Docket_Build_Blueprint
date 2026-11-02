import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { firmBySlug } from "@/lib/tenant";
import { publishedContent } from "@/lib/public-data";
import { buttonClasses } from "@/components/ui/button";
import { ContentBody, PageShell } from "../_components/page-shell";
import { firmContact } from "../_components/firm-contact";
import { ctaLabel } from "../_components/site-words";

export async function generateMetadata({ params }: { params: Promise<{ firm: string }> }): Promise<Metadata> {
  const { firm: slug } = await params;
  const firm = await firmBySlug(slug);
  return firm ? { title: `Contact · ${firm.name}` } : {};
}

const TERM = "text-11 font-semibold uppercase tracking-[0.06em] text-ink-muted";
// A link alone on its line carries its own 44px target and focus ring.
const LINK =
  "inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4 [overflow-wrap:anywhere] " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export default async function ContactPage({ params }: { params: Promise<{ firm: string }> }) {
  const { firm: slug } = await params;
  const firm = await firmBySlug(slug);
  if (!firm) notFound();
  const page = await publishedContent(firm.id, "page", "contact");
  // Each detail as the firm typed it, linked only when a link can be built from it (a number
  // that cannot be dialled as written is shown, not linked).
  const { phone, whatsapp, email, address } = firmContact(firm);

  return (
    <PageShell title="Contact" intro="Book a consultation online, or use the details below.">
      {page?.body && <ContentBody body={page.body} />}
      {!phone && !whatsapp && !email && (
        <p className="mt-6 text-15 text-ink-muted">{firm.name} has not added its phone number or email yet.</p>
      )}
      <dl className="mt-6 space-y-4 rounded-card border border-hairline bg-raised p-5 text-17">
        {phone && (
          <div>
            <dt className={TERM}>Phone</dt>
            <dd className="text-ink">{phone.href ? <a className={LINK} href={phone.href}>{phone.text}</a> : phone.text}</dd>
          </div>
        )}
        {whatsapp && (
          <div>
            <dt className={TERM}>WhatsApp</dt>
            <dd className="text-ink">
              {whatsapp.href ? (
                <a className={LINK} href={whatsapp.href}>
                  <span className="sr-only">Message {firm.name} on WhatsApp: </span>
                  {whatsapp.text}
                </a>
              ) : (
                whatsapp.text
              )}
            </dd>
          </div>
        )}
        {email && (
          <div>
            <dt className={TERM}>Email</dt>
            <dd className="text-ink">{email.href ? <a className={LINK} href={email.href}>{email.text}</a> : email.text}</dd>
          </div>
        )}
        {address && (
          <div>
            <dt className={TERM}>Address</dt>
            <dd className="mt-1 text-ink">{address}</dd>
          </div>
        )}
        <div>
          <dt className={TERM}>Booking</dt>
          <dd className="mt-1 text-ink">Book online at any time. Times are shown in your own time zone.</dd>
        </div>
      </dl>
      {/* This page's filled button, so the header's turns quiet here (data-header-cta, layout.tsx). */}
      <div data-header-cta="quiet" className="mt-8 flex flex-col items-start gap-4">
        <Link href={`/${firm.slug}/book`} className={buttonClasses("primary", "lg")}>
          {ctaLabel(firm.brand)}
        </Link>
        <p className="text-15 text-ink">
          Is it urgent?{" "}
          <Link href={`/${firm.slug}/urgent`} className={LINK}>
            Get help now
          </Link>
        </p>
      </div>
    </PageShell>
  );
}
