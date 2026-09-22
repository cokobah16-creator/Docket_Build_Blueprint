// The platform landing: what a Nigerian firm reads before it registers, what a
// client reads before their firm sends them a link, and what a court registry
// reads before it publishes a cause list.
//
// design/home/README.md governs this page. In short: light only; warm ground,
// never white; gold is a rule or a fill, never text on paper; the layout is
// asymmetric; the footer disclaims any affiliation with a court, the NBA or a
// government agency; and every concrete claim must be true of the code on the
// branch. There are no testimonials, logos, customer counts or percentages here
// because Docket has none it can stand behind.

import type { ReactNode } from "react";
import Link from "next/link";
import { isProductionDeployment, isSupabaseConfigured } from "@/lib/env";
import { Alert } from "@/components/ui/alert";

export const metadata = {
  title: "Docket — practice software for Nigerian law firms",
  description:
    "Manage matters, court dates, documents, clients and billing from one workspace, with a client portal your clients open on their phones.",
};

/** What each kind of user does in Docket. Each line is something the product does today. */
const ROLES: Array<{ id: string; role: string; summary: string; items: string[]; href: string; cta: string }> = [
  {
    id: "firms",
    role: "Law firms",
    summary: "The firm's working record: every matter, every court date, every document and every naira billed.",
    items: [
      "Matter register with suit numbers, courts, judicial divisions and the lawyer with conduct",
      "Court diary: sittings, deadlines computed from court rules, and a chase list for sittings nobody has reported",
      "Documents with versions, client visibility you control, signatures and requests for documents",
      "Tasks and next actions with owners and due dates",
      "Consultation booking, video consultations and Paystack payment to the firm's own account",
      "Invoices and receipts, and a service inbox for processes served on the firm",
    ],
    href: "/firm/start",
    cta: "Register your firm",
  },
  {
    id: "clients",
    role: "Clients",
    summary: "A plain-language view of their matter on their own phone, without calling the office to ask.",
    items: [
      "What happened last, what happens next, and the next court date",
      "Messages with the firm, attached to the matter",
      "Documents to read, download, upload or sign",
      "Invoices, online payment and receipts",
      "Consultation bookings and a calendar feed of court dates",
    ],
    href: "/app/login",
    cta: "Client sign in",
  },
  {
    id: "courts",
    role: "Court registries",
    summary: "A channel for a registry to publish its cause list, which reaches the diaries of the firms on each suit.",
    items: [
      "Stage a cause list from a file or row by row, then publish it",
      "Registrar and clerk roles, with two-factor sign-in",
      "Withdraw a listing with a reason, and every firm that relied on it sees the withdrawal",
    ],
    href: "/firm/login",
    cta: "Registry staff sign in",
  },
];

/** Controls that are built into the product. No certification is claimed because none is held. */
const CONTROLS: Array<[string, string]> = [
  ["Firm boundaries", "Every record belongs to a firm, and the database refuses reads and writes across firms. This is enforced by row-level security, not by hiding screens."],
  ["Restricted matters", "A sensitive matter can be limited to its own team, and the rest of the firm cannot open it."],
  ["Internal and client-visible", "Internal notes and client-visible updates are separate records. A client's portal never receives the internal ones."],
  ["Staff two-factor", "Every staff account signs in with a password and an authenticator app before it can change anything."],
  ["Payment confirmation", "A payment counts only when the payment provider confirms it to Docket directly, never because a browser was redirected."],
  ["Change history", "Changes to matters, documents, statuses and permissions are written to an audit log that ordinary users cannot edit."],
];

function SectionLabel({ children, pale = false }: { children: ReactNode; pale?: boolean }) {
  return (
    <p className={`text-11 font-semibold uppercase tracking-[0.12em] ${pale ? "text-docket-gold-pale" : "text-docket-link"}`}>
      {children}
    </p>
  );
}

/**
 * A sample of the matter register, drawn in HTML and labelled as a sample.
 * The names are invented and say so; no real person, firm or public body is used.
 */
