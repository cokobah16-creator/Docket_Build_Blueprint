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
    <div className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
      <h1 className="font-heading text-3xl font-semibold text-brand sm:text-4xl">{title}</h1>
      {intro && <p className="mt-3 text-lg text-gray-600">{intro}</p>}
      <div className="mt-8">{children}</div>
    </div>
  );
}

/** Renders CMS body text: blank-line separated paragraphs. */
export function ContentBody({ body }: { body: string }) {
  return (
    <div className="space-y-4 text-gray-700">
      {body
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p, i) => (
          <p key={i}>{p}</p>
        ))}
    </div>
  );
}
