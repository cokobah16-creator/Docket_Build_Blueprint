import Link from "next/link";
import type { ReactNode } from "react";
import { analyticsConfigured } from "@/lib/consent-cookie";
import { CookieSettingsButton } from "@/components/ui/cookie-banner";

// The side panel says what signing in will actually involve, step by step,
// rather than selling the product to somebody who is already at the door.
// Each line must stay true to the flow in src/components/auth/sign-in-forms.tsx
// (clients) and app/firm/(auth)/login (staff).
const COPY = {
  client: {
    eyebrow: "Client portal",
    title: "Sign in to follow your matter",
    body: "See your lawyer's updates, your next court date, documents to read or sign, messages and invoices.",
    steps: [
      ["Phone", "We text a 6-digit code to your number (or send it on WhatsApp). Type it in to sign in."],
      ["Email", "We email you a secure sign-in link. Open it on the same device to sign in."],
      ["Google", "You choose your Google account on Google's page and are brought straight back here."],
    ],
    note: "No password to remember. Use the phone number or email address your firm has for you.",
  },
  staff: {
    eyebrow: "Firm workspace",
    title: "Sign in to your firm's workspace",
    body: "For lawyers and staff of a firm on Docket. Clients sign in from the client portal instead.",
    steps: [
      ["Email and password", "The address your firm invited, and the password you set."],
      ["Second step", "A 6-digit code from your authenticator app. Every staff account needs one."],
      ["Your firm", "You land in your firm's workspace. Members of several firms can switch between them."],
    ],
    note: "Forgot your password? Ask for a reset link from the sign-in form.",
  },
} as const;

export function AuthFrame({
  audience,
  children,
}: {
  audience: keyof typeof COPY;
  children: ReactNode;
}) {
  const copy = COPY[audience];

  return (
    <div
      data-theme-scope="light"
      className="auth-frame min-h-[100dvh] bg-docket-paper text-docket-ink lg:grid lg:grid-cols-[minmax(340px,0.88fr)_minmax(520px,1.12fr)]"
    >
      <aside className="auth-frame-story hidden bg-docket-hunter text-docket-paper lg:flex lg:flex-col">
        <div className="flex items-center justify-between border-b border-white/15 px-10 py-6 xl:px-14">
          <Link href="/" className="text-21 font-semibold tracking-[-0.01em] text-white">
            Docket
          </Link>
          <span className="text-11 font-semibold uppercase tracking-[0.1em] text-white/70">{copy.eyebrow}</span>
        </div>

        <div className="my-auto px-10 py-12 xl:px-14">
          <h2 className="max-w-[20ch] text-26 font-semibold leading-tight tracking-[-0.01em] text-white">{copy.title}</h2>
          <p className="mt-3 max-w-[48ch] text-15 text-white/80">{copy.body}</p>

          <h3 className="mt-10 text-11 font-semibold uppercase tracking-[0.1em] text-docket-gold-pale">How signing in works</h3>
          <dl className="mt-3 max-w-md border-t border-white/15">
            {copy.steps.map(([term, detail]) => (
              <div key={term} className="border-b border-white/15 py-3">
                <dt className="text-13 font-semibold text-white">{term}</dt>
                <dd className="mt-0.5 text-13 text-white/75">{detail}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 max-w-md text-13 text-white/75">{copy.note}</p>
        </div>

        <p className="px-10 py-6 text-11 text-white/65 xl:px-14">
          Private software for legal work. Not affiliated with any court or government agency.
        </p>
      </aside>

      <section className="auth-frame-panel flex min-h-[100dvh] flex-col bg-docket-paper">
        <header className="flex min-h-[72px] items-center justify-between border-b border-docket-hair px-5 sm:px-8 lg:hidden">
          <Link href="/" className="text-21 font-semibold tracking-[-0.01em] text-docket-hunter">
            Docket
          </Link>
          <span className="text-11 font-semibold uppercase tracking-[0.1em] text-docket-muted">
            {copy.eyebrow}
          </span>
        </header>
        <div className="auth-frame-content flex flex-1 items-center px-1 sm:px-5 lg:px-12 xl:px-20">
          {children}
        </div>
        <footer className="flex flex-wrap justify-between gap-3 border-t border-docket-hair px-5 py-5 text-11 text-docket-muted sm:px-8 lg:px-12 xl:px-20">
          <span>© {new Date().getFullYear()} Docket</span>
          <span className="flex flex-wrap items-center gap-x-5 gap-y-3">
            {/* The way back to the cookie question on every sign-in and registration page. Only
                where the banner can appear (POSTHOG_KEY set), so it never opens nothing. The
                negative margin keeps the 44px target without making the footer taller. */}
            {analyticsConfigured() && (
              <CookieSettingsButton className="-my-3 inline-flex min-h-[44px] items-center font-medium text-docket-link hover:text-docket-hunter focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current" />
            )}
            <Link href="/" className="font-medium text-docket-link hover:text-docket-hunter">
              Back to Docket
            </Link>
          </span>
        </footer>
      </section>
    </div>
  );
}
