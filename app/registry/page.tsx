// /registry — this registry's cause list on Docket: what is staged, what is published, what was
// withdrawn. Nothing about any firm is on this screen, because nothing about any firm is readable
// from this account: the tables underneath carry no firm and no matter.
//
// What a registrar does here: publish a staged batch, or one draft; withdraw a published notice
// with a reason. What a clerk does here: stage, and discard a draft. The database refuses the rest.

import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { registryBatches, registryContext, registryDraftCounts, registryMembers, registryNotices } from "@/lib/registry-data";
import { formatDay } from "@/lib/days";
import { formatWhen } from "@/lib/time";
import { NoticeControls, BatchControls } from "./notice-controls";
import { PageHeader } from "@/components/shell/layout";

export const metadata = { title: "Cause list" };

export default async function RegistryHome({ searchParams }: { searchParams: Promise<{ registry?: string }> }) {
  const sp = await searchParams;
  const ctx = await registryContext(sp.registry);
  if (!ctx) return <Alert kind="warning" title="Not configured">Supabase is not configured, or this account acts for no registry.</Alert>;
  const { supabase, registry, role, timezone } = ctx;
  const [notices, batches, members] = await Promise.all([
    registryNotices(supabase, registry.id), registryBatches(supabase, registry.id), registryMembers(supabase, registry.id),
  ]);
  const drafts = notices.filter((n) => n.status === "draft");
  const published = notices.filter((n) => n.status === "published");
  const withdrawn = notices.filter((n) => n.status === "withdrawn");
  const batchById = new Map(batches.map((b) => [b.id, b]));
  const draftBatches = batches.filter((b) => !b.published_at && drafts.some((n) => n.batch_id === b.id));
  const isRegistrar = role === "registrar";
  // What Publish will actually publish, asked of the database. The list above is a page and can be
  // shorter than the batch; the button must never be.
  const draftCounts = await registryDraftCounts(supabase, draftBatches.map((b) => b.id));

  return (
    <div className="flex flex-col gap-3.5">
      <PageHeader
        tone="neutral"
        title={ctx.courtName}
        description={`${registry.name} · ${members.length} ${members.length === 1 ? "person" : "people"} · times in ${timezone}`}
      />

      {registry.status === "suspended" && (
        <Alert kind="warning" title="This registry is suspended">
          What was published can still be read by the firms it concerns. Nothing new can be staged, published or withdrawn until the Docket platform restores it.
        </Alert>
      )}

      <Card>
        <CardBody className="text-13 leading-[1.55] text-[#57534E]">
          <p>
            A notice you publish here reaches only the firms whose matter already carries that suit number at this
            court, on their own Sittings screen, where a lawyer confirms it into their diary or says it is not theirs.
            <strong> Docket does not tell you which firms those are, or what they decided</strong> — that is theirs.
            A notice published in error is <em>withdrawn</em> with a reason, never deleted; the firms that confirmed it are told.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={`Staged, not yet published (${drafts.length})`} action={<Link href="/registry/import" className="text-15 underline">Stage a list</Link>} />
        {drafts.length === 0 ? (
          <EmptyState title="Nothing staged" hint="Stage a cause list from a CSV, or one listing at a time. It is a draft until a registrar publishes it." />
        ) : (
          <div>
            {draftBatches.map((b) => (
              <div key={b.id} className="border-t border-[#F0EEEA] px-[15px] py-3 first:border-t-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-13 font-semibold text-[#141414]">
                    {b.source_note ?? "Untitled batch"} <span className="font-normal text-[#57534E]">· staged {formatWhen(b.staged_at, timezone)}</span>
                  </p>
                  {isRegistrar && <BatchControls batchId={b.id} count={draftCounts[b.id] ?? drafts.filter((n) => n.batch_id === b.id).length} />}
                </div>
                {(draftCounts[b.id] ?? 0) > drafts.filter((n) => n.batch_id === b.id).length && (
                  <p className="mt-1 text-11 font-medium text-amber-800">
                    This batch holds {draftCounts[b.id]} drafts and only {drafts.filter((n) => n.batch_id === b.id).length} are
                    listed here. Publishing publishes all {draftCounts[b.id]} — read the file you staged, or stage it in smaller batches.
                  </p>
                )}
                <ul className="mt-2 divide-y divide-[#F0EEEA]">
                  {drafts.filter((n) => n.batch_id === b.id).map((n) => (
                    <li key={n.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                      <div className="min-w-0 text-13 text-[#141414]">
                        <span className="font-mono">{n.suit_number}</span>{n.cause_title ? ` · ${n.cause_title}` : ""}
                        <span className="block text-11 text-[#57534E]">
                          {formatDay(n.listed_on)}{n.listed_time ? ` ${n.listed_time.slice(0, 5)}` : ""}
                          {n.purpose ? ` · ${n.purpose}` : n.purpose_kind ? ` · ${n.purpose_kind.replace(/_/g, " ")}` : ""}
                          {n.judge ? ` · ${n.judge}` : ""}{n.courtroom ? ` · ${n.courtroom}` : ""}
                        </span>
                      </div>
                      <NoticeControls noticeId={n.id} status="draft" isRegistrar={isRegistrar} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title={`Published (${published.length})`} />
        {published.length === 0 ? (
          <EmptyState title="Nothing published yet" hint="A published notice is what a firm sees. Only a registrar publishes." />
        ) : (
          <ul>
            {published.map((n) => (
              <li key={n.id} className="flex flex-wrap items-start justify-between gap-2 border-t border-[#F0EEEA] px-[15px] py-3 first:border-t-0">
                <div className="min-w-0 text-13 text-[#141414]">
                  <span className="font-mono">{n.suit_number}</span>{n.cause_title ? ` · ${n.cause_title}` : ""}
                  <span className="block text-11 text-[#57534E]">
                    {formatDay(n.listed_on)}{n.listed_time ? ` ${n.listed_time.slice(0, 5)}` : ""}
                    {n.purpose ? ` · ${n.purpose}` : n.purpose_kind ? ` · ${n.purpose_kind.replace(/_/g, " ")}` : ""}
                    {n.judge ? ` · ${n.judge}` : ""}{n.courtroom ? ` · ${n.courtroom}` : ""}
                    {n.batch_id && batchById.get(n.batch_id)?.source_note ? ` · ${batchById.get(n.batch_id)!.source_note}` : ""}
                    {n.published_at ? ` · published ${formatWhen(n.published_at, timezone)}` : ""}
                  </span>
                </div>
                <NoticeControls noticeId={n.id} status="published" isRegistrar={isRegistrar} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {withdrawn.length > 0 && (
        <Card>
          <CardHeader title={`Withdrawn (${withdrawn.length})`} />
          <ul>
            {withdrawn.map((n) => (
              <li key={n.id} className="border-t border-[#F0EEEA] px-[15px] py-3 text-13 text-[#57534E] first:border-t-0">
                <span className="font-mono">{n.suit_number}</span> · {formatDay(n.listed_on)}
                <span className="block text-11">Withdrawn {n.withdrawn_at ? formatWhen(n.withdrawn_at, timezone) : ""}{n.withdrawn_reason ? ` — ${n.withdrawn_reason}` : ""}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title="Who acts for this registry" />
        <ul>
          {members.map((m) => (
            <li key={m.user_id} className="border-t border-[#F0EEEA] px-[15px] py-2.5 text-13 first:border-t-0">
              <span className="font-medium text-[#141414]">{m.full_name ?? m.email ?? "Somebody"}</span>
              <span className="text-[#57534E]"> · {m.role}{m.email && m.full_name ? ` · ${m.email}` : ""}</span>
            </li>
          ))}
        </ul>
        {isRegistrar && (
          <CardBody className="border-t border-[#F0EEEA] text-11 text-[#57534E]">
            The Docket platform adds a clerk or another registrar for you — ask them, with the email the person signed up to Docket with. A registrar can remove a member here or through the platform. That is deliberate: a registry is an outside body, and looking people up by email is not something Docket lets an outside body do.
          </CardBody>
        )}
      </Card>
    </div>
  );
}
