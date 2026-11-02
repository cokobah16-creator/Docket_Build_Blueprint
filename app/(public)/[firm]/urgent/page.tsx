// Urgent help: what to do first when something cannot wait, on every firm's public site.
//
// WHO IT IS FOR. Someone whose relative has just been arrested, who is being locked out today,
// or who has a court date tomorrow. They may not be a client and are probably not signed in, so
// the page is public, asks for nothing, and reads nothing but the firm's own row.
//
// NO CLIENT CODE AT ALL. Every action is a plain tel:, mailto: or https://wa.me/ link and every
// section a native <details> (Disclosure), so the page works before hydration, on a slow phone,
// and when its scripts never arrive. None of those links needs a change to the content security
// policy: they are navigations, which src/lib/csp.ts does not govern.
//
// ONE MAIN ACTION. "Call 112" is the only filled button. The firm's own numbers sit under it as
// ghost buttons, each only when the firm has set it, and data-header-cta="quiet" turns the
// header's booking button into a ghost on this page too (layout.tsx).
//
// ANY FIRM. Nothing here belongs to one firm: the name and the contact details come from
// firm_public. Docket keeps no office hours for a firm, so the page states none.
//
// THE STEPS ARE GENERAL INFORMATION, and are labelled so. They are adapted from Attorneys
// Klinique's own Urgent page, and Docket publishes them on every firm's site, so each statement
// of the law is kept to what is settled, worded with "can" and "may", and must be reviewed by a
// lawyer before it ships. Only national services are named. A state's own emergency line works
// in that state alone, so none is listed here.
//
// RENDERED PER REQUEST. force-dynamic, and no generateStaticParams: [firm] is a tenant, the
// page takes the per-request nonce policy, and it must never be added to PRERENDERED_SHELLS
// (src/lib/csp.ts), which is only for pages that render no firm data.

import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { firmBySlug } from "@/lib/tenant";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { Icon } from "@/components/ui/icon";
import { firmContact } from "../_components/firm-contact";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ firm: string }> }): Promise<Metadata> {
  const { firm: slug } = await params;
  const firm = await firmBySlug(slug);
  return firm
    ? {
        title: `Urgent help · ${firm.name}`,
        description:
          "What to do now if someone is arrested, you are locked out, threatened or defrauded, or a court date is close. If anyone is in danger, call 112.",
      }
    : {};
}

interface Situation {
  id: string;
  /** In the words of the person it is happening to, as Attorneys Klinique's page puts it. */
  label: string;
  steps: string[];
}

/** Do these now, in this order. The last step of "Something else urgent" names the firm only
 *  when the firm has given a way to reach it. */
function situations(firmName: string, canContactFirm: boolean): Situation[] {
  return [
    {
      id: "arrest",
      label: "Someone has been arrested or detained",
      steps: [
        "Find out which police station the person is at, the name of the officer and the reason for the arrest.",
        "Ask for a lawyer. The person can stay silent until they have spoken to one.",
        "Do not sign any statement without a lawyer present.",
        "The Nigeria Police Force says police bail is free. If anyone asks you to pay, ask for a receipt and tell your lawyer.",
        "Contact a lawyer now. If you cannot afford one, the Legal Aid Council of Nigeria may be able to help. It is listed under Free help below.",
      ],
    },
    {
      id: "eviction",
      label: "I am being thrown out or locked out today",
      steps: [
        "Stay calm and do not fight back. Your safety comes first.",
        "Take photos or a video of what is happening, including anyone involved and any damage.",
        "Keep your tenancy agreement, rent receipts and any notice you were given.",
        "A landlord can usually only remove a tenant with a valid notice and a court order. You can say so calmly, in writing if possible.",
        "If there is violence, call 112. Then contact a lawyer today.",
      ],
    },
    {
      id: "threat",
      label: "Someone is threatening or hurting me",
      steps: [
        "Get somewhere safe. Leave if you can and go to someone you trust.",
        "Call 112 and tell them where you are.",
        "Tell one person you trust what is happening.",
        "Keep every message, call log and photo of injuries or damage. Do not delete anything.",
        "Once you are safe, report it to the police and speak to a lawyer about protection.",
      ],
    },
    {
      id: "fraud",
      label: "I have lost money to fraud right now",
      steps: [
        "Call your bank now. Ask them to block your card or account and to stop the transfer.",
        "Take screenshots of everything: the messages, the account number and the payment confirmation.",
        "Do not send any more money, even if they promise to return the first payment.",
        "Report it to your bank in writing today and ask for a reference number.",
        "Report it to the police. You can also report it to the EFCC.",
      ],
    },
    {
      id: "court",
      label: "A court date or deadline is today or tomorrow",
      steps: [
        "Do not miss the date. Missing it can mean a judgment or a warrant against you.",
        "Contact a lawyer today. Ask if they can attend or apply for more time.",
        "Gather every paper about the case: the summons, the charge sheet and any letters.",
        "Arrive early with a valid ID. Write down what the court says and the next date.",
      ],
    },
    {
      id: "other",
      label: "Something else urgent",
      steps: [
        "If anyone is in danger, call 112 first.",
        "Write down what happened, with names, times and places, while it is fresh.",
        "Keep any papers, messages and photos. Do not sign or pay anything under pressure.",
        canContactFirm
          ? `Contact ${firmName} and tell them what you wrote down.`
          : "Then speak to a lawyer as soon as you can.",
      ],
    },
  ];
}

/** National bodies only, named for what they do. Like Attorneys Klinique's own list, it links
 *  each body's own website and gives no phone number for it: a number can change without
 *  anyone here knowing, and a wrong one is worse than none on this page. */
