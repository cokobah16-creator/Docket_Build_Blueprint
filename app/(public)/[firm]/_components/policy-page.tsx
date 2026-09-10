import { notFound } from "next/navigation";
import { firmBySlug } from "@/lib/tenant";
import { publishedContent } from "@/lib/public-data";
import { ContentBody, PageShell } from "./page-shell";

/** Terms / privacy: published CMS content, else the firm's linked document,
 *  else an honest placeholder carrying the policy version in force. */
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
  const url = policy?.url ? String(policy.url) : null;
  const page = await publishedContent(firm.id, "page", kind);

  return (
    <PageShell title={title} intro={version ? `Version ${version}` : undefined}>
      {page?.body ? (
        <ContentBody body={page.body} />
      ) : url ? (
        <p className="text-gray-700">
          Read the current {title.toLowerCase()} at{" "}
          <a href={url} className="font-medium text-brand underline" target="_blank" rel="noreferrer">
            {url}
          </a>
          .
        </p>
      ) : (
        <div className="space-y-3 text-gray-700">
          <p>
            {firm.legal_name ?? firm.name} has not published the full text of its {title.toLowerCase()} on
            this site yet. The version you accept when signing in is recorded against your account.
          </p>
          {firm.policies.disclaimer?.text ? <p>{String(firm.policies.disclaimer.text)}</p> : null}
          {kind === "terms" && firm.policies.cancellation?.text ? (
            <p>{String(firm.policies.cancellation.text)}</p>
          ) : null}
        </div>
      )}
    </PageShell>
  );
}
