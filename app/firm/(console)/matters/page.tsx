// The firm's matters: every live file, filtered by status, by the lawyer with
// conduct, or by a search across reference, title and suit number.
//
// Rules enforced here: every read runs as the signed-in staff member, so RLS
// (is_firm_member) is the authorization and no service key is ever used; the
// next court date is stored UTC and rendered in ctx.timezone with
// Intl.DateTimeFormat; nothing is firm-specific — the firm, its name, its
// statuses and its people all come from context; and the empty state always
// names the next action rather than leaving a dead end.

import Link from "next/link";
import {
  firmMatters, firmStaff, matterStatuses, requestedFirmId, staffContext, staffLabel,
  type MatterListRow, type StaffMember,
} from "@/lib/firm-data";
import { formatWhen } from "@/lib/time";
import { Alert } from "@/components/ui/alert";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { formatDay, isPastDay } from "@/lib/days";
import type { MatterStatus } from "@/lib/db/types";
import { PageHeader } from "@/components/shell/layout";
import { buttonClasses } from "@/components/ui/button";
import { StatusChip } from "@/components/firm/status-chip";

export const metadata = { title: "Matters" };

const LIMIT = 200;
const field = "mt-1 min-h-[44px] w-full rounded-lg border border-edge px-3 py-2 text-base text-ink focus:border-brand focus:outline focus:outline-2 focus:outline-brand";

/** matter_statuses.colour holds a colour name; Tailwind needs whole class names. */