const FREE_HELP = [
  {
    name: "Legal Aid Council of Nigeria",
    what: "A federal body with offices in every state. If you cannot afford a lawyer, it may be able to give you one, including after an arrest.",
    site: "https://legalaidcouncil.gov.ng",
    link: "Visit the Legal Aid Council website",
  },
  {
    name: "National Human Rights Commission",
    what: "You can complain to it about police abuse, unlawful detention and other abuses of your rights.",
    site: "https://www.nigeriarights.gov.ng",
    link: "Visit the National Human Rights Commission website",
  },
];

// A link that stands on its own line, so it carries its own 44px target and focus ring.
const ROW_LINK =
  "inline-flex min-h-11 items-center text-15 font-semibold text-brand underline underline-offset-4 " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export default async function UrgentHelpPage({ params }: { params: Promise<{ firm: string }> }) {
  const { firm: slug } = await params;
  const firm = await firmBySlug(slug);
  if (!firm) notFound();

  const { phone, whatsapp, email } = firmContact(firm);
  const canContactFirm = Boolean(phone || whatsapp || email);
  // A detail the firm typed in a form a link cannot be built from is still worth showing.
  const unlinked = [
    phone && !phone.href ? { label: "Phone", text: phone.text } : null,
    whatsapp && !whatsapp.href ? { label: "WhatsApp", text: whatsapp.text } : null,
    email && !email.href ? { label: "Email", text: email.text } : null,
  ].filter((row): row is { label: string; text: string } => row !== null);

  return (
    <div data-header-cta="quiet" className="mx-auto max-w-[1180px] px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <div className="max-w-[720px]">
        <h1 className="font-heading text-26 font-semibold tracking-[-0.025em] text-brand sm:text-32">Urgent help</h1>

        <Alert kind="error" icon="warning" live={false} className="mt-5">
          <h2 className="text-17 font-semibold">If anyone is in danger, call 112</h2>
          <p className="mt-1 text-15">112 is the national emergency number. You can call it from any network.</p>
          {canContactFirm && <p className="mt-1 text-15">Then contact {firm.name}.</p>}
          <a href="tel:112" className={buttonClasses("primary", "lg", "mt-4 w-full sm:w-auto")}>
            <Icon name="phone" size={18} />
            Call 112
          </a>
        </Alert>

        <section aria-labelledby="urgent-firm" className="mt-10">
          <h2 id="urgent-firm" className="font-heading text-21 font-semibold text-brand">
            Contact {firm.name}
          </h2>
          {canContactFirm ? (
            <>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                {phone?.href && (
                  <a href={phone.href} className={buttonClasses("ghost", "lg", "w-full sm:w-auto")}>
                    Call {firm.name} on {phone.text}
                  </a>
                )}
                {whatsapp?.href && (
                  <a href={whatsapp.href} className={buttonClasses("ghost", "lg", "w-full sm:w-auto")}>
                    Message {firm.name} on WhatsApp
                  </a>
                )}
                {email?.href && (
                  <a
                    href={email.href}
                    className={buttonClasses("ghost", "lg", "w-full [overflow-wrap:anywhere] sm:w-auto")}
                  >
                    Email {firm.name} at {email.text}
                  </a>
                )}
              </div>
              {unlinked.length > 0 && (
                <dl className="mt-4 space-y-1 text-15 text-ink">
                  {unlinked.map((row) => (
                    <div key={row.label} className="flex flex-wrap gap-x-2">
                      <dt className="font-semibold">{row.label}:</dt>
                      <dd className="[overflow-wrap:anywhere]">{row.text}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <p className="mt-4 text-15 text-ink-muted">
                Outside working hours, {firm.name} may not answer straight away. If anyone is in danger, call 112.
              </p>
            </>
          ) : (
            <p className="mt-3 text-15 text-ink">
              {firm.name} has not added a phone number or email to this site yet.
            </p>
          )}
        </section>

        <section aria-labelledby="urgent-situations" className="mt-10">
          <h2 id="urgent-situations" className="font-heading text-21 font-semibold text-brand">
            What is happening?
          </h2>
          <p className="mt-1 text-13 text-ink-muted">This is general information, not legal advice.</p>
          <div className="mt-4 space-y-3">
            {situations(firm.name, canContactFirm).map((s) => (
              <Disclosure key={s.id} summary={s.label}>
                <p className="text-13 text-ink-muted">Do these now, in this order.</p>
                <ol className="mt-2 list-decimal space-y-2 pl-5">
                  {s.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </Disclosure>
            ))}
          </div>
        </section>

        <section aria-labelledby="urgent-free-help" className="mt-10">
          <h2 id="urgent-free-help" className="font-heading text-21 font-semibold text-brand">
            Free help
          </h2>
          <ul className="mt-4 divide-y divide-hairline rounded-card border border-hairline bg-raised">
            {FREE_HELP.map((body) => (
              <li key={body.name} className="px-4 pt-3 pb-1">
                <p className="text-15 font-semibold text-ink">{body.name}</p>
                <p className="mt-0.5 text-15 text-ink">{body.what}</p>
                <a href={body.site} target="_blank" rel="noopener noreferrer" className={ROW_LINK}>
                  {body.link}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </section>

        <p className="mt-10 text-15 text-ink">
          Not urgent?{" "}
          <Link href={`/${firm.slug}/book`} className={ROW_LINK}>
            Book a consultation
          </Link>
        </p>
      </div>
    </div>
  );
}
