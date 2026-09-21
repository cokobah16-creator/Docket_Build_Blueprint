import type { ReactNode } from "react";
import Link from "next/link";
import { isProductionDeployment, isSupabaseConfigured } from "@/lib/env";
import { Alert } from "@/components/ui/alert";

export const metadata = {
  title: "Docket — the legal practice operating system",
  description:
    "Run matters, court dates, consultations, documents, billing and client communication from one professional workspace built for Nigerian legal practice.",
};

const WORKFLOWS = [
  {
    number: "01",
    label: "Client intake",
    title: "From first enquiry to a paid consultation.",
    body: "Give every firm a branded site, structured intake and live booking. The client chooses a service, a lawyer and a time without waiting for a callback.",
    meta: "Booking · Intake · Paystack",
  },
  {
    number: "02",
    label: "Matter operations",
    title: "One durable record for the life of the matter.",
    body: "Keep parties, documents, tasks, court events, internal notes and client-visible updates attached to the same file and firm context.",
    meta: "Matters · Deadlines · Documents",
  },
  {
    number: "03",
    label: "Client service",
    title: "Make progress visible without constant phone calls.",
    body: "Clients see the next date, latest update, outstanding invoice and conversation in plain language through one mobile-ready portal.",
    meta: "Portal · Messages · Payments",
  },
] as const;

const CONTROLS = [
  ["Firm boundaries", "Every record stays scoped to the firm and matter it belongs to."],
  ["Staff assurance", "The console requires staff membership and two-factor authentication."],
  ["Payment integrity", "Provider webhooks confirm payment; browser redirects do not."],
  ["Client visibility", "Internal notes and client-visible updates are separate by design."],
] as const;

function Eyebrow({ children, pale = false }: { children: ReactNode; pale?: boolean }) {
  return (
    <p
      className={`text-11 font-semibold uppercase tracking-[0.17em] ${
        pale ? "text-docket-gold-pale" : "text-docket-link"
      }`}
    >
      {children}
    </p>
  );
}