function SampleRegister() {
  const rows = [
    ["Adeyemi v. Okoro Holdings Ltd", "LD/1482/2025", "High Court of Lagos State, Lagos Division", "Continuation of hearing", "14 Oct, 09:00"],
    ["Re: Estate of B. Nwosu (deceased)", "ID/PR/233/2026", "High Court of Lagos State, Ikeja Division", "Mention", "21 Oct, 10:00"],
    ["Bello Farms v. Northern Agro Supplies", "FHC/ABJ/CS/911/2026", "Federal High Court, Abuja", "Written address due", "28 Oct"],
  ];
  return (
    <figure className="min-w-0">
      <div className="overflow-hidden border border-docket-hair bg-docket-ivory">
        <div className="flex items-center justify-between border-b border-docket-hair bg-docket-sand px-4 py-2.5">
          <p className="text-13 font-semibold text-docket-ink">Matters · Upcoming hearings</p>
          <p className="text-11 text-docket-muted">3 matters</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-left text-13">
            <thead className="border-b border-docket-hair text-11 uppercase tracking-[0.06em] text-docket-muted">
              <tr>
                <th scope="col" className="px-4 py-2 font-semibold">Matter</th>
                <th scope="col" className="px-4 py-2 font-semibold">Suit no.</th>
                <th scope="col" className="px-4 py-2 font-semibold">Next</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-docket-hair text-docket-ink">
              {rows.map(([title, suit, court, purpose, when]) => (
                <tr key={suit} className="align-top">
                  <td className="px-4 py-2.5">
                    <span className="font-semibold">{title}</span>
                    <span className="block text-11 text-docket-muted">{court}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-13">{suit}</td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    {when}
                    <span className="block text-11 text-docket-muted">{purpose}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <figcaption className="mt-2 text-11 text-docket-muted">
        Sample data. Illustrates the matter register; names and suit numbers are invented.
      </figcaption>
    </figure>
  );
}

export default function PlatformLanding() {
  const configured = isSupabaseConfigured();
  const production = isProductionDeployment();
  const showRoutingNote = configured && !production;

  return (
    <div data-theme-scope="light" className="platform-site min-h-screen bg-docket-paper text-docket-ink">
      <header className="border-b border-white/10 bg-docket-hunter text-white">
        <div className="mx-auto flex min-h-[64px] max-w-[1200px] items-center justify-between gap-5 px-5 sm:px-8">
          <Link href="/" className="text-21 font-semibold tracking-[-0.01em]">Docket</Link>
          <nav aria-label="Primary" className="hidden items-center gap-6 text-13 text-white/80 lg:flex">
            <a href="#firms" className="hover:text-white">Law firms</a>
            <a href="#clients" className="hover:text-white">Clients</a>
            <a href="#courts" className="hover:text-white">Court registries</a>
            <a href="#security" className="hover:text-white">Security</a>
            <a href="#pricing" className="hover:text-white">Pricing</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/app/login" className="hidden min-h-[44px] items-center px-3 text-13 font-semibold text-white/85 hover:text-white sm:inline-flex">
              Client sign in
            </Link>
            <Link href="/firm/login" className="hidden min-h-[44px] items-center px-3 text-13 font-semibold text-white/85 hover:text-white md:inline-flex">
              Staff sign in
            </Link>
            <Link href="/firm/start" className="inline-flex min-h-[44px] items-center bg-docket-gold px-4 text-13 font-semibold text-docket-deep hover:bg-docket-gold-pale">
              Register your firm
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="border-b border-docket-hair">
          <div className="mx-auto grid max-w-[1200px] gap-12 px-5 py-14 sm:px-8 sm:py-20 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <SectionLabel>Practice software for Nigerian law firms</SectionLabel>
              <h1 className="mt-4 max-w-[18ch] text-44 font-semibold leading-[1.05] tracking-[-0.02em] text-docket-hunter sm:text-56">
                Manage matters, court dates, documents and clients in one workspace.
              </h1>
              <p className="mt-5 max-w-[56ch] text-17 leading-7 text-docket-muted-dark">
                Docket keeps a firm&apos;s matter register, court diary, documents and billing together, and gives
                each client a portal on their phone that shows where their matter stands.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href="/firm/start" className="inline-flex min-h-[48px] items-center bg-docket-link px-5 text-15 font-semibold text-white hover:bg-docket-hunter">
                  Register your firm
                </Link>
                <Link href="/app/login" className="inline-flex min-h-[48px] items-center border border-docket-edge px-5 text-15 font-semibold text-docket-hunter hover:bg-docket-ivory">
                  Client sign in
                </Link>
              </div>
              <p className="mt-4 max-w-[56ch] text-13 text-docket-muted">
                A new firm&apos;s workspace opens straight away. Its public booking site opens once Docket has verified
                the firm&apos;s registration and the owner&apos;s enrolment.
              </p>
            </div>
            <SampleRegister />
          </div>
        </section>

        <section aria-labelledby="roles-heading" className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-20">
          <SectionLabel>Who uses Docket</SectionLabel>
          <h2 id="roles-heading" className="mt-3 max-w-[30ch] text-26 font-semibold leading-tight tracking-[-0.01em] text-docket-hunter">
            One record, seen three ways: by the firm, by its clients and by the court registry.
          </h2>
          <div className="mt-8 border-t-4 border-docket-hunter">
            {ROLES.map((r) => (
              <section key={r.id} id={r.id} aria-labelledby={`${r.id}-h`} className="grid scroll-mt-6 gap-4 border-b border-docket-hair py-8 lg:grid-cols-[240px_minmax(0,1fr)_200px]">
                <div>
                  <h3 id={`${r.id}-h`} className="text-21 font-semibold text-docket-hunter">{r.role}</h3>
                  <p className="mt-2 text-13 leading-5 text-docket-muted-dark">{r.summary}</p>
                </div>
                <ul className="grid gap-x-8 gap-y-2 text-15 leading-6 text-docket-ink sm:grid-cols-2">
                  {r.items.map((item) => (
                    <li key={item} className="border-l-[3px] border-docket-gold pl-3">{item}</li>
                  ))}
                </ul>
                <div className="lg:text-right">
                  <Link href={r.href} className="inline-flex min-h-[44px] items-center text-13 font-semibold text-docket-link underline underline-offset-4 hover:text-docket-hunter">
                    {r.cta}
                  </Link>
                </div>
              </section>
            ))}
          </div>
        </section>

        <section id="security" className="bg-docket-hunter text-white">
          <div className="mx-auto grid max-w-[1200px] gap-10 px-5 py-14 sm:px-8 sm:py-20 lg:grid-cols-[0.7fr_1.3fr]">
            <div>
              <SectionLabel pale>Security and data</SectionLabel>
              <h2 className="mt-3 max-w-[20ch] text-26 font-semibold leading-tight tracking-[-0.01em]">
                How client records are protected.
              </h2>
              <p className="mt-4 max-w-[44ch] text-15 leading-6 text-white/80">
                These controls are built into the product. Docket does not hold a security certification and
                does not claim one. Each firm&apos;s privacy notice and terms are published on its own site.
              </p>
            </div>
            <dl className="grid gap-x-10 border-t border-white/15 sm:grid-cols-2">
              {CONTROLS.map(([title, body]) => (
                <div key={title} className="border-b border-white/15 py-5">
                  <dt className="text-15 font-semibold">{title}</dt>
                  <dd className="mt-1.5 text-13 leading-5 text-white/75">{body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section id="pricing" className="border-b border-docket-hair bg-docket-sand-deep">
          <div className="mx-auto grid max-w-[1200px] gap-8 px-5 py-14 sm:px-8 sm:py-16 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <SectionLabel>Pricing</SectionLabel>
              <h2 className="mt-3 max-w-[30ch] text-26 font-semibold leading-tight tracking-[-0.01em] text-docket-hunter">
                Free while Docket is in build. No card required.
              </h2>
              <p className="mt-3 max-w-[64ch] text-15 text-docket-muted-dark">
                Pricing for solo practitioners, firms, institutional legal teams and courts has not been set.
                Firms using Docket now will be told what it costs before anything is charged. Payments a client
                makes to a firm go to the firm&apos;s own Paystack account.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
              <Link href="/firm/start" className="inline-flex min-h-[48px] items-center justify-center bg-docket-link px-6 text-15 font-semibold text-white hover:bg-docket-hunter">
                Register your firm
              </Link>
              <Link href="/firm/login" className="inline-flex min-h-[48px] items-center justify-center border border-docket-edge px-6 text-15 font-semibold text-docket-hunter hover:bg-docket-ivory">
                Staff sign in
              </Link>
            </div>
          </div>
        </section>

        {!configured && !production && (
          <div className="mx-auto max-w-[1200px] px-5 py-10 sm:px-8">
            <Alert kind="warning" title="Supabase is not configured yet">
              Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in the hosting environment, then apply the migrations from <code>supabase/</code>.
            </Alert>
          </div>
        )}
      </main>

      <footer className="border-t-[3px] border-docket-gold bg-docket-deep text-white">
        <div className="mx-auto grid max-w-[1200px] gap-10 px-5 py-12 sm:px-8 md:grid-cols-[1.5fr_1fr_1fr]">
          <div>
            <p className="text-21 font-semibold tracking-[-0.01em]">Docket</p>
            <p className="mt-3 max-w-[40ch] text-13 leading-5 text-white/70">
              Practice software for law firms, their clients and court registries, built first for Nigerian practice.
            </p>
          </div>
          <div>
            <p className="text-11 font-semibold uppercase tracking-[0.12em] text-docket-gold-pale">Law firms</p>
            <div className="mt-4 flex flex-col gap-1 text-13 text-white/75">
              <Link href="/firm/start" className="inline-flex min-h-[44px] items-center hover:text-white">Register your firm</Link>
              <Link href="/firm/login" className="inline-flex min-h-[44px] items-center hover:text-white">Staff sign in</Link>
            </div>
          </div>
          <div>
            <p className="text-11 font-semibold uppercase tracking-[0.12em] text-docket-gold-pale">Clients</p>
            <div className="mt-4 flex flex-col gap-1 text-13 text-white/75">
              <Link href="/app/login" className="inline-flex min-h-[44px] items-center hover:text-white">Client sign in</Link>
              <p className="text-13 text-white/65">Your firm sends you the link to its own site.</p>
            </div>
          </div>
        </div>
        <div className="border-t border-white/10">
          <div className="mx-auto flex max-w-[1200px] flex-wrap justify-between gap-4 px-5 py-6 text-11 text-white/65 sm:px-8">
            <p>
              © {new Date().getFullYear()} Docket · Private software. Not affiliated with any court, the Nigerian Bar
              Association or any government agency.
            </p>
            {showRoutingNote && <p>Development tenant routing is available with <code>?firm=&lt;slug&gt;</code>.</p>}
          </div>
        </div>
      </footer>
    </div>
  );
}
