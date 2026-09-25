import { notFound } from "next/navigation";
import { firmBySlug } from "@/lib/tenant";
import { publishedContent } from "@/lib/public-data";
import { publishedPolicyText } from "@/lib/policy-text";
import { ContentBody, PageShell } from "./page-shell";

/** Terms / privacy, first match wins: published CMS content; the text the firm saved under
 *  /firm/admin/settings, once its version is published; the firm's linked document; else an
 *  honest placeholder.
 *
 *  A version that starts "0-" is Docket's mark for "not published yet" (seed_firm_defaults
 *  writes '0-draft' with holding text for every new firm). That text is not the firm's notice,
 *  and the version is not one anybody is asked to accept, so neither is shown. The holding text
 *  can outlive the draft version (a firm publishes by changing only the version), so it is
 *  treated as no text at all, whatever the version. */
export async function PolicyPage({
  slug,
  kind,
  title,
}: {
  slug: string;
  kind: "terms" | "privacy";
  title: string;
}) {
  const firm = await firmBySlug(slug);
  if (!firm) notFound();
  const policy = firm.policies[kind];
  const version = policy?.version ? String(policy.version) : null;
  const published = version !== null && !version.startsWith("0-");
  const text = publishedPolicyText(policy);
  const cancellationText = kind === "terms" ? publishedPolicyText(firm.policies.cancellation) : null;
  const url = policy?.url ? String(policy.url) : null;
  const page = await publishedContent(firm.id, "page", kind);
  const firmName = firm.legal_name ?? firm.name;
  const documentName = title.toLowerCase();

  const link = url ? (
    <a href={url} className="font-medium text-brand underline" target="_blank" rel="noreferrer">
      {url}
    </a>
  ) : null;

  return (
    <PageShell title={title} intro={published ? `Version ${version}` : undefined}>
      {page?.body ? (
        <ContentBody body={page.body} />
      ) : text ? (
        <div className="space-y-6">
          <ContentBody body={text} keepLineBreaks />
          {/* Labelled as the firm labels it in settings: "Link to the full document". */}
          {link ? <p className="text-ink">Full document: {link}</p> : null}
        </div>
      ) : link ? (
        <p className="text-ink">
          Read the current {documentName} at {link}.
        </p>
      ) : (
        <div className="space-y-3 text-ink">
          {published ? (
            <p>
              {firmName} has not put the full text of its {documentName} on this site yet. When you
              first open your client portal with {firm.name}, you are asked to accept this version.
              Your acceptance is recorded against your account.
            </p>
          ) : (
            <p>{firmName} has not published its {documentName} yet.</p>
          )}
          {firm.policies.disclaimer?.text ? <p>{String(firm.policies.disclaimer.text)}</p> : null}
          {cancellationText ? <p>{cancellationText}</p> : null}
        </div>
      )}
    </PageShell>
  );
}
