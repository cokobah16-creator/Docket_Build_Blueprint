// Docket platform landing. A request lands here only when no tenant was
// resolved (the middleware rewrites firm hosts onto /[firm]). Docket is the
// platform; every law firm on it is a tenant with its own site, portal and
// console — nothing here belongs to any one firm.
//
// This page is Docket's own surface, so it uses the docket-* palette from
// tailwind.config.ts rather than the brand-* tenant tokens. A firm choosing a
// brand colour must never be able to repaint the platform's own pages. The
// design, the palette and the type ramp are documented in design/home/.

import type { ReactNode } from "react";
import Link from "next/link";
import { Archivo, Fraunces } from "next/font/google";
import { isSupabaseConfigured } from "@/lib/env";
import { Alert } from "@/components/ui/alert";

const archivo = Archivo({ subsets: ["latin"], display: "swap" });

// Only ever used inside the two exhibit panels, where the point is that each
// firm brings its own typeface.
const fraunces = Fraunces({ subsets: ["latin"], display: "swap" });

export const metadata = {
  title: "Docket — one app, every matter, any firm",
  description:
    "The client experience platform for Nigerian law firms: a branded firm site, online booking, Paystack checkout, matters against the real court hierarchy and service of process — for firms, their clients and the courts.",
};

const AUDIENCES = [
  {
    kicker: "For firms",
    title: "Your own site, console and ledger of matters",
    body:
      "A branded public site with online booking, prepaid consultations that settle to your own account, matters recorded against the real court hierarchy, documents, messaging and invoicing — from one console, on any phone.",
    href: "/firm/start",
    cta: "Register your firm",
  },
  {
    kicker: "For clients",
    title: "See what has happened, and what is next",
    body:
      "Book, pay, and meet your lawyer face to face from your phone. Every entry your firm posts — sittings, filings, fees — lands on one timeline in plain language, and the app stays yours whichever firms act for you.",
    href: "/app/login",
    cta: "Client sign in",
  },
  {
    kicker: "For counsel on the other side",
    title: "Process served, receipt acknowledged",
    body:
      "Matters recorded against the real Nigerian court hierarchy, each court showing the suit-number shape it uses. Sittings with no update posted are flagged for the firm to chase. Court processes are served on the other side’s counsel with an acknowledged proof of service.",
    href: "/firm/login",
    cta: "Staff sign in",
  },
];

// Each of these is a rule the schema enforces, not a habit anyone has to
// remember. Keep them true: every line here is checkable against supabase/.
const FLOWS = [
  {
    n: "01",
    title: "Booking & payment",
    lede:
      "Slots are computed in the lawyer’s own timezone, less breaks, exceptions, live appointments and the daily cap, with a two-hour lead time. The slot is held for fifteen minutes while the client pays.",
    points: [
      "Checkout is initialised against the firm’s own Paystack subaccount, and the subaccount bears the charge.",
      "The webhook is the only thing that confirms a payment, and it is idempotent on the provider reference.",
      "A payment settled elsewhere is recorded as failed, audited, and reported to the firm for reconciliation.",
    ],
  },
  {
    n: "02",
    title: "Matters & court updates",
    lede:
      "One entry — the outcome, the next date and its purpose. Docket composes the client entry and the internal note together, closes the day’s sitting and opens the next against the court, the judge and the courtroom.",
    points: [
      "A next date falling on a weekend, a public holiday, or a vacation published by that court is refused.",
      "Internal notes carry no client policy at all, so they cannot reach the client.",
      "Timestamps are held in UTC and rendered in the reader’s own zone.",
    ],
  },
  {
    n: "03",
    title: "Service of process",
    lede:
      "Service through the platform is pinned to the exact document version and its checksum, with the cause title and suit number snapshotted at the moment of service.",
    points: [
      "The served firm sees the record and that one version — never the matter, the roster or a later version.",
      "Platform service requires the other firm’s opt-in; an originating process requires counsel’s undertaking or an order.",
      "Acknowledgement by a practitioner is timestamped and named, and a wrong service is withdrawn at once.",
    ],
  },
];