/** PostgREST's or() takes a comma-separated list, so those characters cannot travel in a search. */
function safeSearch(raw: string): string {
  return raw.replace(/[,()*%]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

const TYPE_LABELS: Record<string, string> = { ip: "Intellectual property", debt_recovery: "Debt recovery" };
function typeLabel(type: string): string {
  const label = TYPE_LABELS[type] ?? type.replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export default async function FirmMattersPage({
  searchParams,
}: {
  searchParams: Promise<{ firm?: string; status?: string; open?: string; lawyer?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await staffContext(await requestedFirmId({ firm: sp.firm }));

  if (!ctx) {
    return (
      <Alert kind="warning" title="Not configured">
        Supabase environment variables are not set, or this account is not a member of a firm.
        See <code>.env.example</code>, or ask a firm owner to add you.
      </Alert>
    );
  }

  const { supabase, firmId, timezone: tz } = ctx;
  const [statuses, staff] = await Promise.all([matterStatuses(supabase, firmId), firmStaff(supabase, firmId)]);

  const statusId = statuses.some((s) => s.id === sp.status) ? sp.status! : null;
  const lawyerId = staff.some((m) => m.user_id === sp.lawyer) ? sp.lawyer! : null;
  const openOnly = sp.open === "1";
  const search = safeSearch(sp.q ?? "");

  const matters = await firmMatters(supabase, firmId, {
    statusId,
    openOnly,
    lawyerId,
    search: search || null,
    limit: LIMIT,
  });

  const staffById = new Map(staff.map((m) => [m.user_id, staffLabel(m)]));
  const filtered = Boolean(statusId || lawyerId || openOnly || search);

  // Chips and the filter form keep every other choice, so nothing is lost on a tap.
  const query = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams();
    const base: Record<string, string | null> = {
      firm: sp.firm ?? null,
      status: statusId,
      open: openOnly ? "1" : null,
      lawyer: lawyerId,
      q: search || null,
      ...patch,
    };
    for (const [key, value] of Object.entries(base)) if (value) params.set(key, value);
    const qs = params.toString();
    return qs ? `/firm/matters?${qs}` : "/firm/matters";
  };

  const chipClass = (active: boolean) =>
    cn(
      "flex min-h-[44px] shrink-0 items-center rounded-full border px-4 text-15",
      active ? "border-brand bg-brand text-brand-on" : "border-edge bg-raised text-ink hover:border-brand",
    );

  return (
    <div className="space-y-5">
      <PageHeader
        tone="neutral"
        title="Matters"
        description={`${ctx.firmName} · ${matters.length}${matters.length === LIMIT ? "+" : ""} ${matters.length === 1 ? "matter" : "matters"}${filtered ? " matching these filters" : ""} · court dates in ${tz}`}
        actions={
          <Link href="/firm/matters/new" className={buttonClasses("neutral", "md")}>
            Open a matter
          </Link>
        }
      />

      <nav aria-label="Filter by status" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        <Link href={query({ status: null, open: null })} aria-current={!statusId && !openOnly ? "page" : undefined} className={chipClass(!statusId && !openOnly)}>
          All
        </Link>
        <Link href={query({ open: openOnly ? null : "1" })} aria-current={openOnly ? "page" : undefined} className={chipClass(openOnly)}>
          Open only
        </Link>
        {statuses.map((s) => (
          <Link
            key={s.id}
            href={query({ status: statusId === s.id ? null : s.id })}
            aria-current={statusId === s.id ? "page" : undefined}
            className={chipClass(statusId === s.id)}
          >
            {s.label}
          </Link>
        ))}
      </nav>

      <Card>
        <form method="get" action="/firm/matters" className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          {sp.firm && <input type="hidden" name="firm" value={sp.firm} />}
          {statusId && <input type="hidden" name="status" value={statusId} />}
          {openOnly && <input type="hidden" name="open" value="1" />}
          <div>
            <label htmlFor="q" className="text-15 font-medium text-ink">Search</label>
            <input
              id="q" name="q" type="search" inputMode="search" defaultValue={search} maxLength={80}
              placeholder="Reference, title or suit number" className={field}
            />
          </div>
          <div>
            <label htmlFor="lawyer" className="text-15 font-medium text-ink">Lawyer</label>
            <select id="lawyer" name="lawyer" defaultValue={lawyerId ?? ""} className={field}>
              <option value="">Everyone</option>
              {staff.map((m: StaffMember) => (
                <option key={m.user_id} value={m.user_id}>{staffLabel(m)}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" className={buttonClasses("neutral", "md")}>
              Apply
            </button>
            {filtered && <Link href="/firm/matters" className="text-15 text-brand underline">Clear</Link>}
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader
          title={filtered ? `Matching matters (${matters.length})` : `All matters (${matters.length})`}
          action={<Link href="/firm/matters/new" className="text-15 text-brand underline">Open a matter →</Link>}
        />
        {matters.length === 0 ? (
          filtered ? (
            <EmptyState
              title="No matter matches these filters"
              hint="Widen the search, choose another status, or clear the filters to see every file."
              action={<Link href="/firm/matters" className="text-15 text-brand underline">Clear the filters</Link>}
            />
          ) : (
            <EmptyState
              title="No matters yet"
              hint="Open the first one: give it a title and a type, point it at a court, and invite the client so they can follow it in their app."
              action={
                <Link href="/firm/matters/new" className={buttonClasses("neutral", "md")}>
                  Open a matter
                </Link>
              }
            />
          )
        ) : (
          <ul className="divide-y divide-hairline">
            {matters.map((m: MatterListRow) => {
              const causeDiffers = Boolean(m.cause_title && m.cause_title.trim() !== m.title.trim());
              const conduct = m.handling_lawyer_id ?? m.lead_lawyer_id;
              const nextDatePassed = Boolean(m.next_event_at && new Date(m.next_event_at).getTime() < Date.now());
              return (
                <li key={m.id}>
                  <Link href={`/firm/matters/${m.id}`} className="block px-5 py-4 hover:bg-sunken">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-15 font-medium text-ink">{m.title}</p>
                        {causeDiffers && <p className="mt-0.5 text-13 italic text-ink-muted">{m.cause_title}</p>}
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {m.status && <StatusChip status={m.status} />}
                        {m.access === "team" && (
                          <span className="inline-flex items-center rounded-full bg-[#141414] px-2.5 py-0.5 text-13 font-medium text-white" title="Only this matter's team can open it">
                            Restricted
                          </span>
                        )}
                        {m.closed_at && (
                          <span className="inline-flex items-center rounded-full border border-edge bg-sunken px-2.5 py-0.5 text-13 font-medium text-ink">
                            Closed
                          </span>
                        )}
                      </div>
                    </div>

                    <p className="mt-1 text-13 text-ink-muted">
                      {m.reference} · {typeLabel(m.type)}
                      {m.client_names.length > 0 ? ` · ${m.client_names.join(", ")}` : " · no client on the file yet"}
                      {conduct && staffById.has(conduct) ? ` · ${staffById.get(conduct)}` : ""}
                    </p>

                    {(m.court_name || m.suit_number) && (
                      <p className="mt-1 text-13 text-ink-muted">
                        {m.court_name ?? "Court not recorded"}
                        {m.suit_number ? ` · ${m.suit_number}` : ""}
                      </p>
                    )}

                    {m.next_event_at && (
                      <p className={cn("mt-1 text-13", nextDatePassed ? "text-amber-800" : "text-ink")}>
                        {nextDatePassed ? "Court date has passed: " : "Next court date: "}
                        <strong>{formatWhen(m.next_event_at, tz, { dateStyle: "medium", timeStyle: "short" })}</strong>
                        {m.next_event_note ? ` · ${m.next_event_note}` : ""}
                      </p>
                    )}

                    {m.next_action && (
                      <p className="mt-1 text-13 font-medium text-brand">
                        Next action: {m.next_action}
                        {m.next_action_owner_id && <span className="font-normal text-ink-muted"> · {staffById.get(m.next_action_owner_id) ?? "a colleague"}</span>}
                        {m.next_action_due && (
                          <span className={cn("font-normal", isPastDay(m.next_action_due, tz) ? "font-semibold text-red-700" : "text-ink-muted")}>
                            {" · "}{isPastDay(m.next_action_due, tz) ? "overdue, was due " : "due "}{formatDay(m.next_action_due)}
                          </span>
                        )}
                      </p>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {matters.length === LIMIT && (
        <p className="text-13 text-ink-muted">
          Showing the {LIMIT} most recently opened matters. Search by reference, title or suit number to reach an older file.
        </p>
      )}
    </div>
  );
}
