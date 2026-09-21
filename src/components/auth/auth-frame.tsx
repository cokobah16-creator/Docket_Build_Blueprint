import Link from "next/link";
import type { ReactNode } from "react";

const COPY = {
  client: {
    eyebrow: "Client portal",
    title: "Your matter, clearly in view.",
    body: "Court dates, documents, invoices and updates stay together in one secure record you can open from any phone.",
    points: ["Plain-language matter updates", "One portal across every firm", "Secure sign-in without a password"],
  },
  staff: {
    eyebrow: "Practice console",
    title: "Run the practice. Keep every matter in view.",
    body: "A serious operating system for Nigerian legal work — from the first consultation to the final entry on the matter.",
    points: ["Matter-first records", "Court diary and deadline control", "Two-factor protected staff access"],
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
      <aside className="auth-frame-story relative hidden overflow-hidden bg-docket-hunter text-docket-paper lg:flex lg:flex-col">
        <div className="auth-frame-grid absolute inset-0" aria-hidden="true" />
        <div className="relative z-10 flex items-center justify-between border-b border-white/15 px-10 py-7 xl:px-14">
          <Link href="/" className="font-heading text-26 tracking-[-0.04em] text-white">
            Docket
          </Link>
          <span className="text-11 font-semibold uppercase tracking-[0.16em] text-docket-gold-pale">
            Legal OS
          </span>
        </div>

        <div className="relative z-10 my-auto px-10 py-16 xl:px-14">
          <p className="text-11 font-semibold uppercase tracking-[0.16em] text-docket-gold-pale">
            {copy.eyebrow}
          </p>
          <h2 className="mt-5 max-w-[11ch] font-heading text-44 leading-[1.02] tracking-[-0.035em] text-white xl:text-56">
            {copy.title}
          </h2>
          <p className="mt-6 max-w-[44ch] text-15 leading-7 text-white/80">{copy.body}</p>

          <div className="mt-10 max-w-md border-t border-white/15">
            {copy.points.map((point, index) => (
              <div key={point} className="flex items-center gap-4 border-b border-white/15 py-4">
                <span className="font-heading text-17 text-docket-gold-pale">0{index + 1}</span>
                <span className="text-13 font-medium text-white">{point}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="relative z-10 px-10 py-7 text-11 text-white/65 xl:px-14">
          Private software for legal work. Not affiliated with any court or government agency.
        </p>
      </aside>

      <section className="auth-frame-panel flex min-h-[100dvh] flex-col bg-docket-paper">
        <header className="flex min-h-[72px] items-center justify-between border-b border-docket-hair px-5 sm:px-8 lg:hidden">
          <Link href="/" className="font-heading text-26 tracking-[-0.04em] text-docket-hunter">
            Docket
          </Link>
          <span className="text-11 font-semibold uppercase tracking-[0.14em] text-docket-muted">
            {copy.eyebrow}
          </span>
        </header>
        <div className="auth-frame-content flex flex-1 items-center px-1 sm:px-5 lg:px-12 xl:px-20">
          {children}
        </div>
        <footer className="flex flex-wrap justify-between gap-3 border-t border-docket-hair px-5 py-5 text-11 text-docket-muted sm:px-8 lg:px-12 xl:px-20">
          <span>© {new Date().getFullYear()} Docket</span>
          <Link href="/" className="font-medium text-docket-link hover:text-docket-hunter">
            Back to Docket
          </Link>
        </footer>
      </section>
    </div>
  );
}
