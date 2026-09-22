// /registry — the registry's own workspace: the cause list it has published, what is staged and
// waiting for a registrar, what was withdrawn, who acts for the registry, and the registry's audit
// trail. Nothing about any firm is on this screen, because nothing about any firm is readable from
// this account: the tables underneath carry no firm and no matter.
//
// What a registrar does here: publish a staged batch, or one draft; withdraw a published notice
// with a reason. What a clerk does here: stage, and discard a draft. The database refuses the rest.
//
// It is laid out as a register rather than a dashboard: a queue summary, then one view at a time
// (?view=), each a table keyed on the suit number, because that is how a registry finds anything.

import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusPill } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import {
  registryAudit, registryBatches, registryContext, registryDraftCounts, registryMembers, registryNotices,
} from "@/lib/registry-data";
import { formatDay, todayIn } from "@/lib/days";
import { formatWhen } from "@/lib/time";
import type { RegistryNoticeRow } from "@/lib/db/types";
import { NoticeControls, BatchControls } from "./notice-controls";

export const metadata = { title: "Cause list" };

const VIEWS = [
  ["list", "Cause list"],
  ["staged", "Awaiting publication"],
  ["withdrawn", "Withdrawn"],
  ["audit", "Audit trail"],
  ["people", "Registry staff"],
] as const;
type View = (typeof VIEWS)[number][0];

/** The words for what the audit trail records, in the registry's own terms. */
const ACTION_LABEL: Record<string, string> = {
  "registry.created": "Registry opened on Docket",
  "registry.status": "Registry status changed",
  "registry.member_set": "Staff member added or role changed",
  "registry.member_removed": "Staff member removed",
  "registry.batch_staged": "Cause list staged",
  "registry.batch_published": "Cause list published",
  "registry.notice_published": "Listing published",
  "registry.notice_withdrawn": "Listing withdrawn",
};

function purposeOf(n: RegistryNoticeRow): string {
  return n.purpose ?? (n.purpose_kind ? n.purpose_kind.replace(/_/g, " ") : "—");
}

