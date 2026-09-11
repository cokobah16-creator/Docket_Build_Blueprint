// The audit trail: what has been done to this firm, newest first, in the database's own words.
//
// Rules obeyed here:
//  · audit_log is append-only. Nothing can edit or delete a line of it — update and delete were
//    revoked from anon and authenticated in the schema migration, and there is no policy that
//    could grant them back. This screen only reads.
//  · Who may read it is audit_log_select: has_firm_role(firm_id, owner/admin). A lawyer or a
//    staff member gets NO rows, not an error, so an empty list is explained rather than left to
//    look like an empty history.
//  · Paging is keyset, on (at, id) — the same order the list is drawn in, and the pair the only
//    index on this table (firm_id, at desc) can serve. Offset paging would re-read every row it
//    skipped and would quietly drop or repeat a line whenever one was written mid-read.
//  · There is NO filter by action or by entity, on purpose: neither column is indexed, so a
//    filter would read the firm's whole history on every page. That is said on screen instead of
//    being offered and being slow.
//  · Timestamps are UTC in the database and rendered in the reader's own zone (ctx.timezone).
//    A value inside meta that is a calendar day — a DATE column — is rendered in UTC and never
//    shifted, because a hearing date is a day, not an instant.
//  · The log's coverage is stated plainly at the foot. Several tables have no row trigger, and a
//    reader who assumes otherwise would draw the wrong conclusion from a silence.

import Link from "next/link";
import type { ReactNode } from "react";
import { requestedFirmId, staffContext } from "@/lib/firm-data";
import { formatWhen } from "@/lib/time";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";

export const metadata = { title: "Audit trail" };

/** Lines per page. One page is one screenful of scrolling on a phone, not a wall. */
const PAGE = 40;

interface AuditRow {
  id: number;
  at: string;
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  meta: Record<string, unknown> | null;
}

/**
 * Which tables write a line here by themselves, through audit_row_change() (migration 3, extended
 * by migration 12). Anything not on this list is audited only when a database FUNCTION chooses to
 * write a line — and several firm-facing tables do neither.
 */
const ROW_AUDITED = [
  "firms", "firm_members", "services", "appointments", "matters", "matter_parties", "updates",
  "documents", "document_versions", "invoices", "payments", "consent_records", "matter_counsel",
  "process_service", "courts", "court_vacations", "public_holidays", "lawyer_profiles",
  "staff_invites", "matter_court_numbers",
];

/** Firm-facing tables with no trigger at all. A change to one of these leaves no line here. */
const NOT_AUDITED = [
  "intake_forms", "content", "messages", "tasks", "court_events", "invoice_items", "matter_lawyers",
  "matter_statuses", "availability_rules", "availability_exceptions", "conflict_checks",
  "consultation_notes", "notifications",
];

/**
 * The cursor's timestamp, exactly as PostgREST returns one. It is checked against this and not
 * against Date.parse, which accepts a great deal of prose and would let a hand-edited URL put
 * something of its own choosing inside the filter expression below.
 */
const CURSOR_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}:\d{2}|Z)?$/;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * One value out of meta, as a person would read it.
 *
 * A calendar day is rendered in UTC — a DATE column holds a day, and shifting it into a zone
 * turns the tenth into the ninth for anybody west of Lagos. A full timestamp is rendered in the
 * reader's zone, because that one really is an instant.
 */
function describeValue(value: unknown, tz: string): string {
  if (value === null || value === undefined) return "not set";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (value === "") return "empty";
    if (DATE_ONLY.test(value)) return formatWhen(value, "UTC", { dateStyle: "medium" });
    if (TIMESTAMP.test(value)) {
      const iso = /(Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
      return formatWhen(iso, tz);
    }
    return value.length > 400 ? `${value.slice(0, 400)}… (shortened for this list)` : value;
  }
  const json = JSON.stringify(value);
  return json.length > 400 ? `${json.slice(0, 400)}… (shortened for this list)` : json;
}

