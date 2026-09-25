import type { ReactNode } from "react";

export function PageShell({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <div className="firm-page-shell">
      <section className="firm-page-hero border-b border-hairline">
        <div className="mx-auto max-w-[1180px] px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
          <p className="text-11 font-semibold uppercase tracking-[0.15em] text-brand-accent">Firm information</p>
          <h1 className="mt-4 max-w-[16ch] font-heading text-44 font-semibold leading-[1.04] tracking-[-0.035em] text-brand sm:text-56">{title}</h1>
          {intro && <p className="mt-5 max-w-[62ch] text-17 leading-7 text-ink-muted">{intro}</p>}
        </div>
      </section>
      <div className="mx-auto max-w-[900px] px-4 py-12 sm:px-6 sm:py-16 lg:px-8">{children}</div>
    </div>
  );
}

/** Renders CMS body text: blank-line separated paragraphs. `keepLineBreaks` also keeps a
 *  single line break inside a paragraph, for text typed into a plain textarea (a numbered
 *  clause list in a firm's privacy notice, say) rather than written for the CMS. */
export function ContentBody({ body, keepLineBreaks = false }: { body: string; keepLineBreaks?: boolean }) {
  return (
    <div className="space-y-5 border-l-2 border-brand-accent pl-5 text-17 leading-7 text-ink sm:pl-7">
      {body
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p, i) => (
          <p key={i} className={keepLineBreaks ? "whitespace-pre-line" : undefined}>{p}</p>
        ))}
    </div>
  );
}