// The same component, rendered twice. These are illustrations of per-tenant
// branding, so the colours are each firm's own rather than Docket's.
const EXHIBITS = [
  {
    firm: "Attorneys Klinique",
    ink: "#0F2A44",
    accent: "#B08D57",
    onAccent: "#896c40",
    surface: "#F7F5F0",
    cause: "Adeyemi v. Lagos State Lands Bureau",
    ref: "AK-M-2026-000014",
    court: "High Court of Lagos State, Ikeja Judicial Division",
    suit: "ID/4471GCM/2026",
    next: "6 Oct 2026, 09:00 · Continuation of hearing",
  },
  {
    firm: "Bello & Co",
    ink: "#5B2333",
    accent: "#7D8471",
    onAccent: "#6a7060",
    surface: "#F4F1EC",
    cause: "Okonkwo v. Eze",
    ref: "BC-M-2026-000008",
    court: "Federal High Court, Lagos Judicial Division",
    suit: "FHC/L/CS/77/2026",
    next: "14 Oct 2026, 09:00 · Hearing of the motion",
  },
];

const SETTLEMENT = [
  ["Slot held", "Fifteen minutes, and an invoice issued with VAT where the firm is registered to charge it."],
  ["Checkout", "Initialised with the firm’s subaccount, the subaccount bearing the charge."],
  ["Webhook", "The only thing that confirms a payment. Nothing the browser reports is trusted."],
  ["Applied once", "Idempotent on the provider reference, so a retried webhook cannot double-credit."],
];

const FOOTER_LINKS = [
  {
    heading: "Platform",
    links: [
      { label: "Register your firm", href: "/firm/start" },
      { label: "Staff sign in", href: "/firm/login" },
    ],
  },
  { heading: "Clients", links: [{ label: "Client sign in", href: "/app/login" }] },
  { heading: "Firm sites", links: [{ label: "Open a firm site", href: "/?firm=demo" }] },
];

