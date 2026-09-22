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
import { Badge, MatterStatusChip } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { formatDay, isPastDay } from "@/lib/days";

export const metadata = { title: "Matters" };

const LIMIT = 200;
const field = "mt-1 min-h-11 w-full rounded-control border border-edge bg-raised px-3 py-2 text-base text-ink focus:outline focus:outline-2 focus:outline-offset-1 focus:outline-ink-strong";

/** PostgREST's or() takes a comma-separated list, so those characters cannot travel in a search. */
function safeSearch(raw: string): string {
  return raw.replace(/[,()*%]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

const TYPE_LABELS: Record<string, string> = { ip: "Intellectual property", debt_recovery: "Debt recovery" };
function typeLabel(type: string): string {
  const label = TYPE_LABELS[type] ?? type.replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** The orders a register can be read in. All of them work on the fetched rows. */
const SORTS = {
  opened: "Recently opened",
  hearing: "Next hearing",
  action: "Next action due",
  title: "Title, A–Z",
} as const;
type SortKey = keyof typeof SORTS;

/** A far-future sentinel so rows with no date sort last rather than first. */
const NEVER = "9999-12-31";

function sortRows(rows: MatterListRow[], key: SortKey): MatterListRow[] {
  const copy = rows.slice();
  const nowIso = new Date().toISOString();
  switch (key) {
    case "hearing":
      // Upcoming dates first, soonest at the top; past or missing dates after.
      return copy.sort((a, b) => {
        const av = a.next_event_at && a.next_event_at >= nowIso ? a.next_event_at : NEVER;
        const bv = b.next_event_at && b.next_event_at >= nowIso ? b.next_event_at : NEVER;
        return av.localeCompare(bv);
      });
    case "action":
      return copy.sort((a, b) => (a.next_action_due ?? NEVER).localeCompare(b.next_action_due ?? NEVER));
    case "title":
      return copy.sort((a, b) => a.title.localeCompare(b.title, "en-GB", { sensitivity: "base" }));
    default:
      return copy; // firmMatters() already returns newest-opened first
  }
}

export default async function FirmMattersPage({
  searchParams,
}: {
  searchParams: Promise<{ firm?: string; status?: string; open?: string; lawyer?: string; q?: string; sort?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await staffContext(await requestedFirmId({ firm: sp.firm }));

  if (!ctx) {
    return (
      <Alert kind="warning" title="Matters are unavailable">
        This account is not a member of a firm, or the workspace could not be reached. Ask your firm&apos;s
        owner to add you, or try again in a moment.
      </Alert>
    );
  }

  const { supabase, firmId, timezone: tz } = ctx;
  const [statuses, staff] = await Promise.all([matterStatuses(supabase, firmId), firmStaff(supabase, firmId)]);

  const statusId = statuses.some((s) => s.id === sp.status) ? sp.status! : null;
  const lawyerId = staff.some((m) => m.user_id === sp.lawyer) ? sp.lawyer! : null;
  const openOnly = sp.open === "1";
  const search = safeSearch(sp.q ?? "");
  const sort: SortKey = sp.sort && sp.sort in SORTS ? (sp.sort as SortKey) : "opened";

  const fetched = await firmMatters(supabase, firmId, {
    statusId,
    openOnly,
    lawyerId,
    search: search || null,
    limit: LIMIT,
  });
  const matters = sortRows(fetched, sort);

  const staffById = new Map(staff.map((m) => [m.user_id, staffLabel(m)]));
  const filtered = Boolean(statusId || lawyerId || openOnly || search);
  const nowMs = Date.now();

  // Every link keeps every other choice, so nothing is lost on a tap.
  const query = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams();
    const base: Record<string, string | null> = {
      firm: sp.firm ?? null,
      status: statusId,
      open: openOnly ? "1" : null,
      lawyer: lawyerId,
      q: search || null,
      sort: sort === "opened" ? null : sort,
      ...patch,
    };
    for (const [key, value] of Object.entries(base)) if (value) params.set(key, value);
    const qs = params.toString();
    return qs ? `/firm/matters?${qs}` : "/firm/matters";
  };

  // Saved views: the questions a lawyer asks of the register most often, one
  // tap each. Each is only a combination of the filters below, so a view can
  // be refined and the URL still says exactly what is on screen.
  const views: Array<{ label: string; href: string; active: boolean }> = [
    { label: "All matters", href: query({ status: null, open: null, lawyer: null, q: null, sort: null }), active: !filtered && sort === "opened" },
    { label: "My matters", href: query({ lawyer: ctx.userId, open: "1", status: null, q: null }), active: lawyerId === ctx.userId && openOnly && !statusId && !search },
    { label: "Open", href: query({ open: "1", status: null, lawyer: null, q: null }), active: openOnly && !lawyerId && !statusId && !search },
    { label: "Upcoming hearings", href: query({ open: "1", sort: "hearing", status: null, lawyer: null, q: null }), active: openOnly && sort === "hearing" && !lawyerId && !statusId && !search },
    { label: "Actions due", href: query({ open: "1", sort: "action", status: null, lawyer: null, q: null }), active: openOnly && sort === "action" && !lawyerId && !statusId && !search },
  ];

  const nextHearing = (m: MatterListRow) => {
    if (!m.next_event_at) return <span className="text-ink-muted">None fixed</span>;
    const passed = new Date(m.next_event_at).getTime() < nowMs;
    return (
      <span className={cn(passed && "text-waiting-ink")}>
        {passed && <span className="font-semibold">Passed · </span>}
        {formatWhen(m.next_event_at, tz, { dateStyle: "medium", timeStyle: "short" })}
        {m.next_event_note && <span className="block text-11 text-ink-muted">{m.next_event_note}</span>}
      </span>
    );
  };

  const nextAction = (m: MatterListRow) => {
    if (!m.next_action) return <span className="text-ink-muted">None</span>;
    const late = Boolean(m.next_action_due && isPastDay(m.next_action_due, tz));
    return (
      <span>
        <span className="line-clamp-2">{m.next_action}</span>
        <span className={cn("block text-11", late ? "font-semibold text-wrong-ink" : "text-ink-muted")}>
          {m.next_action_owner_id ? staffById.get(m.next_action_owner_id) ?? "A colleague" : "Unassigned"}
          {m.next_action_due ? ` · ${late ? "overdue, was due" : "due"} ${formatDay(m.next_action_due)}` : ""}
        </span>
      </span>
    );
  };

  const flags = (m: MatterListRow) => (
    <>
      {m.status && <MatterStatusChip status={m.status} />}
      {m.access === "team" && <Badge tone="over" icon="shield">Restricted</Badge>}
      {m.closed_at && <Badge tone="quiet" icon="square">Closed</Badge>}
    </>
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-hairline pb-3">
        <div className="min-w-0">
          <h1 className="text-21 font-semibold tracking-[-0.01em] text-ink-strong md:text-26">Matters</h1>
          <p className="mt-0.5 text-13 text-ink-muted">
            {matters.length}
            {matters.length === LIMIT ? "+" : ""} {matters.length === 1 ? "matter" : "matters"}
            {filtered ? " matching these filters" : ""} · hearing times in {tz}
          </p>
        </div>
        <Link href="/firm/matters/new" className={buttonClasses("neutral", "sm")}>
          New matter
        </Link>
      </header>

      <nav aria-label="Saved views" className="-mx-1 flex gap-1 overflow-x-auto px-1">
        {views.map((v) => (
          <Link
            key={v.label}
            href={v.href}
            aria-current={v.active ? "page" : undefined}
            className={cn(
              "flex min-h-11 shrink-0 items-center rounded-control border px-3 text-13 font-medium",
              v.active ? "border-ink-strong bg-ink-strong text-paper" : "border-hairline bg-raised text-ink hover:border-edge",
            )}
          >
            {v.label}
          </Link>
        ))}
      </nav>

      <form method="get" action="/firm/matters" className="grid gap-3 rounded-card border border-hairline bg-raised p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto] lg:items-end">
        {sp.firm && <input type="hidden" name="firm" value={sp.firm} />}
        {openOnly && <input type="hidden" name="open" value="1" />}
        <div className="sm:col-span-2 lg:col-span-1">
          <label htmlFor="q" className="text-13 font-medium text-ink">Search</label>
          <input
            id="q" name="q" type="search" inputMode="search" defaultValue={search} maxLength={80}
            placeholder="Title, reference or suit number" className={field}
          />
        </div>
        <div>
          <label htmlFor="status" className="text-13 font-medium text-ink">Status</label>
          <select id="status" name="status" defaultValue={statusId ?? ""} className={field}>
            <option value="">Any status</option>
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="lawyer" className="text-13 font-medium text-ink">Lawyer</label>
          <select id="lawyer" name="lawyer" defaultValue={lawyerId ?? ""} className={field}>
            <option value="">Everyone</option>
            {staff.map((m: StaffMember) => (
              <option key={m.user_id} value={m.user_id}>{staffLabel(m)}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="sort" className="text-13 font-medium text-ink">Sort by</label>
          <select id="sort" name="sort" defaultValue={sort} className={field}>
            {(Object.keys(SORTS) as SortKey[]).map((k) => (
              <option key={k} value={k}>{SORTS[k]}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button type="submit" className={buttonClasses("neutral", "sm")}>Apply</button>
          {(filtered || sort !== "opened") && (
            <Link href="/firm/matters" className={buttonClasses("ghost", "sm")}>Clear</Link>
          )}
        </div>
      </form>

      <section aria-label="Matter register" className="overflow-hidden rounded-card border border-hairline bg-raised">
        {matters.length === 0 ? (
          filtered ? (
            <EmptyState
              title="No matter matches these filters"
              hint="Nothing in the register fits this search, status and lawyer together. Widen the search or clear the filters to see every file."
              action={<Link href="/firm/matters" className={buttonClasses("ghost", "sm")}>Clear the filters</Link>}
            />
          ) : (
            <EmptyState
              title="The register is empty"
              hint="Every file the firm opens is listed here with its court, suit number and next date. Open the first matter to start the register."
              action={<Link href="/firm/matters/new" className={buttonClasses("neutral", "sm")}>New matter</Link>}
            />
          )
        ) : (
          <>
            {/* Tablet and desktop: the register as a table. */}
            <div className="hidden md:block">
              <Table minWidth="60rem" caption="Matters">
                <THead>
                  <tr>
                    <TH className="w-[26%]">Matter</TH>
                    <TH>Client</TH>
                    <TH>Court · suit no.</TH>
                    <TH>Lawyer</TH>
                    <TH>Status</TH>
                    <TH aria-sort={sort === "hearing" ? "ascending" : undefined}>
                      <Link href={query({ sort: sort === "hearing" ? null : "hearing" })} className="underline-offset-2 hover:underline">Next hearing</Link>
                    </TH>
                    <TH aria-sort={sort === "action" ? "ascending" : undefined}>
                      <Link href={query({ sort: sort === "action" ? null : "action" })} className="underline-offset-2 hover:underline">Next action</Link>
                    </TH>
                  </tr>
                </THead>
                <TBody>
                  {matters.map((m) => {
                    const conduct = m.handling_lawyer_id ?? m.lead_lawyer_id;
                    return (
                      <TR key={m.id}>
                        <TD>
                          <Link href={`/firm/matters/${m.id}`} className="font-semibold text-ink-strong underline-offset-2 hover:underline">
                            {m.title}
                          </Link>
                          <span className="mt-0.5 block text-11 text-ink-muted">
                            <span className="font-mono">{m.reference}</span> · {typeLabel(m.type)}
                          </span>
                        </TD>
                        <TD>{m.client_names.length > 0 ? m.client_names.join(", ") : <span className="text-waiting-ink">No client yet</span>}</TD>
                        <TD>
                          {m.suit_number ? <span className="font-mono">{m.suit_number}</span> : <span className="text-ink-muted">No suit no.</span>}
                          <span className="block text-11 text-ink-muted">{m.court_name ?? "Court not recorded"}</span>
                        </TD>
                        <TD>{conduct && staffById.has(conduct) ? staffById.get(conduct) : <span className="text-ink-muted">Unassigned</span>}</TD>
                        <TD><div className="flex flex-col items-start gap-1">{flags(m)}</div></TD>
                        <TD className="whitespace-nowrap">{nextHearing(m)}</TD>
                        <TD className="min-w-[12rem]">{nextAction(m)}</TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </div>

            {/* Phone: the same rows, stacked — a table this wide cannot be read by scrolling sideways. */}
            <ul className="divide-y divide-hairline md:hidden">
              {matters.map((m) => (
                <li key={m.id}>
                  <Link href={`/firm/matters/${m.id}`} className="block px-3 py-3 hover:bg-hover">
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0 text-15 font-semibold text-ink-strong">{m.title}</span>
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">{flags(m)}</span>
                    <span className="mt-1.5 block text-13 text-ink-muted">
                      <span className="font-mono">{m.suit_number ?? m.reference}</span>
                      {m.court_name ? ` · ${m.court_name}` : ""}
                      {m.client_names.length > 0 ? ` · ${m.client_names.join(", ")}` : ""}
                    </span>
                    <span className="mt-1 block text-13 text-ink">
                      <span className="text-ink-muted">Next hearing: </span>{nextHearing(m)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {matters.length === LIMIT && (
        <p className="text-13 text-ink-muted">
          Showing the {LIMIT} most recently opened matters that match. Search by reference, title or suit number to reach an older file.
        </p>
      )}
    </div>
  );
}
