// Me and the firm: who the console thinks you are, what state this session is
// in, and the way through to the screens the four tabs do not reach.
//
// Everything on this page is read off the same context the rest of the console
// runs on — staffContext() for the firm, the role and the zone, the caller's
// own profile and lawyer_profiles row for the name and the enrolment number,
// and firm_overview for the counts. Every read runs as the signed-in staff
// member, so RLS is the authorization. Nothing is drawn that the database does
// not hold: there is no "verified at" line because Supabase does not tell the
// server when the second factor was satisfied, only that it was.
//
// The MFA state is on this screen because every write in the console depends on
// it — staff_w is member + mfa_ok + firm not suspended — and a lawyer who has
// been signed out of aal2 should be able to see that before a save refuses.

import { redirect } from "next/navigation";
import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { firmOverview, requestedFirmId, staffContext } from "@/lib/firm-data";
import { Alert } from "@/components/ui/alert";
import {
  AppButton,
  AppCard,
  AppCardHeader,
  AppCardList,
  AppPill,
  Footnote,
  ScreenTitle,
} from "@/components/app";
import { ChevronRightIcon } from "@/components/ui/icons";
import { PushOptIn } from "@/components/push/push-opt-in";

export const metadata = { title: "Me" };

/** Invoice states that are money still owed to the firm. */
const OWING_STATUSES = ["issued", "partially_paid", "overdue"];

/** "B. Okafor" → "BO". Letters only, at most two, upper case. */
function initialsOf(name: string): string {
  const letters = name
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}]/gu, "").charAt(0))
    .filter((letter) => letter.length > 0);
  const mark = `${letters[0] ?? ""}${letters[1] ?? ""}`;
  return (mark || name.charAt(0)).toUpperCase();
}

/** Signs this device out of the console and back to the console's own login. */
async function signOutOfConsole(): Promise<void> {
  "use server";
  const supabase = await supabaseServer();
  if (supabase) await supabase.auth.signOut();
  redirect("/firm/login");
}

export default async function ConsoleMePage({
  searchParams,
}: {
  searchParams: Promise<{ firm?: string }>;
}) {
  const { firm: firmParam } = await searchParams;
  const ctx = await staffContext(await requestedFirmId({ firm: firmParam }));

  if (!ctx) {
    return (
      <Alert kind="warning" title="Not configured">
        Supabase environment variables are not set, or this account is not a member of a firm.
        See <code>.env.example</code>, or ask a firm owner to add you.
      </Alert>
    );
  }

  const { supabase, firmId, userId, timezone: tz } = ctx;

  const [{ data: profileRow }, { data: lawyerRow }, overview, { count: owingInvoices }] = await Promise.all([
    supabase.from("profiles").select("full_name, email").eq("id", userId).maybeSingle(),
    supabase
      .from("lawyer_profiles")
      .select("title, scn, year_of_call")
      .eq("firm_id", firmId)
      .eq("user_id", userId)
      .maybeSingle(),
    firmOverview(supabase, firmId),
    supabase
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("firm_id", firmId)
      .in("status", OWING_STATUSES),
  ]);

  const profile = (profileRow ?? null) as { full_name: string | null; email: string | null } | null;
  const lawyer = (lawyerRow ?? null) as { title: string | null; scn: string | null; year_of_call: number | null } | null;

  const name = profile?.full_name?.trim() || profile?.email || "You";
  const standing = lawyer?.title?.trim() || ctx.role;
  // The Legal Practitioners Act enrolment number and the year of call — both
  // optional on lawyer_profiles, and a firm's non-lawyer staff have neither, so
  // the line disappears rather than showing an empty field.
  const credentials = [lawyer?.scn?.trim() || null, lawyer?.year_of_call ? `called ${lawyer.year_of_call}` : null]
    .filter((part): part is string => Boolean(part))
    .join(" · ");

  const links: Array<{ href: string; label: string; hint: string; count: number | null }> = [
    { href: "/firm/sittings", label: "Sittings", hint: "The chase list and the cause list", count: overview?.sittings_due ?? null },
    { href: "/firm/matters", label: "Matters", hint: "Every live file, searchable", count: overview?.open_matters ?? null },
    { href: "/firm/inbox", label: "Service inbox", hint: "Process served on this firm", count: overview?.service_to_acknowledge ?? null },
    { href: "/firm/invoices", label: "Invoices", hint: "Issued, part-paid and overdue", count: owingInvoices ?? null },
    { href: "/firm/availability", label: "Availability", hint: "Hours, breaks and the daily cap", count: null },
  ];

  return (
    <div className="dk-rise flex flex-col gap-3.5">
      <ScreenTitle>Me &amp; the firm</ScreenTitle>

      <section className="flex items-center gap-3 rounded-card border border-dk-line bg-white p-[15px] shadow-card">
        <span
          aria-hidden="true"
          className="grid h-12 w-12 flex-none place-items-center rounded-[10px] bg-dk-pri font-app-head text-[17px] font-bold text-dk-on-pri"
        >
          {initialsOf(name)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold text-dk-strong">{name}</p>
          <p className="mt-0.5 truncate text-[12px] text-dk-soft">
            {standing} · {ctx.firmName}
          </p>
          {credentials && <p className="mt-[3px] font-mono text-[11.5px] text-dk-soft">{credentials}</p>}
        </div>
      </section>

      <AppCard>
        <AppCardHeader title="Session" />
        <div className="divide-y divide-dk-rule">
          <Link href="/firm/security/mfa" className="flex min-h-[56px] items-center justify-between gap-3 px-[15px] py-[13px]">
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-dk-strong">Two-factor</span>
              <span className="mt-0.5 block text-[11.5px] leading-snug text-dk-soft">
                Required before any write in the console.
              </span>
            </span>
            <AppPill kind="confirmed">aal2</AppPill>
          </Link>
          {/* Renders nothing at all where the browser has no push, or no VAPID
              key is configured — hence empty:hidden rather than a row that is
              always drawn and sometimes blank. */}
          <div className="px-[15px] py-[13px] empty:hidden empty:p-0">
            <PushOptIn />
          </div>
        </div>
      </AppCard>

      <AppCard>
        <AppCardList>
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="flex min-h-[56px] items-center justify-between gap-3 px-[15px] py-3.5"
            >
              <span className="min-w-0">
                <span className="block text-[13.5px] font-semibold text-dk-strong">{l.label}</span>
                <span className="mt-0.5 block text-[11.5px] leading-snug text-dk-soft">{l.hint}</span>
              </span>
              <span className="flex flex-none items-center gap-2.5">
                {l.count !== null && (
                  <span className="grid h-[22px] min-w-[22px] place-items-center rounded-full bg-dk-rule px-1.5 text-[11px] font-bold text-dk-soft">
                    {l.count}
                  </span>
                )}
                <ChevronRightIcon size={16} className="text-dk-muted" />
              </span>
            </Link>
          ))}
        </AppCardList>
      </AppCard>

      <section className="rounded-card border border-dk-line bg-white px-[15px] py-3.5 shadow-card">
        <h2 className="text-[11px] uppercase tracking-[0.06em] text-dk-soft">This phone is a working tool</h2>
        <p className="mt-1.5 text-[12px] leading-[1.55] text-dk-soft">
          The console wears no firm&rsquo;s colours — those belong to the client app. Colour here means one thing:
          something is late, unpaid, or waiting on you.
        </p>
      </section>

      <form action={signOutOfConsole}>
        <AppButton type="submit" variant="ghost" className="w-full">
          Sign out
        </AppButton>
      </form>

      <Footnote>Times across the console are shown in {tz}, from your profile.</Footnote>
    </div>
  );
}