function PracticePreview() {
  return (
    <div className="platform-preview relative overflow-hidden border border-docket-hair bg-docket-ivory shadow-[0_28px_80px_rgba(7,18,29,0.18)]">
      <div className="flex items-center justify-between border-b border-white/10 bg-docket-hunter px-5 py-4 text-white">
        <div>
          <p className="font-heading text-21 tracking-[-0.03em]">Docket</p>
          <p className="mt-0.5 text-11 uppercase tracking-[0.12em] text-white/60">Practice command</p>
        </div>
        <span className="rounded-full border border-white/20 px-3 py-1 text-11 text-white/80">Live workspace</span>
      </div>

      <div className="grid sm:grid-cols-[126px_minmax(0,1fr)]">
        <div className="hidden border-r border-docket-hair bg-docket-sand p-4 sm:block">
          <p className="text-11 font-semibold uppercase tracking-[0.12em] text-docket-muted">Workspace</p>
          <div className="mt-4 space-y-2 text-13">
            <p className="border-l-2 border-docket-gold bg-white/70 px-3 py-2 font-semibold text-docket-hunter">Today</p>
            <p className="px-3 py-2 text-docket-muted-dark">Matters</p>
            <p className="px-3 py-2 text-docket-muted-dark">Clients</p>
            <p className="px-3 py-2 text-docket-muted-dark">Messages</p>
            <p className="px-3 py-2 text-docket-muted-dark">Invoices</p>
          </div>
        </div>

        <div className="min-w-0 p-4 sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-docket-hair pb-4">
            <div>
              <p className="text-11 font-semibold uppercase tracking-[0.12em] text-docket-muted">Monday brief</p>
              <p className="mt-1 font-heading text-26 tracking-[-0.025em] text-docket-ink">Today at the practice</p>
            </div>
            <span className="text-11 font-semibold text-docket-link">3 items need attention</span>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {[
              ["Court diary", "09:00", "Okafor v. Meridian Estates", "High Court · Hearing"],
              ["Deadline", "Today", "File written address", "Due before close"],
              ["Client message", "Unread", "Adebayo property file", "Documents received"],
            ].map(([type, value, title, detail]) => (
              <article key={type} className="border border-docket-hair bg-white p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-11 font-semibold uppercase tracking-[0.1em] text-docket-muted">{type}</p>
                  <span className="text-11 font-semibold text-docket-link">{value}</span>
                </div>
                <p className="mt-5 text-13 font-semibold leading-5 text-docket-ink">{title}</p>
                <p className="mt-1 text-11 text-docket-muted">{detail}</p>
              </article>
            ))}
          </div>

          <div className="mt-3 border border-docket-hair bg-white">
            <div className="grid grid-cols-[1fr_auto] gap-4 border-b border-docket-hair px-4 py-3 text-11 font-semibold uppercase tracking-[0.1em] text-docket-muted">
              <span>Active matter</span>
              <span>Next action</span>
            </div>
            <div className="grid grid-cols-[1fr_auto] items-center gap-4 px-4 py-4">
              <div className="min-w-0">
                <p className="truncate font-heading text-17 text-docket-ink">Adeyemi v. Lagos State Lands Bureau</p>
                <p className="mt-1 text-11 text-docket-muted">AK-M-2026-000014 · In court</p>
              </div>
              <p className="text-right text-11 font-semibold text-docket-link">Prepare witness</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PlatformLanding() {
  const configured = isSupabaseConfigured();
  const showRoutingNote = configured && !isProductionDeployment();

  return (
    <div data-theme-scope="light" className="platform-site min-h-screen bg-docket-paper text-docket-ink">
      <header className="platform-header sticky top-0 z-40 border-b border-white/10 bg-docket-hunter text-white">
        <div className="mx-auto flex min-h-[72px] max-w-[1280px] items-center justify-between gap-5 px-5 sm:px-8">
          <Link href="/" className="flex items-baseline gap-3">
            <span className="font-heading text-26 tracking-[-0.045em]">Docket</span>
            <span className="hidden text-11 font-semibold uppercase tracking-[0.14em] text-white/55 sm:inline">Legal OS</span>
          </Link>
          <nav aria-label="Primary" className="hidden items-center gap-7 text-13 text-white/75 lg:flex">
            <a href="#product" className="hover:text-white">Product</a>
            <a href="#client-experience" className="hover:text-white">Client experience</a>
            <a href="#control" className="hover:text-white">Control</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link href="/app/login" className="hidden min-h-[44px] items-center px-3 text-13 font-semibold text-white/80 hover:text-white sm:inline-flex">
              Sign in
            </Link>
            <Link href="/firm/start" className="inline-flex min-h-[44px] items-center bg-docket-gold px-4 text-13 font-bold text-docket-deep hover:bg-docket-gold-pale sm:px-5">
              Register your firm
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="platform-grid overflow-hidden border-b border-docket-hair">
          <div className="mx-auto grid max-w-[1280px] gap-14 px-5 pb-16 pt-16 sm:px-8 sm:pb-24 sm:pt-24 lg:grid-cols-[0.82fr_1.18fr] lg:items-center lg:gap-16">
            <div>
              <Eyebrow>Built for Nigerian legal practice</Eyebrow>
              <h1 className="mt-6 max-w-[11ch] font-heading text-44 leading-[0.98] tracking-[-0.045em] text-docket-hunter sm:text-56 lg:text-88">
                Run the practice. Keep every matter in view.
              </h1>
              <p className="mt-7 max-w-[56ch] text-17 leading-7 text-docket-muted-dark sm:text-21 sm:leading-8">
                Docket brings intake, court work, documents, billing and client communication into one disciplined operating system for the firm.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Link href="/firm/start" className="inline-flex min-h-[52px] items-center bg-docket-link px-6 text-15 font-bold text-white hover:bg-docket-hunter">
                  Set up your practice
                </Link>
                <Link href="/app/login" className="inline-flex min-h-[52px] items-center border border-docket-edge bg-white/60 px-6 text-15 font-semibold text-docket-hunter hover:bg-white">
                  Open client portal
                </Link>
              </div>
              <p className="mt-4 text-11 text-docket-muted">Free while Docket is in build. No card required.</p>
            </div>
            <PracticePreview />
          </div>
        </section>

        <section aria-label="Platform principles" className="border-b border-docket-hair bg-docket-sand-deep">
          <div className="mx-auto grid max-w-[1280px] sm:grid-cols-2 lg:grid-cols-4">
            {["Matter-first records", "Nigerian court hierarchy", "Firm-owned settlement", "Mobile client access"].map((item, index) => (
              <p key={item} className={`px-5 py-5 text-13 font-semibold text-docket-hunter sm:px-8 ${index < 3 ? "border-b border-docket-hair lg:border-b-0 lg:border-r" : ""}`}>
                <span className="mr-3 font-heading text-docket-gold">0{index + 1}</span>{item}
              </p>
            ))}
          </div>
        </section>

        <section id="product" className="mx-auto max-w-[1280px] px-5 py-20 sm:px-8 sm:py-28">
          <div className="grid gap-8 border-b border-docket-hair pb-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
            <div>
              <Eyebrow>One operating system</Eyebrow>
              <h2 className="mt-5 max-w-[14ch] font-heading text-44 leading-[1.03] tracking-[-0.035em] text-docket-hunter sm:text-56">
                From first contact to final resolution.
              </h2>
            </div>
            <p className="max-w-[58ch] text-17 leading-7 text-docket-muted-dark lg:justify-self-end">
              Docket replaces the disconnected spreadsheet, WhatsApp thread, diary and payment screenshot with one matter-centred workflow.
            </p>
          </div>

          <div className="grid lg:grid-cols-3">
            {WORKFLOWS.map((flow, index) => (
              <article key={flow.number} className={`flex min-h-[390px] flex-col py-10 lg:px-9 ${index === 0 ? "lg:pl-0" : ""} ${index < 2 ? "border-b border-docket-hair lg:border-b-0 lg:border-r" : ""}`}>
                <div className="flex items-center justify-between gap-4">
                  <span className="font-heading text-44 leading-none text-docket-gold">{flow.number}</span>
                  <span className="text-11 font-semibold uppercase tracking-[0.13em] text-docket-link">{flow.label}</span>
                </div>
                <h3 className="mt-10 font-heading text-26 leading-8 tracking-[-0.02em] text-docket-hunter">{flow.title}</h3>
                <p className="mt-4 text-15 leading-6 text-docket-muted-dark">{flow.body}</p>
                <p className="mt-auto border-t border-docket-hair pt-5 text-11 font-semibold uppercase tracking-[0.1em] text-docket-muted">{flow.meta}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="client-experience" className="bg-docket-hunter text-white">
          <div className="mx-auto grid max-w-[1280px] gap-14 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[0.82fr_1.18fr] lg:items-center">
            <div>
              <Eyebrow pale>Client experience</Eyebrow>
              <h2 className="mt-5 max-w-[12ch] font-heading text-44 leading-[1.02] tracking-[-0.035em] sm:text-56">
                Less chasing. More confidence in what happens next.
              </h2>
              <p className="mt-6 max-w-[48ch] text-17 leading-7 text-white/75">
                Give clients a calm, useful view of the matter: the latest update, next court date, documents, messages and money — without exposing the firm’s internal work.
              </p>
              <Link href="/app/login" className="mt-8 inline-flex min-h-[48px] items-center border border-white/30 px-5 text-13 font-semibold text-white hover:border-white">
                View the client sign-in
              </Link>
            </div>

            <div className="border border-white/15 bg-docket-deep p-4 shadow-[0_28px_80px_rgba(0,0,0,0.24)] sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-5 border-b border-white/15 pb-5">
                <div>
                  <p className="text-11 font-semibold uppercase tracking-[0.13em] text-docket-gold-pale">Your matter</p>
                  <p className="mt-2 font-heading text-26">Adeyemi v. Lagos State Lands Bureau</p>
                  <p className="mt-1 text-13 text-white/55">AK-M-2026-000014 · In court</p>
                </div>
                <span className="border border-docket-gold/50 px-3 py-1.5 text-11 font-semibold text-docket-gold-pale">Next date confirmed</span>
              </div>
              <div className="grid gap-3 py-5 sm:grid-cols-3">
                {[["Next court date", "06 Oct", "Continuation of hearing"], ["Latest update", "14 Sept", "Witness testimony taken"], ["Your action", "None", "We will update you next"]].map(([label, value, detail]) => (
                  <div key={label} className="border border-white/15 bg-white/[0.04] p-4">
                    <p className="text-11 uppercase tracking-[0.1em] text-white/50">{label}</p>
                    <p className="mt-5 font-heading text-21 text-white">{value}</p>
                    <p className="mt-1 text-11 leading-4 text-white/60">{detail}</p>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 border-t border-white/15 pt-5 text-11 font-semibold">
                {["Timeline", "Documents", "Messages", "Invoices"].map((item, index) => (
                  <span key={item} className={index === 0 ? "bg-docket-gold px-3 py-2 text-docket-deep" : "border border-white/20 px-3 py-2 text-white/75"}>{item}</span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="control" className="mx-auto max-w-[1280px] px-5 py-20 sm:px-8 sm:py-28">
          <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <Eyebrow>Control by design</Eyebrow>
              <h2 className="mt-5 max-w-[12ch] font-heading text-44 leading-[1.03] tracking-[-0.035em] text-docket-hunter">
                Serious records need serious boundaries.
              </h2>
              <p className="mt-6 max-w-[44ch] text-15 leading-6 text-docket-muted-dark">
                Access rules, auditability and payment confirmation belong in the product’s structure — not in a checklist somebody has to remember.
              </p>
            </div>
            <div className="border-t border-docket-hair">
              {CONTROLS.map(([title, body], index) => (
                <div key={title} className="grid gap-3 border-b border-docket-hair py-6 sm:grid-cols-[56px_180px_1fr] sm:items-start">
                  <span className="font-heading text-21 text-docket-gold">0{index + 1}</span>
                  <h3 className="text-15 font-bold text-docket-hunter">{title}</h3>
                  <p className="text-13 leading-5 text-docket-muted-dark">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-docket-hair bg-docket-sand-deep">
          <div className="mx-auto grid max-w-[1280px] gap-10 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <Eyebrow>Start with the practice you have</Eyebrow>
              <h2 className="mt-4 max-w-[18ch] font-heading text-44 leading-[1.03] tracking-[-0.035em] text-docket-hunter">Put the next matter on a better system.</h2>
              <p className="mt-5 max-w-[60ch] text-15 text-docket-muted-dark">Create the firm, secure the owner account and open the console. The public booking site follows after firm verification.</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
              <Link href="/firm/start" className="inline-flex min-h-[52px] items-center justify-center bg-docket-link px-7 text-15 font-bold text-white hover:bg-docket-hunter">Register your firm</Link>
              <Link href="/firm/login" className="inline-flex min-h-[52px] items-center justify-center border border-docket-edge px-7 text-15 font-semibold text-docket-hunter hover:bg-white">Staff sign in</Link>
            </div>
          </div>
        </section>

        {!configured && (
          <div className="mx-auto max-w-[1280px] px-5 py-10 sm:px-8">
            <Alert kind="warning" title="Supabase is not configured yet">
              Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in the hosting environment, then apply the migrations from <code>supabase/</code>.
            </Alert>
          </div>
        )}
      </main>

      <footer className="border-t-4 border-docket-gold bg-docket-deep text-white">
        <div className="mx-auto grid max-w-[1280px] gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.5fr_1fr_1fr]">
          <div>
            <p className="font-heading text-26 tracking-[-0.04em]">Docket</p>
            <p className="mt-3 max-w-[40ch] text-13 leading-5 text-white/60">A legal practice operating system built around matters, clients and the realities of Nigerian practice.</p>
          </div>
          <div>
            <p className="text-11 font-semibold uppercase tracking-[0.13em] text-docket-gold-pale">Platform</p>
            <div className="mt-4 flex flex-col gap-3 text-13 text-white/70">
              <Link href="/firm/start" className="hover:text-white">Register your firm</Link>
              <Link href="/firm/login" className="hover:text-white">Staff sign in</Link>
            </div>
          </div>
          <div>
            <p className="text-11 font-semibold uppercase tracking-[0.13em] text-docket-gold-pale">Clients</p>
            <div className="mt-4 flex flex-col gap-3 text-13 text-white/70">
              <Link href="/app/login" className="hover:text-white">Client sign in</Link>
              <Link href="/firm/start" className="hover:text-white">Find your firm’s site</Link>
            </div>
          </div>
        </div>
        <div className="border-t border-white/10">
          <div className="mx-auto flex max-w-[1280px] flex-wrap justify-between gap-4 px-5 py-6 text-11 text-white/50 sm:px-8">
            <p>© {new Date().getFullYear()} Docket · Private software. Not affiliated with any court, bar association or government agency.</p>
            {showRoutingNote && <p>Development tenant routing is available with <code>?firm=&lt;slug&gt;</code>.</p>}
          </div>
        </div>
      </footer>
    </div>
  );
}