/** "matters.update" → "changed"; a named action keeps its own name. */
function verbOf(action: string): string | null {
  if (action.endsWith(".insert")) return "added";
  if (action.endsWith(".update")) return "changed";
  if (action.endsWith(".delete")) return "deleted";
  return null;
}

function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-gray-100 py-1.5 first:border-0 sm:flex-row sm:gap-3">
      <code className="shrink-0 text-xs text-gray-500 sm:w-48">{name}</code>
      <span className="break-words text-sm text-gray-800">{children}</span>
    </div>
  );
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ firm?: string; before?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await staffContext(await requestedFirmId({ firm: sp.firm }));

  if (!ctx) {
    return (
      <Alert kind="warning" title="Not configured">
        Supabase environment variables are not set, or this account is not a member of a firm. See{" "}
        <code>.env.example</code>, or ask a firm owner to add you.
      </Alert>
    );
  }

  const { supabase, firmId, firmName, role: callerRole, isAdmin, timezone: tz } = ctx;

  // The cursor is the last line of the previous page: its timestamp and its id. Both are needed
  // because two lines written in the same transaction share a timestamp to the microsecond, and
  // a cursor on the timestamp alone would either skip them or loop on them for ever.
  let cursor: { at: string; id: string } | null = null;
  if (typeof sp.before === "string" && sp.before.includes("~")) {
    const [at, id] = sp.before.split("~");
    if (at && id && /^\d{1,19}$/.test(id) && CURSOR_AT.test(at)) cursor = { at, id };
  }
  // The reader asked for a particular place in the history and the URL could not be read. Say so,
  // rather than showing the newest page as though that is what was asked for.
  const cursorRejected = typeof sp.before === "string" && sp.before !== "" && cursor === null;

  let filtered = supabase
    .from("audit_log")
    .select("id, at, actor_id, action, entity, entity_id, meta")
    .eq("firm_id", firmId);

  if (cursor) {
    // Everything strictly older than the cursor line: an earlier instant, or the same instant
    // with a smaller id. This is the keyset the (firm_id, at desc) index serves. It is applied
    // before the ordering because a filter belongs to the query, not to the way it is sorted.
    filtered = filtered.or(`at.lt.${cursor.at},and(at.eq.${cursor.at},id.lt.${cursor.id})`);
  }

  const { data: rowData, error } = await filtered
    .order("at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE + 1);
  const fetched = (rowData ?? []) as unknown as AuditRow[];
  const hasMore = fetched.length > PAGE;
  const rows = hasMore ? fetched.slice(0, PAGE) : fetched;

  // Who did it. profiles_select is can_see_profile(), which covers everyone this firm shares a
  // membership, an appointment or a matter with — so a colleague who has since been removed may
  // no longer resolve, and that is said rather than shown as a blank.
  const actorIds = Array.from(new Set(rows.map((r) => r.actor_id).filter((id): id is string => Boolean(id))));
  const { data: profileRows } = actorIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", actorIds)
    : { data: [] as Array<{ id: string; full_name: string | null; email: string | null }> };
  const actorById = new Map(
    ((profileRows ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map((p) => [
      p.id,
      p.full_name?.trim() || p.email || null,
    ]),
  );

  const base = (extra?: Record<string, string>) => {
    const params = new URLSearchParams();
    if (sp.firm) params.set("firm", sp.firm);
    for (const [k, v] of Object.entries(extra ?? {})) params.set(k, v);
    const qs = params.toString();
    return qs ? `/firm/admin/audit?${qs}` : "/firm/admin/audit";
  };
  const last = rows[rows.length - 1];
  const olderHref = hasMore && last ? base({ before: `${last.at}~${last.id}` }) : null;

  return (
    <div className="space-y-5">
      <header className="min-w-0">
        <h2 className="font-heading text-2xl font-semibold text-brand">Audit trail</h2>
        <p className="text-sm text-gray-600">
          {firmName} · what has been done, in the order it happened, shown in your own time zone ({tz})
        </p>
      </header>

      {error && (
        <Alert kind="error" title="The audit trail could not be read">
          {error.message}
        </Alert>
      )}

      {!isAdmin && (
        <Alert kind="info" title={`You are ${callerRole} at ${firmName}`}>
          audit_log_select is has_firm_role(firm_id, owner or admin), so this list is empty for
          your account rather than short. An owner or an administrator of the firm can read it.
        </Alert>
      )}

      {cursorRejected && (
        <Alert kind="warning" title="That link did not say where to start">
          The position in the URL is not one this screen wrote, so it has been ignored and these are
          the newest entries. Page back from here with “Older entries”.
        </Alert>
      )}

      {cursor && (
        <Alert kind="info" title="You are looking back through the history">
          <p>
            Everything below happened before {formatWhen(cursor.at, tz, { dateStyle: "medium", timeStyle: "short" })}.
          </p>
          <p className="mt-2">
            <Link href={base()} className="font-medium underline">
              Back to the newest entries
            </Link>
          </p>
        </Alert>
      )}

      <Card>
        <CardHeader
          title={cursor ? "Older entries" : "The newest entries"}
          action={<Badge>{rows.length === 1 ? "1 line" : `${rows.length} lines`}</Badge>}
        />
        <CardBody className="space-y-3">
          {rows.length === 0 ? (
            isAdmin ? (
              <EmptyState
                title={cursor ? "There is nothing older than this" : "Nothing has been recorded for this firm yet"}
                hint={
                  cursor
                    ? "You have reached the first line the database holds for this firm."
                    : "The trail fills itself as the firm works — every matter opened, invoice issued, role changed and document filed writes a line, and nobody can edit or delete one."
                }
                action={
                  cursor ? (
                    <Link href={base()} className="min-h-[44px] py-2.5 font-medium text-brand underline">
                      Back to the newest entries
                    </Link>
                  ) : (
                    <Link href="/firm/matters/new" className="min-h-[44px] py-2.5 font-medium text-brand underline">
                      Open a matter
                    </Link>
                  )
                }
              />
            ) : (
              <EmptyState
                title="The audit trail is read by an owner or an administrator"
                hint="Nothing is hidden from you by this screen; the database simply returns no rows to your account."
                action={
                  <Link href="/firm" className="min-h-[44px] py-2.5 font-medium text-brand underline">
                    Back to Today
                  </Link>
                }
              />
            )
          ) : (
            rows.map((row) => {
              const meta = (row.meta ?? {}) as Record<string, unknown>;
              const changed =
                meta.changed && typeof meta.changed === "object" && !Array.isArray(meta.changed)
                  ? (meta.changed as Record<string, unknown>)
                  : null;
              const changedEntries = changed ? Object.entries(changed) : [];
              const hasFromTo = "from" in meta || "to" in meta;
              const otherKeys = Object.keys(meta).filter((k) => k !== "changed" && k !== "from" && k !== "to");
              const actor = row.actor_id ? actorById.get(row.actor_id) ?? null : null;
              const verb = verbOf(row.action);

              return (
                <article key={row.id} className="rounded-lg border border-gray-200 p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium text-gray-900">
                      <code className="text-sm">{row.action}</code>
                      {verb && <span className="ml-2 text-sm font-normal text-gray-600">({verb})</span>}
                    </p>
                    <time dateTime={row.at} className="text-sm text-gray-600">
                      {formatWhen(row.at, tz, { dateStyle: "medium", timeStyle: "medium" })}
                    </time>
                  </div>

                  <p className="mt-1 text-sm text-gray-600">
                    {row.actor_id
                      ? actor
                        ? `By ${actor}.`
                        : "By an account this firm can no longer read — profiles_select only shows people you still share a firm, a consultation or a matter with, so somebody removed from the firm stops resolving to a name."
                      : "By the database itself, with nobody signed in — a scheduled job or a provider webhook."}{" "}
                    On <code className="text-xs">{row.entity}</code>
                    {row.entity_id ? (
                      <>
                        {" "}
                        <span className="text-gray-500">({row.entity_id.slice(0, 8)}…)</span>
                      </>
                    ) : null}
                    .
                  </p>

                  {changedEntries.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Columns this write changed
                      </p>
                      <div className="mt-1">
                        {changedEntries.map(([field, value]) => (
                          <Field key={field} name={field}>
                            {describeValue(value, tz)}
                          </Field>
                        ))}
                      </div>
                      <p className="mt-2 text-xs text-gray-500">
                        These are the values the row was changed <span className="font-medium">to</span>. The row
                        trigger records what a column became, not what it was before, so there is no earlier value to
                        show here. Where the database wrote the line itself — a role change, a plan, a domain — it
                        records both, and both are shown.
                      </p>
                    </div>
                  )}

                  {hasFromTo && (
                    <div className="mt-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Before and after</p>
                      <div className="mt-1">
                        <Field name="before">{describeValue(meta.from, tz)}</Field>
                        <Field name="after">{describeValue(meta.to, tz)}</Field>
                      </div>
                    </div>
                  )}

                  {otherKeys.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Recorded with it</p>
                      <div className="mt-1">
                        {otherKeys.map((k) => (
                          <Field key={k} name={k}>
                            {describeValue(meta[k], tz)}
                          </Field>
                        ))}
                      </div>
                    </div>
                  )}

                  {changedEntries.length === 0 && !hasFromTo && otherKeys.length === 0 && (
                    <p className="mt-2 text-sm text-gray-500">
                      {changed
                        ? "This write moved no column: the row was saved with the values it already had, and the trigger recorded that nothing differed."
                        : "No detail was recorded with this line. A row that was added or deleted writes the fact and the row's id; only a change records the columns that moved."}
                    </p>
                  )}
                </article>
              );
            })
          )}
        </CardBody>
      </Card>

      {(olderHref || cursor) && (
        <nav aria-label="More of the audit trail" className="flex flex-wrap items-center gap-3">
          {olderHref && (
            <Link
              href={olderHref}
              className="inline-flex min-h-[44px] items-center rounded-lg border border-gray-300 px-4 text-sm font-medium text-brand hover:bg-black/5"
            >
              Older entries
            </Link>
          )}
          {cursor && (
            <Link
              href={base()}
              className="inline-flex min-h-[44px] items-center rounded-lg px-4 text-sm font-medium text-brand underline"
            >
              Back to the newest
            </Link>
          )}
        </nav>
      )}

      <Card>
        <CardHeader title="What this log does and does not cover" />
        <CardBody className="space-y-3 text-sm text-gray-600">
          <p>
            Every line is written by the database as the work happens, and nothing can change one
            afterwards. The names are the database's own: <code>matters.update</code> is a row that
            was changed, <code>invoice.issued</code> is a function that recorded what it did.
          </p>
          <p>
            <span className="font-medium text-gray-900">These tables write a line by themselves</span>{" "}
            whenever a row is added, changed or deleted: {ROW_AUDITED.join(", ")}.
          </p>
          <p>
            <span className="font-medium text-gray-900">These do not.</span> A change to{" "}
            {NOT_AUDITED.join(", ")} leaves no line here at all — most of all{" "}
            <span className="font-medium text-gray-900">intake_forms</span> and{" "}
            <span className="font-medium text-gray-900">content</span>, which are edited from this
            very console. Do not read a silence about them as “nothing happened”. Some of what
            those tables are used for is recorded another way — a court update writes a row in{" "}
            <code>updates</code>, which is audited — but the forms and the website pages are not.
          </p>
          <p>
            Docket's own acts on the firm — creating it, verifying it, suspending it, mapping a
            domain, setting a plan — are written here too, against this firm.
          </p>
          <p>
            There is no search box and no filter on this screen. The only index on this table is on
            (firm_id, at), so filtering by action or by entity would make the database read the
            firm's entire history for every page. Paging back through it is the honest way to find
            an old line.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
