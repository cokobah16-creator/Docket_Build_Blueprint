// The firm's matters: every live file, filtered by status, by the lawyer with
// conduct, or by a search across reference, title and suit number.
//
// Rules enforced here: every read runs as the signed-in staff member, so RLS
// (is_firm_member) is the authorization and no service key is ever used; the
// next court date is stored UTC and rendered in ctx.timezone with
// Intl.DateTimeFormat; nothing is firm-specific — the firm, its name, its
// statuses and its people all come from context; and the empty state always
// names the next action rather than leaving a dead end.
//
// Drawn on the phone kit as the console's own screen (design/pwa): neutral
// ink throughout, because the console wears no firm's colours. The one
// exception is the line that says a court date has already passed, which keeps
// its #92400E and says so in words as well.

import Link from "next/link";
import {
  firmMatters, firmStaff, matterStatuses, requestedFirmId, staffContext, staffLabel,
  type MatterListRow, type StaffMember,
} from "@/lib/firm-data";
import { formatWhen } from "@/lib/time";
import { Alert } from "@/components/ui/alert";
import {
  AppAccentPill,
  AppButton,
  AppButtonLink,
  AppCard,
  AppCardHeader,
  AppCardList,
  AppEmpty,
  AppLink,
  AppPill,
  Footnote,
  ScreenTitle,
} from "@/components/app";
import { SearchIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

export const metadata = { title: "Matters" };

const LIMIT = 200;

/** The input inside the artboard's 46px search box — the box draws the border. */
const searchInput = "w-full min-w-0 bg-transparent text-[13.5px] text-dk-strong placeholder:text-dk-muted focus:outline-none";
const field =
  "mt-1.5 min-h-[44px] w-full rounded-[9px] border border-dk-field bg-white px-3 py-[11px] text-[14px] text-dk-strong focus:border-dk-pri focus:outline-none";
const fieldLabel = "text-[12px] font-semibold uppercase tracking-[0.04em] text-dk-soft";

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
      "flex min-h-[44px] shrink-0 items-center rounded-full border px-3.5 text-[12.5px] font-medium",
      active ? "border-dk-pri bg-dk-pri text-dk-on-pri" : "border-dk-field bg-white text-dk-soft",
    );

  return (
    <div className="dk-rise flex flex-col gap-3.5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <ScreenTitle>Matters</ScreenTitle>
          <p className="mt-[3px] text-[12.5px] leading-snug text-dk-soft">
            {ctx.firmName} · {matters.length}
            {matters.length === LIMIT ? "+ " : " "}
            {matters.length === 1 ? "matter" : "matters"}
            {filtered ? " matching these filters" : ""} · court dates in {tz}
          </p>
        </div>
        <AppButtonLink href="/firm/matters/new" variant="ghost-sm" className="self-start">
          Open a matter
        </AppButtonLink>
      </header>

      <nav aria-label="Filter by status" className="-mx-1 flex gap-[7px] overflow-x-auto px-1 pb-0.5">
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

      <AppCard>
        <form method="get" action="/firm/matters" className="grid gap-3 px-[17px] py-[15px] sm:grid-cols-[1fr_auto_auto] sm:items-end">
          {sp.firm && <input type="hidden" name="firm" value={sp.firm} />}
          {statusId && <input type="hidden" name="status" value={statusId} />}
          {openOnly && <input type="hidden" name="open" value="1" />}
          <div>
            <label htmlFor="q" className={fieldLabel}>Search</label>
            <div className="mt-1.5 flex min-h-[46px] items-center gap-2.5 rounded-[10px] border border-dk-line bg-white px-[13px]">
              <SearchIcon size={17} className="flex-none text-dk-soft" />
              <input
                id="q" name="q" type="search" inputMode="search" defaultValue={search} maxLength={80}
                placeholder="Reference, title or suit number" className={searchInput}
              />
            </div>
          </div>
          <div>
            <label htmlFor="lawyer" className={fieldLabel}>Lawyer</label>
            <select id="lawyer" name="lawyer" defaultValue={lawyerId ?? ""} className={field}>
              <option value="">Everyone</option>
              {staff.map((m: StaffMember) => (
                <option key={m.user_id} value={m.user_id}>{staffLabel(m)}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <AppButton type="submit" variant="ghost-sm">
              Apply
            </AppButton>
            {filtered && <AppLink href="/firm/matters" className="inline-flex min-h-[44px] items-center">Clear</AppLink>}
          </div>
        </form>
      </AppCard>

      <AppCard>
        <AppCardHeader
          title={filtered ? `Matching matters (${matters.length})` : `All matters (${matters.length})`}
          action={<AppLink href="/firm/matters/new" className="-my-3 inline-flex min-h-[44px] items-center">Open a matter</AppLink>}
        />
        {matters.length === 0 ? (
          filtered ? (
            <AppEmpty
              title="No matter matches these filters"
              hint="Widen the search, choose another status, or clear the filters to see every file."
              action={<AppLink href="/firm/matters" className="inline-flex min-h-[44px] items-center">Clear the filters</AppLink>}
            />
          ) : (
            <AppEmpty
              title="No matters yet"
              hint="Open the first one: give it a title and a type, point it at a court, and invite the client so they can follow it in their app."
              action={
                <AppButtonLink href="/firm/matters/new" variant="primary-sm">
                  Open a matter
                </AppButtonLink>
              }
            />
          )
        ) : (
          <AppCardList>
            {matters.map((m: MatterListRow) => {
              const causeDiffers = Boolean(m.cause_title && m.cause_title.trim() !== m.title.trim());
              const conduct = m.handling_lawyer_id ?? m.lead_lawyer_id;
              const nextDatePassed = Boolean(m.next_event_at && new Date(m.next_event_at).getTime() < Date.now());
              return (
                <Link key={m.id} href={`/firm/matters/${m.id}`} className="block px-[15px] py-[13px]">
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-semibold leading-[1.35] text-dk-strong">{m.title}</p>
                      {causeDiffers && (
                        <p className="mt-[3px] text-[11.5px] italic leading-[1.45] text-dk-soft">{m.cause_title}</p>
                      )}
                    </div>
                    {/* The firm names and colours its own statuses; the console shows
                        the name only, in its own grey, because no console token reads
                        a firm token. The client app is where the colour belongs. */}
                    <div className="flex flex-none flex-wrap items-center gap-1.5">
                      {m.status && <AppAccentPill>{m.status.label}</AppAccentPill>}
                      {m.closed_at && <AppPill kind="completed">Closed</AppPill>}
                    </div>
                  </div>

                  <p className="mt-1 text-[11.5px] leading-[1.45] text-dk-soft">
                    <span className="font-mono">{m.reference}</span> · {typeLabel(m.type)}
                    {m.client_names.length > 0 ? ` · ${m.client_names.join(", ")}` : " · no client on the file yet"}
                    {conduct && staffById.has(conduct) ? ` · ${staffById.get(conduct)}` : ""}
                  </p>

                  {(m.court_name || m.suit_number) && (
                    <p className="mt-[3px] text-[11.5px] leading-[1.45] text-dk-soft">
                      {m.court_name ?? "Court not recorded"}
                      {m.suit_number ? " · " : ""}
                      {m.suit_number ? <span className="font-mono">{m.suit_number}</span> : null}
                    </p>
                  )}

                  {m.next_event_at && (
                    <p
                      className={cn(
                        "mt-1 text-[11.5px] leading-[1.45]",
                        nextDatePassed ? "font-semibold text-[#92400E]" : "text-dk-body",
                      )}
                    >
                      {nextDatePassed ? "Court date has passed: " : "Next court date: "}
                      <strong>{formatWhen(m.next_event_at, tz, { dateStyle: "medium", timeStyle: "short" })}</strong>
                      {m.next_event_note ? ` · ${m.next_event_note}` : ""}
                    </p>
                  )}

                  {m.next_action && (
                    <p className="mt-1 text-[11.5px] font-semibold leading-[1.45] text-dk-strong">
                      Next action: {m.next_action}
                    </p>
                  )}
                </Link>
              );
            })}
          </AppCardList>
        )}
      </AppCard>

      {matters.length === LIMIT && (
        <Footnote>
          Showing the {LIMIT} most recently opened matters. Search by reference, title or suit number to reach an older file.
        </Footnote>
      )}
    </div>
  );
}
