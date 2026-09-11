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
import type { MatterStatus } from "@/lib/db/types";

export const metadata = { title: "Matters" };

const LIMIT = 200;
const field = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:outline-none";

/** matter_statuses.colour holds a colour name; Tailwind needs whole class names. */
const TONES: Record<string, string> = {
  slate: "border-slate-300 bg-slate-50 text-slate-800",
  gray: "border-gray-300 bg-gray-50 text-gray-700",
  grey: "border-gray-300 bg-gray-50 text-gray-700",
  blue: "border-blue-300 bg-blue-50 text-blue-900",
  sky: "border-sky-300 bg-sky-50 text-sky-900",
  indigo: "border-indigo-300 bg-indigo-50 text-indigo-900",
  violet: "border-violet-300 bg-violet-50 text-violet-900",
  purple: "border-purple-300 bg-purple-50 text-purple-900",
  green: "border-emerald-300 bg-emerald-50 text-emerald-900",
  emerald: "border-emerald-300 bg-emerald-50 text-emerald-900",
  teal: "border-teal-300 bg-teal-50 text-teal-900",
  amber: "border-amber-300 bg-amber-50 text-amber-900",
  orange: "border-orange-300 bg-orange-50 text-orange-900",
  red: "border-red-300 bg-red-50 text-red-900",
  rose: "border-rose-300 bg-rose-50 text-rose-900",
};

function StatusChip({ status }: { status: MatterStatus }) {
  const colour = (status.colour ?? "").trim();
  const hex = colour.startsWith("#");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        hex ? "bg-white" : TONES[colour.toLowerCase()] ?? "border-gray-300 bg-gray-50 text-gray-700",
      )}
      style={hex ? { borderColor: colour, color: colour } : undefined}
    >
      {status.label}
    </span>
  );
}

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
      "flex min-h-[44px] shrink-0 items-center rounded-full border px-4 text-sm",
      active ? "border-brand bg-brand text-brand-on" : "border-gray-300 bg-white text-gray-700 hover:border-brand",
    );

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-[22px] font-bold tracking-[-0.02em] text-[#141414]">Matters</h1>
          <p className="text-sm text-gray-600">
            {ctx.firmName} · {matters.length}
            {matters.length === LIMIT ? "+ " : " "}
            {matters.length === 1 ? "matter" : "matters"}
            {filtered ? " matching these filters" : ""} · court dates in {tz}
          </p>
        </div>
        <Link
          href="/firm/matters/new"
          className="flex min-h-[44px] items-center rounded-lg bg-brand px-4 text-sm font-medium text-brand-on hover:opacity-90"
        >
          Open a matter
        </Link>
      </header>

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
            <label htmlFor="q" className="text-sm font-medium text-gray-900">Search</label>
            <input
              id="q" name="q" type="search" inputMode="search" defaultValue={search} maxLength={80}
              placeholder="Reference, title or suit number" className={field}
            />
          </div>
          <div>
            <label htmlFor="lawyer" className="text-sm font-medium text-gray-900">Lawyer</label>
            <select id="lawyer" name="lawyer" defaultValue={lawyerId ?? ""} className={field}>
              <option value="">Everyone</option>
              {staff.map((m: StaffMember) => (
                <option key={m.user_id} value={m.user_id}>{staffLabel(m)}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" className="flex min-h-[44px] items-center rounded-lg bg-brand px-4 text-sm font-medium text-brand-on hover:opacity-90">
              Apply
            </button>
            {filtered && <Link href="/firm/matters" className="text-sm text-brand underline">Clear</Link>}
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader
          title={filtered ? `Matching matters (${matters.length})` : `All matters (${matters.length})`}
          action={<Link href="/firm/matters/new" className="text-sm text-brand underline">Open a matter →</Link>}
        />
        {matters.length === 0 ? (
          filtered ? (
            <EmptyState
              title="No matter matches these filters"
              hint="Widen the search, choose another status, or clear the filters to see every file."
              action={<Link href="/firm/matters" className="text-sm text-brand underline">Clear the filters</Link>}
            />
          ) : (
            <EmptyState
              title="No matters yet"
              hint="Open the first one: give it a title and a type, point it at a court, and invite the client so they can follow it in their app."
              action={
                <Link href="/firm/matters/new" className="flex min-h-[44px] items-center rounded-lg bg-brand px-4 text-sm font-medium text-brand-on hover:opacity-90">
                  Open a matter
                </Link>
              }
            />
          )
        ) : (
          <ul className="divide-y divide-gray-100">
            {matters.map((m: MatterListRow) => {
              const causeDiffers = Boolean(m.cause_title && m.cause_title.trim() !== m.title.trim());
              const conduct = m.handling_lawyer_id ?? m.lead_lawyer_id;
              const nextDatePassed = Boolean(m.next_event_at && new Date(m.next_event_at).getTime() < Date.now());
              return (
                <li key={m.id}>
                  <Link href={`/firm/matters/${m.id}`} className="block px-5 py-4 hover:bg-gray-50">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900">{m.title}</p>
                        {causeDiffers && <p className="mt-0.5 text-xs italic text-gray-600">{m.cause_title}</p>}
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {m.status && <StatusChip status={m.status} />}
                        {m.closed_at && (
                          <span className="inline-flex items-center rounded-full border border-gray-300 bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-700">
                            Closed
                          </span>
                        )}
                      </div>
                    </div>

                    <p className="mt-1 text-xs text-gray-600">
                      {m.reference} · {typeLabel(m.type)}
                      {m.client_names.length > 0 ? ` · ${m.client_names.join(", ")}` : " · no client on the file yet"}
                      {conduct && staffById.has(conduct) ? ` · ${staffById.get(conduct)}` : ""}
                    </p>

                    {(m.court_name || m.suit_number) && (
                      <p className="mt-1 text-xs text-gray-600">
                        {m.court_name ?? "Court not recorded"}
                        {m.suit_number ? ` · ${m.suit_number}` : ""}
                      </p>
                    )}

                    {m.next_event_at && (
                      <p className={cn("mt-1 text-xs", nextDatePassed ? "text-amber-800" : "text-gray-800")}>
                        {nextDatePassed ? "Court date has passed: " : "Next court date: "}
                        <strong>{formatWhen(m.next_event_at, tz, { dateStyle: "medium", timeStyle: "short" })}</strong>
                        {m.next_event_note ? ` · ${m.next_event_note}` : ""}
                      </p>
                    )}

                    {m.next_action && <p className="mt-1 text-xs font-medium text-brand">Next action: {m.next_action}</p>}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {matters.length === LIMIT && (
        <p className="text-xs text-gray-500">
          Showing the {LIMIT} most recently opened matters. Search by reference, title or suit number to reach an older file.
        </p>
      )}
    </div>
  );
}
