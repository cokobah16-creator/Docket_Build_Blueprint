// /firm/admin/documents — how much of this firm's own filing cabinet Docket can actually read.
//
// This screen exists because the alternative is worse than not having it. Search now reaches inside
// a document, and a firm that does not know which of its files were unreadable will assume a search
// covered all of them. The counts here are the honest answer to "what did that search NOT look at".
//
// Every number is the firm's own: document_text_health() asks is_firm_member() and counts only
// current versions of this firm's undeleted documents. It returns counts and nothing else — never
// a word of anybody's text, and never another firm's figures.

import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { requestedFirmId, staffContext } from "@/lib/firm-data";
import { formatWhen } from "@/lib/time";
import type { DocumentTextHealth } from "@/lib/db/types";

export const metadata = { title: "Documents" };

export default async function DocumentTextPage({ searchParams }: { searchParams: Promise<{ firm?: string }> }) {
  const sp = await searchParams;
  const ctx = await staffContext(await requestedFirmId({ firm: sp.firm }));
  if (!ctx) {
    return (
      <Alert kind="warning" title="Not configured">
        Supabase environment variables are not set, or this account is not a member of a firm.
      </Alert>
    );
  }
  const { supabase, firmId, timezone } = ctx;
  const { data, error } = await supabase.rpc("document_text_health", { p_firm: firmId });
  const h = ((data ?? []) as DocumentTextHealth[])[0] ?? null;

  const rows: Array<{ label: string; value: number; hint: string; warn?: boolean }> = h
    ? [
        { label: "Searchable", value: h.extracted, hint: "Docket read the words in these and a search looks inside them." },
        { label: "Waiting", value: h.waiting, hint: "Read within a few minutes of being uploaded." },
        {
          label: "No words to find", value: h.no_text_layer, warn: h.no_text_layer > 0,
          hint: "Scans and photographs. A search finds these by their name only.",
        },
        { label: "Not a kind Docket reads", value: h.unsupported, hint: "Images, spreadsheets, .doc, and anything else. Found by name." },
        { label: "Too large", value: h.too_large, hint: "Over 25 MB. Found by name." },
        { label: "Could not be read", value: h.failed, warn: h.failed > 0, hint: "Tried three times and gave up. Worth looking at." },
      ]
    : [];

  return (
    <div className="flex flex-col gap-3.5">
      <h1 className="font-heading text-[22px] font-bold tracking-[-0.02em] text-[#141414]">Documents</h1>

      {error && (
        <Alert kind="error" title="The figures did not load">
          Nothing is shown because nothing could be read — not because there is nothing. Try again.
        </Alert>
      )}

      <Card>
        <CardHeader title="What a search can look inside" />
        <CardBody className="text-[12.5px] leading-[1.55] text-[#57534E]">
          <p>
            <Link href="/firm/search" className="underline">Search</Link> matches the words inside a
            document as well as its name — a clause in an agreement, a name in a witness statement.
            It does that for the <strong>current version</strong> of each file, so a superseded draft
            is not what comes back.
          </p>
          <p className="mt-2">
            <strong>Docket cannot read a scan.</strong> A photographed or scanned page is a picture
            of words, and recognising them needs a service Docket does not use. Those files are
            counted below as <em>no words to find</em>, and a search still finds them by their name.
            Nothing is hidden by this &mdash; it is only not searchable by its contents.
          </p>
        </CardBody>
      </Card>

      {h && (
        <Card>
          <CardHeader title="This firm's files" />
          <ul>
            {rows.map((r) => (
              <li key={r.label} className="flex items-start justify-between gap-3 border-t border-[#F0EEEA] px-[15px] py-3 first:border-t-0">
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold text-[#141414]">{r.label}</span>
                  <span className="mt-0.5 block text-[11.5px] text-[#57534E]">{r.hint}</span>
                </span>
                <span
                  className={
                    r.warn && r.value > 0
                      ? "grid h-[26px] min-w-[26px] shrink-0 place-items-center rounded-full bg-[#FFFAEB] px-2 text-[12px] font-bold text-[#92400E]"
                      : "grid h-[26px] min-w-[26px] shrink-0 place-items-center rounded-full bg-[#F0EEEA] px-2 text-[12px] font-bold text-[#57534E]"
                  }
                >
                  {r.value}
                </span>
              </li>
            ))}
          </ul>
          <CardBody className="border-t border-[#F0EEEA] text-[11.5px] text-[#57534E]">
            {h.last_extracted_at
              ? `Last read ${formatWhen(h.last_extracted_at, timezone)}.`
              : "Nothing has been read yet. If this does not change, the reader is not running — tell whoever runs this Docket."}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