export default async function RegistryHome({
  searchParams,
}: {
  searchParams: Promise<{ registry?: string; view?: string; q?: string; past?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await registryContext(sp.registry);
  if (!ctx) {
    return (
      <Alert kind="warning" title="The registry workspace is unavailable">
        This account does not act for a registry on Docket, or the service could not be reached. If you should
        have access, ask the Docket platform team to add you with the email address you signed up with.
      </Alert>
    );
  }
  const { supabase, registry, role, timezone } = ctx;
  const view: View = VIEWS.some(([k]) => k === sp.view) ? (sp.view as View) : "list";
  const search = (sp.q ?? "").trim().slice(0, 80);
  const showPast = sp.past === "1";

  const [notices, batches, members, audit] = await Promise.all([
    registryNotices(supabase, registry.id),
    registryBatches(supabase, registry.id),
    registryMembers(supabase, registry.id),
    view === "audit" ? registryAudit(supabase, registry.id) : Promise.resolve([]),
  ]);
  const today = todayIn(timezone);
  const drafts = notices.filter((n) => n.status === "draft");
  const published = notices.filter((n) => n.status === "published");
  const withdrawn = notices.filter((n) => n.status === "withdrawn");
  const upcoming = published.filter((n) => n.listed_on >= today);
  const batchById = new Map(batches.map((b) => [b.id, b]));
  const draftBatches = batches.filter((b) => !b.published_at && drafts.some((n) => n.batch_id === b.id));
  const isRegistrar = role === "registrar";
  // What Publish will actually publish, asked of the database. The list is a page and can be
  // shorter than the batch; the button must never be.
  const draftCounts = await registryDraftCounts(supabase, draftBatches.map((b) => b.id));
  const memberName = new Map(members.map((m) => [m.user_id, m.full_name ?? m.email ?? "A registry member"]));

  const needle = search.toLowerCase();
  const matches = (n: RegistryNoticeRow) =>
    !needle || n.suit_number.toLowerCase().includes(needle) || (n.cause_title ?? "").toLowerCase().includes(needle);

  // The cause list, one sitting day at a time. Upcoming by default; past days on request.
  const listRows = (showPast ? published : upcoming).filter(matches)
    .sort((a, b) => (a.listed_on + (a.listed_time ?? "")).localeCompare(b.listed_on + (b.listed_time ?? "")) * (showPast ? -1 : 1));
  const byDay = new Map<string, RegistryNoticeRow[]>();
  for (const n of listRows) byDay.set(n.listed_on, [...(byDay.get(n.listed_on) ?? []), n]);

  const href = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams();
    const base: Record<string, string | null> = { registry: sp.registry ?? null, view: view === "list" ? null : view, q: search || null, past: showPast ? "1" : null, ...patch };
    for (const [k, v] of Object.entries(base)) if (v) params.set(k, v);
    const qs = params.toString();
    return qs ? `/registry?${qs}` : "/registry";
  };

  const summary: Array<{ label: string; value: number; view: View; attention?: boolean }> = [
    { label: "Listed from today", value: upcoming.length, view: "list" },
    { label: "Awaiting publication", value: drafts.length, view: "staged", attention: drafts.length > 0 },
    { label: "Withdrawn", value: withdrawn.length, view: "withdrawn" },
    { label: "Registry staff", value: members.length, view: "people" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-hairline pb-3">
        <div className="min-w-0">
          <p className="text-11 font-semibold uppercase tracking-[0.06em] text-ink-muted">Registry · {registry.name}</p>
          <h1 className="text-21 font-semibold tracking-[-0.01em] text-ink-strong md:text-26">{ctx.courtName}</h1>
          <p className="mt-0.5 text-13 text-ink-muted">
            Signed in as {isRegistrar ? "registrar" : "clerk"} · dates are the court&apos;s own calendar days · times in {timezone}
          </p>
        </div>
        <Link href="/registry/import" className={buttonClasses("neutral", "sm")}>Stage a cause list</Link>
      </header>

      {registry.status === "suspended" && (
        <Alert kind="warning" title="This registry is suspended">
          What was published can still be read by the firms it concerns. Nothing new can be staged, published or withdrawn until the Docket platform restores it.
        </Alert>
      )}

      <dl className="grid grid-cols-2 overflow-hidden rounded-card border border-hairline bg-raised md:grid-cols-4">
        {summary.map((s) => (
          <div key={s.label} className="relative border-b border-r border-hairline px-3 py-2.5 hover:bg-hover">
            <Link href={href({ view: s.view === "list" ? null : s.view })} className="absolute inset-0">
              <span className="sr-only">Open {s.label.toLowerCase()}</span>
            </Link>
            <dt className="text-11 font-semibold uppercase tracking-[0.06em] text-ink-muted">{s.label}</dt>
            <dd className={cn("mt-0.5 text-21 font-semibold tabular-nums", s.attention ? "text-waiting-ink" : "text-ink-strong")}>
              {s.value}
              {s.attention && <span className="ml-2 align-middle text-11 font-semibold">needs a registrar</span>}
            </dd>
          </div>
        ))}
      </dl>

      <nav aria-label="Registry views" className="-mx-4 overflow-x-auto border-b border-hairline px-4 sm:mx-0 sm:px-0">
        <ul className="flex gap-1">
          {VIEWS.map(([key, label]) => (
            <li key={key}>
              <Link
                href={href({ view: key === "list" ? null : key })}
                aria-current={view === key ? "page" : undefined}
                className={cn(
                  "-mb-px flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 text-13 font-medium",
                  view === key ? "border-ink-strong font-semibold text-ink-strong" : "border-transparent text-ink-muted hover:text-ink",
                )}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {view === "list" && (
        <>
          <form method="get" action="/registry" className="flex flex-wrap items-end gap-2">
            {sp.registry && <input type="hidden" name="registry" value={sp.registry} />}
            <div className="min-w-[240px] flex-1">
              <label htmlFor="q" className="text-13 font-medium text-ink">Find a suit</label>
              <input
                id="q" name="q" type="search" defaultValue={search} maxLength={80} placeholder="Suit number or case title"
                className="mt-1 min-h-11 w-full rounded-control border border-edge bg-raised px-3 text-base text-ink focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-ink-strong"
              />
            </div>
            <label className="flex min-h-11 items-center gap-2 text-13 text-ink">
              <input type="checkbox" name="past" value="1" defaultChecked={showPast} className="h-4 w-4" />
              Include past sitting days
            </label>
            <button type="submit" className={buttonClasses("neutral", "sm")}>Show</button>
            {(search || showPast) && <Link href="/registry" className={buttonClasses("ghost", "sm")}>Clear</Link>}
          </form>

          {byDay.size === 0 ? (
            <div className="rounded-card border border-hairline bg-raised">
              <EmptyState
                title={search ? "No listing matches that search" : showPast ? "Nothing has been published" : "Nothing is listed from today"}
                hint={search
                  ? "Check the suit number as the registry writes it, or include past sitting days."
                  : "A cause list appears here once a registrar publishes it. Stage one from a file or row by row; it stays a draft until then."}
                action={<Link href="/registry/import" className={buttonClasses("ghost", "sm")}>Stage a cause list</Link>}
              />
            </div>
          ) : (
            Array.from(byDay.entries()).map(([day, rows]) => (
              <section key={day} aria-labelledby={`day-${day}`} className="overflow-hidden rounded-card border border-hairline bg-raised">
                <h2 id={`day-${day}`} className="flex items-center justify-between gap-3 border-b border-hairline bg-sunken px-3 py-2 text-13 font-semibold text-ink-strong">
                  <span>{formatDay(day)}{day === today ? " · today" : ""}</span>
                  <span className="text-11 font-medium text-ink-muted">{rows.length} {rows.length === 1 ? "listing" : "listings"}</span>
                </h2>
                <Table minWidth="52rem" caption={`Cause list for ${formatDay(day)}`}>
                  <THead>
                    <tr>
                      <TH className="w-20">Time</TH>
                      <TH>Suit no.</TH>
                      <TH className="w-[30%]">Case</TH>
                      <TH>Business</TH>
                      <TH>Judge · courtroom</TH>
                      <TH className="text-right">Action</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {rows.map((n) => (
                      <TR key={n.id}>
                        <TD className="whitespace-nowrap font-mono">{n.listed_time ? n.listed_time.slice(0, 5) : "—"}</TD>
                        <TD className="whitespace-nowrap font-mono font-semibold text-ink-strong">{n.suit_number}</TD>
                        <TD>
                          {n.cause_title ?? <span className="text-ink-muted">Title not given</span>}
                          <span className="block text-11 text-ink-muted">
                            {n.published_at ? `Published ${formatWhen(n.published_at, timezone)}` : ""}
                            {n.published_by && memberName.has(n.published_by) ? ` by ${memberName.get(n.published_by)}` : ""}
                            {n.batch_id && batchById.get(n.batch_id)?.source_note ? ` · ${batchById.get(n.batch_id)!.source_note}` : ""}
                          </span>
                        </TD>
                        <TD>{purposeOf(n)}</TD>
                        <TD>
                          {n.judge ?? <span className="text-ink-muted">—</span>}
                          {n.courtroom && <span className="block text-11 text-ink-muted">{n.courtroom}</span>}
                        </TD>
                        <TD className="text-right"><NoticeControls noticeId={n.id} status="published" isRegistrar={isRegistrar} /></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </section>
            ))
          )}

          <p className="text-13 text-ink-muted">
            A published listing reaches only the firms whose matter already carries that suit number at this court. Docket
            does not tell the registry which firms those are or what they decided. A listing published in error is
            withdrawn with a reason, never deleted, and the firms that relied on it are told.
          </p>
        </>
      )}

      {view === "staged" && (
        <section aria-label="Awaiting publication" className="overflow-hidden rounded-card border border-hairline bg-raised">
          {drafts.length === 0 ? (
            <EmptyState
              title="Nothing is awaiting publication"
              hint="Staged listings are drafts that no firm can see. Stage a cause list from a file or row by row; a registrar then publishes it."
              action={<Link href="/registry/import" className={buttonClasses("ghost", "sm")}>Stage a cause list</Link>}
            />
          ) : (
            draftBatches.map((b) => {
              const rows = drafts.filter((n) => n.batch_id === b.id);
              const total = draftCounts[b.id] ?? rows.length;
              return (
                <div key={b.id} className="border-t border-hairline first:border-t-0">
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-sunken px-3 py-2">
                    <p className="text-13 font-semibold text-ink-strong">
                      {b.source_note ?? "Untitled batch"}
                      <span className="font-normal text-ink-muted"> · staged {formatWhen(b.staged_at, timezone)} · {total} {total === 1 ? "listing" : "listings"}</span>
                    </p>
                    {isRegistrar ? <BatchControls batchId={b.id} count={total} /> : <StatusPill status="draft" label="Waiting for a registrar" />}
                  </div>
                  {total > rows.length && (
                    <p className="border-t border-hairline px-3 py-2 text-11 font-medium text-waiting-ink">
                      This batch holds {total} drafts and only {rows.length} are listed here. Publishing publishes all {total} — check the file you staged, or stage it in smaller batches.
                    </p>
                  )}
                  <Table minWidth="44rem" caption={`Staged listings: ${b.source_note ?? "untitled batch"}`}>
                    <THead>
                      <tr>
                        <TH>Date</TH>
                        <TH>Suit no.</TH>
                        <TH className="w-[32%]">Case</TH>
                        <TH>Business</TH>
                        <TH className="text-right">Action</TH>
                      </tr>
                    </THead>
                    <TBody>
                      {rows.map((n) => (
                        <TR key={n.id}>
                          <TD className="whitespace-nowrap">{formatDay(n.listed_on)}{n.listed_time ? ` ${n.listed_time.slice(0, 5)}` : ""}</TD>
                          <TD className="whitespace-nowrap font-mono">{n.suit_number}</TD>
                          <TD>{n.cause_title ?? <span className="text-ink-muted">Title not given</span>}</TD>
                          <TD>{purposeOf(n)}{n.judge ? <span className="block text-11 text-ink-muted">{n.judge}{n.courtroom ? ` · ${n.courtroom}` : ""}</span> : null}</TD>
                          <TD className="text-right"><NoticeControls noticeId={n.id} status="draft" isRegistrar={isRegistrar} /></TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
              );
            })
          )}
        </section>
      )}

      {view === "withdrawn" && (
        <section aria-label="Withdrawn listings" className="overflow-hidden rounded-card border border-hairline bg-raised">
          {withdrawn.length === 0 ? (
            <EmptyState title="No listing has been withdrawn" hint="A registrar withdraws a published listing with a reason. It stays on record here, and the firms that relied on it are told." />
          ) : (
            <Table minWidth="44rem" caption="Withdrawn listings">
              <THead>
                <tr>
                  <TH>Sitting day</TH>
                  <TH>Suit no.</TH>
                  <TH>Withdrawn</TH>
                  <TH className="w-[40%]">Reason</TH>
                </tr>
              </THead>
              <TBody>
                {withdrawn.map((n) => (
                  <TR key={n.id}>
                    <TD className="whitespace-nowrap">{formatDay(n.listed_on)}</TD>
                    <TD className="whitespace-nowrap font-mono">{n.suit_number}</TD>
                    <TD className="whitespace-nowrap">
                      {n.withdrawn_at ? formatWhen(n.withdrawn_at, timezone) : "—"}
                      {n.withdrawn_by && memberName.has(n.withdrawn_by) && <span className="block text-11 text-ink-muted">{memberName.get(n.withdrawn_by)}</span>}
                    </TD>
                    <TD>{n.withdrawn_reason ?? <span className="text-ink-muted">No reason recorded</span>}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </section>
      )}

      {view === "audit" && (
        <section aria-label="Audit trail" className="overflow-hidden rounded-card border border-hairline bg-raised">
          {audit.length === 0 ? (
            <EmptyState title="No recorded activity yet" hint="Every staging, publication, withdrawal and change of staff is written here as it happens. The trail cannot be edited." />
          ) : (
            <Table minWidth="40rem" caption="Registry audit trail">
              <THead>
                <tr>
                  <TH>When</TH>
                  <TH>What</TH>
                  <TH>Who</TH>
                </tr>
              </THead>
              <TBody>
                {audit.map((a) => (
                  <TR key={a.id}>
                    <TD className="whitespace-nowrap">{formatWhen(a.at, timezone)}</TD>
                    <TD>{ACTION_LABEL[a.action] ?? a.action.replace(/[._]/g, " ")}</TD>
                    <TD>{a.actor_id ? memberName.get(a.actor_id) ?? "Docket platform" : "System"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          <p className="border-t border-hairline px-3 py-2 text-11 text-ink-muted">
            The latest 200 entries. The trail is append-only: nobody at the registry or at a firm can change it.
          </p>
        </section>
      )}

      {view === "people" && (
        <section aria-label="Registry staff" className="overflow-hidden rounded-card border border-hairline bg-raised">
          <Table minWidth="32rem" caption="Registry staff">
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>Email</TH>
                <TH>Role</TH>
              </tr>
            </THead>
            <TBody>
              {members.map((m) => (
                <TR key={m.user_id}>
                  <TD className="font-medium text-ink-strong">{m.full_name ?? "Name not set"}</TD>
                  <TD>{m.email ?? "—"}</TD>
                  <TD><Badge tone={m.role === "registrar" ? "informing" : "quiet"}>{m.role === "registrar" ? "Registrar" : "Clerk"}</Badge></TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <p className="border-t border-hairline px-3 py-2 text-13 text-ink-muted">
            Registry staff are added and removed by the Docket platform team, with the email address the person signed
            up with. A registry is an outside body, and Docket does not let an outside body look people up by email.
          </p>
        </section>
      )}
    </div>
  );
}
