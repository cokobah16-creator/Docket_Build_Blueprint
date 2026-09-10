// Docket platform landing. A request lands here only when no tenant was
// resolved (the middleware rewrites firm hosts onto /[firm]). Docket is the
// platform; every law firm on it is a tenant with its own site, portal and
// console — nothing here belongs to any one firm.

import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/env";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody } from "@/components/ui/card";

export const metadata = {
  title: "Docket — one sign-in, every firm you instruct",
  description:
    "The client experience platform for Nigerian law firms: a branded firm site, online booking, Paystack checkout, video consultations, matters against the real court hierarchy and service of process — for firms, their clients and the courts.",
};

const AUDIENCES = [
  {
    title: "For law firms",
    body:
      "Your own branded site, online booking and Paystack checkout that settles to your firm, video consultations with a waiting room, and a console with today's list, appointments, the service inbox and two-factor on staff writes. Documents, messaging and invoicing are in build.",
    href: "/firm/start",
    cta: "Register your firm",
  },
  {
    title: "For clients",
    body:
      "Tell the firm what you need, book, pay online, and meet your lawyer face to face from your phone. Every appointment and receipt stays in one place, and the same sign-in works at any firm on Docket. Your matter timeline and messages arrive in the next release.",
    href: "/app/login",
    cta: "Client sign in",
  },
  {
    title: "For the courts and counsel",
    body:
      "Matters recorded against the real Nigerian court hierarchy, each court showing the suit-number shape it uses. Court dates raise reminders. A process served on your firm through Docket lands in a service inbox and is acknowledged by a named practitioner, pinned to the exact document version. The screen a firm serves from is in build.",
    href: "/firm/login",
    cta: "Staff sign in",
  },
];

export default function PlatformLanding() {
  const configured = isSupabaseConfigured();
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center gap-10 px-6 py-16">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-accent">Docket</p>
        <h1 className="mt-2 font-heading text-4xl font-semibold text-brand sm:text-5xl">
          One sign-in, every firm you instruct.
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-gray-600">
          Docket is the platform Nigerian law firms use to run their client
          work — and one client sign-in that carries from firm to firm, whoever
          acts for you next. Built for the Nigerian courts, the Nigerian Bar and
          the diaspora client with a matter back home.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {AUDIENCES.map((a) => (
          <Card key={a.title} className="flex flex-col">
            <CardBody className="flex flex-1 flex-col gap-3">
              <h2 className="font-heading text-base font-semibold text-gray-900">{a.title}</h2>
              <p className="flex-1 text-sm text-gray-600">{a.body}</p>
              <Link
                href={a.href}
                className="inline-flex justify-center rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-brand-on hover:opacity-90"
              >
                {a.cta}
              </Link>
            </CardBody>
          </Card>
        ))}
      </div>

      {configured ? (
        <p className="text-sm text-gray-500">
          Firm sites are served from their own domain or{" "}
          <code>{"{slug}"}.docket.app</code>. On a preview deployment open a
          firm with <code>?firm=&lt;slug&gt;</code>.
        </p>
      ) : (
        <Alert kind="warning" title="Supabase is not configured yet">
          Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> (see <code>.env.example</code>)
          in the hosting environment, apply the migrations from <code>supabase/</code>,
          and firm registration, the firm sites, client portal and staff console come alive.
        </Alert>
      )}

      <p className="text-sm text-gray-500">
        Fees settle to the firm’s own Paystack account; Docket never holds
        client money. Firm pricing is not set yet and no firm is billed.
      </p>
    </main>
  );
}