function Kicker({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${className}`}>{children}</p>
  );
}

function ChapterRule() {
  return <div className="h-1 bg-docket-hunter" />;
}

export default function PlatformLanding() {
  const configured = isSupabaseConfigured();

  return (
    <div className={`${archivo.className} min-h-screen bg-docket-paper text-docket-ink`}>
      <header className="border-b border-docket-hair">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-8">
          <div className="flex items-baseline gap-3">
            <span className="text-[21px] font-extrabold tracking-[-0.03em]">Docket</span>
            <Kicker className="hidden text-docket-muted sm:block">Legal practice platform</Kicker>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[15px]">
            <Link href="/app/login" className="py-2 text-docket-muted-dark hover:text-docket-hunter">
              Sign in
            </Link>
            <Link
              href="/firm/start"
              className="inline-flex min-h-[44px] items-center bg-docket-hunter px-6 text-[15px] font-semibold text-docket-paper hover:bg-docket-deep"
            >
              Register your firm
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* Hero. The breaks are hand-set: at this size the browser's greedy
            wrap orphans a single word. See design/home/README.md. */}
        <section className="mx-auto max-w-[1240px] px-4 pb-16 pt-16 sm:px-8 sm:pb-24 sm:pt-28">
          <div className="mb-5 h-[3px] w-16 bg-docket-gold" />
          <Kicker className="mb-6 text-docket-hunter">Nigeria · practice, clients, counsel</Kicker>
          <h1 className="text-[26px] font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-[56px] sm:leading-[0.98] sm:tracking-[-0.035em] lg:text-[88px]">
            One record of the matter.
            <br className="hidden sm:block" />{" "}
            For the firm, the client
            <br className="hidden sm:block" />{" "}
            and the counsel
            <br className="hidden sm:block" />{" "}
            on the other side.
          </h1>
          <p className="mt-8 max-w-[58ch] text-[15px] leading-[1.5] text-docket-muted-dark sm:text-[21px]">
            Docket is the practice platform Nigerian firms run their client work on — bookings,
            fees, consultations, matters and service of process — and the one app their clients
            keep, whichever firms act for them.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-5">
            <Link
              href="/firm/start"
              className="inline-flex min-h-[44px] items-center bg-docket-hunter px-7 text-[15px] font-semibold text-docket-paper hover:bg-docket-deep"
            >
              Register your firm
            </Link>
            <p className="text-[13px] text-docket-muted">
              Free while Docket is in build. No card.
            </p>
          </div>
        </section>

        {/* Three audiences */}
        <section className="mx-auto max-w-[1240px] px-4 pb-16 sm:px-8 sm:pb-24">
          <ChapterRule />
          <div className="grid md:grid-cols-3">
            {AUDIENCES.map((a, i) => (
              <div
                key={a.kicker}
                className={`flex flex-col gap-3.5 py-9 md:py-9 ${
                  i === 0 ? "md:pr-9" : i === 1 ? "md:px-9" : "md:pl-9"
                } ${i < 2 ? "border-b border-docket-hair md:border-b-0 md:border-r" : ""}`}
              >
                <Kicker className="text-docket-hunter">{a.kicker}</Kicker>
                <h2 className="text-[26px] font-extrabold leading-[1.15] tracking-[-0.015em]">
                  {a.title}
                </h2>
                <p className="flex-1 text-[15px] text-docket-muted-dark">{a.body}</p>
                <Link
                  href={a.href}
                  className="mt-2 inline-flex min-h-[44px] w-fit items-center border border-docket-hunter px-5 text-[13px] font-semibold text-docket-hunter hover:bg-docket-hunter hover:text-docket-paper"
                >
                  {a.cta}
                </Link>
              </div>
            ))}
          </div>
        </section>

        {/* The three flows */}
        <section className="mx-auto max-w-[1240px] px-4 sm:px-8">
          <div className="flex flex-wrap items-baseline justify-between gap-8 border-t border-docket-hair pt-8">
            <h2 className="text-[26px] font-extrabold leading-[1.05] tracking-[-0.025em] sm:text-[44px]">
              What the platform does, precisely
            </h2>
            <p className="max-w-[40ch] text-[13px] text-docket-muted">
              Three flows carry the practice. Each one is a rule in the schema, not a habit anyone
              has to remember.
            </p>
          </div>

          {FLOWS.map((f) => (
            <article key={f.n} className="pb-12">
              <div className="mt-12 flex h-[3px] items-center">
                <div className="h-[3px] w-44 bg-docket-gold" />
                <div className="h-px flex-1 bg-docket-hair" />
              </div>
              <div className="grid gap-8 pt-7 md:grid-cols-[176px_minmax(0,1fr)_minmax(0,1fr)]">
                <p className="text-[56px] font-extrabold leading-[0.85] tracking-[-0.04em] tabular-nums text-docket-hunter sm:text-[88px]">
                  {f.n}
                </p>
                <div>
                  <h3 className="text-[21px] font-extrabold leading-[1.2] sm:text-[26px]">
                    {f.title}
                  </h3>
                  <p className="mt-3 text-[15px] leading-[1.55] text-docket-muted-dark">{f.lede}</p>
                </div>
                <ul className="flex flex-col gap-3 text-[13px] text-docket-muted-dark">
                  {f.points.map((p, i) => (
                    <li
                      key={p}
                      className={i < f.points.length - 1 ? "border-b border-docket-hair pb-3" : ""}
                    >
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </section>

        {/* Exhibit: the same screen, in two firms' brands */}
        <section className="bg-docket-hunter text-docket-paper">
          <div className="mx-auto max-w-[1240px] px-4 py-16 sm:px-8 sm:py-28">
            <div className="mb-5 h-[3px] w-16 bg-docket-gold" />
            <Kicker className="text-docket-gold-pale">Exhibit</Kicker>
            <div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1fr)_380px]">
              <div>
                <h2 className="max-w-[22ch] text-[26px] font-extrabold leading-[1.05] tracking-[-0.025em] sm:text-[44px]">
                  Every firm’s app carries the firm’s own name and colours
                </h2>
                <p className="mt-6 max-w-[46ch] text-[15px] leading-[1.5] sm:text-[21px]">
                  One codebase, one record of the matter — and a client who opens their lawyer’s
                  brand, not ours. Colours and typeface come from the firm’s own record, not from a
                  theme we ship.
                </p>
              </div>
            </div>

            <div className="mt-10 grid gap-6 md:grid-cols-2">
              {EXHIBITS.map((e) => (
                <figure key={e.firm} className="m-0">
                  <div
                    className="border-2 border-docket-ink p-5"
                    style={{ backgroundColor: e.surface, color: "#1f2937" }}
                  >
                    <p
                      className={`${fraunces.className} text-[21px] font-semibold leading-[1.2]`}
                      style={{ color: e.ink }}
                    >
                      {e.cause}
                    </p>
                    <p className="mt-1 text-[13px] text-[#6b6762]">
                      {e.ref} · {e.firm}
                    </p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] text-[#4b5563]">
                      <span
                        className="rounded-full border px-2.5 py-0.5 font-medium"
                        style={{ borderColor: e.accent, color: e.onAccent }}
                      >
                        In court
                      </span>
                      <span>
                        {e.court} · {e.suit}
                      </span>
                    </div>
                    <p className="mt-2.5 text-[13px]">
                      Next court date: <strong className="font-semibold">{e.next}</strong>
                    </p>
                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {["Timeline", "Documents", "Messages", "Invoices"].map((t, i) => (
                        <span
                          key={t}
                          className="rounded-full border px-2.5 py-1 text-[13px]"
                          style={
                            i === 0
                              ? { backgroundColor: e.ink, borderColor: e.ink, color: "#ffffff" }
                              : { borderColor: "#d8d4ce", color: "#374151" }
                          }
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                    <div className="mt-3 rounded-xl border border-[#e3e0dc] bg-white p-4">
                      <p className="text-[13px] font-medium text-[#111827]">
                        Adjourned for continuation
                      </p>
                      <p className="mt-1 text-[13px] leading-[1.45] text-[#374151]">
                        The court took the claimant’s second witness and adjourned for continuation
                        of hearing.
                      </p>
                      <p className="mt-1.5 text-[11px] text-[#716e68]">14 Sept 2026, 13:42</p>
                    </div>
                  </div>
                  <figcaption className="mt-3 text-[11px] text-docket-gold-pale">
                    {e.firm} — the same matter screen, in that firm’s own brand.
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        {/* What it costs, and where the client's fee goes */}
        <section className="mx-auto max-w-[1240px] px-4 pt-16 sm:px-8 sm:pt-24">
          <ChapterRule />
          <div className="flex flex-wrap items-baseline justify-between gap-8 pt-8">
            <h2 className="text-[26px] font-extrabold leading-[1.05] tracking-[-0.025em] sm:text-[44px]">
              What Docket costs,
              <br />
              and where your client’s fee goes
            </h2>
            <p className="max-w-[40ch] text-[13px] text-docket-muted">
              <strong className="font-semibold text-docket-ink">
                Docket is free while it is in build. No card, no trial clock.
              </strong>{" "}
              Pricing will be published here before any firm is billed. Your client’s fee is a
              separate matter: a booking initialises a checkout against the firm’s own subaccount,
              and Paystack settles to the firm.
            </p>
          </div>

          <div className="mt-11 grid border-t border-docket-hair sm:grid-cols-2 lg:grid-cols-4">
            {SETTLEMENT.map(([title, body], i) => (
              <div
                key={title}
                className={`flex flex-col gap-2 py-6 lg:pr-7 ${i > 0 ? "lg:pl-7" : ""} ${
                  i < SETTLEMENT.length - 1 ? "border-b border-docket-hair lg:border-b-0 lg:border-r" : ""
                }`}
              >
                <Kicker className="text-docket-muted">Step {i + 1}</Kicker>
                <h3 className="text-[21px] font-extrabold leading-[1.2]">{title}</h3>
                <p className="text-[13px] text-docket-muted-dark">{body}</p>
              </div>
            ))}
          </div>

          <div className="border-t border-docket-hair">
            <div className="mt-6 h-[3px] w-16 bg-docket-gold" />
            <div className="flex flex-wrap items-baseline gap-6 pb-6 pt-3.5">
              <Kicker className="shrink-0 text-docket-hunter">Exception</Kicker>
              <p className="max-w-[82ch] text-[13px] text-docket-muted-dark">
                <strong className="font-semibold">Settled elsewhere?</strong> The payment is
                recorded as failed, audited, and reported to the firm for reconciliation. It
                confirms nothing, and the client is never told a fee has been received when it has
                not.
              </p>
            </div>
          </div>
        </section>

        {/* Close */}
        <section className="mt-16 bg-docket-deep text-docket-paper sm:mt-24">
          <div className="mx-auto grid max-w-[1240px] gap-10 px-4 py-16 sm:px-8 sm:py-24 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-center">
            <div>
              <div className="mb-5 h-[3px] w-16 bg-docket-gold" />
              <h2 className="max-w-[16ch] text-[26px] font-extrabold leading-[1.02] tracking-[-0.03em] sm:text-[44px] lg:text-[56px]">
                Your own matters, on the screen.
              </h2>
              <p className="mt-6 max-w-[46ch] text-[15px] leading-[1.5] sm:text-[21px]">
                Register the firm yourself — the console works the moment you finish, and your
                public booking site comes with it.
              </p>
            </div>
            <div className="flex flex-col gap-4">
              <Link
                href="/firm/start"
                className="inline-flex min-h-[52px] items-center justify-center bg-docket-gold px-7 text-[15px] font-extrabold tracking-[-0.01em] text-docket-ink hover:bg-docket-gold-pale"
              >
                Register your firm
              </Link>
              <Link
                href="/app/login"
                className="inline-flex min-h-[52px] items-center justify-center border border-docket-paper/40 px-7 text-[15px] font-semibold text-docket-paper hover:border-docket-paper"
              >
                Client sign in
              </Link>
              <p className="text-[13px] text-docket-gold-pale">
                Fees settle to the firm’s own Paystack account. Docket never holds client money.
              </p>
            </div>
          </div>
        </section>

        {!configured && (
          <div className="mx-auto max-w-[1240px] px-4 py-10 sm:px-8">
            <Alert kind="warning" title="Supabase is not configured yet">
              Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
              <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> (see <code>.env.example</code>) in the
              hosting environment, apply the migrations from <code>supabase/</code>, and firm
              registration, the firm sites, client portal and staff console come alive.
            </Alert>
          </div>
        )}
      </main>

      <footer className="border-t-4 border-docket-gold bg-docket-paper">
        <div className="mx-auto grid max-w-[1240px] gap-10 px-4 py-14 sm:px-8 md:grid-cols-[1.5fr_repeat(3,1fr)]">
          <div>
            <p className="text-[21px] font-extrabold tracking-[-0.03em]">Docket</p>
            <Kicker className="mt-2 text-docket-muted">Legal practice platform</Kicker>
            <p className="mt-4 max-w-[38ch] text-[13px] text-docket-muted-dark">
              Built in Lagos for Nigerian practice — the courts your matters sit in, the fees that
              must reach your own account, and the client abroad with a matter back home.
            </p>
          </div>
          {FOOTER_LINKS.map((group) => (
            <div key={group.heading}>
              <Kicker className="text-docket-muted">{group.heading}</Kicker>
              <ul className="mt-4 flex flex-col gap-3 text-[13px]">
                {group.links.map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className="text-docket-link hover:text-docket-hunter">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-docket-hair">
          <div className="mx-auto flex max-w-[1240px] flex-wrap justify-between gap-4 px-4 py-6 text-[11px] text-docket-muted sm:px-8">
            <p className="max-w-[88ch]">
              © 2026 Docket · a private software company. Not affiliated with, endorsed by, or
              acting for any court, the Nigerian Bar Association, or any government agency.
            </p>
            {configured && (
              <p>
                Firm sites are served from their own domain or <code>{"{slug}"}.docket.app</code>.
                On a preview deployment open a firm with <code>?firm=&lt;slug&gt;</code>.
              </p>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
