// "Me and the firm": who you are signed in as, what your session is allowed to
// do, and the five sections that do not earn a bottom tab — sittings, matters,
// the service inbox, invoices and availability.
//
// The MFA state is shown rather than assumed: every write in this console
// depends on aal2, and a lawyer who has dropped to aal1 should find that out
// here rather than from a refused save.

import Link from "next/link";
import { staffContext, firmOverview, firmStaff, requestedFirmId, staffLabel } from "@/lib/firm-data";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { PushOptIn } from "@/components/push/push-opt-in";
import { staffSignOut } from "@/lib/actions/staff";
import { ProfileEditor, type PractitionerProfile } from "./profile-editor";
import { CalendarFeedPanel } from "./calendar-feed-panel";
import { supabaseUrl } from "@/lib/env";
import type { CalendarFeedStatus } from "@/lib/db/types";

export const metadata = { title: "Me" };

export default async function StaffMe({ searchParams }: { searchParams: Promise<{ firm?: string }> }) {
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

  const { supabase, firmId, userId, timezone } = ctx;
  const [overview, staff, { data: invoiceRows }, { data: profileRow }, { data: categoryRows }, { data: firmRow }, { data: feedRows }] = await Promise.all([
    firmOverview(supabase, firmId),
    firmStaff(supabase, firmId),
    supabase.from("invoices").select("id").eq("firm_id", firmId).in("status", ["issued", "partially_paid", "overdue"]),
    // The practitioner's own row: lawyer_profiles_select is the firm's; the write is their own.
    supabase.from("lawyer_profiles").select("title, bio, practice_areas, category, is_public, slug").eq("firm_id", firmId).eq("user_id", userId).maybeSingle(),
    supabase.from("services").select("lawyer_category").eq("firm_id", firmId).limit(200),
    supabase.from("firms").select("slug, status").eq("id", firmId).maybeSingle(),
    // Their own subscribed calendar, if they have issued one. The function returns the fact, never
    // the token: nothing on this page can show an address that already exists.
    supabase.rpc("calendar_feed_status", { p_firm: firmId }),
  ]);
  const profile = (profileRow ?? null) as PractitionerProfile | null;
  const feed = ((feedRows ?? []) as CalendarFeedStatus[])[0] ?? null;
  const base = supabaseUrl();
  const feedBase = base ? `${base.replace(/\/+$/, "")}/functions/v1/calendar-feed` : null;
  const categories = Array.from(new Set(((categoryRows ?? []) as Array<{ lawyer_category: string | null }>).map((r) => (r.lawyer_category ?? "").trim()).filter(Boolean))).sort();
  const firmSlug = (firmRow as { slug: string; status: "pending" | "active" | "suspended" } | null)?.slug ?? "";
  const firmStatus = (firmRow as { slug: string; status: "pending" | "active" | "suspended" } | null)?.status ?? "pending";

  const me = staff.find((m) => m.user_id === userId) ?? null;
  const name = me ? staffLabel(me) : "You";
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join("") || "·";
  const openInvoices = (invoiceRows ?? []).length;

  const links: Array<{ href: string; label: string; hint: string; count: number | null; urgent?: boolean }> = [
    { href: "/firm/search", label: "Search", hint: "Every matter, update, message, note and file name", count: null },
    { href: "/firm/sittings", label: "Sittings", hint: "The chase list and the cause list", count: overview?.sittings_due ?? null, urgent: (overview?.sittings_due ?? 0) > 0 },
    { href: "/firm/messages", label: "Messages", hint: "Every thread; the ones awaiting a reply", count: overview?.threads_awaiting_reply ?? null, urgent: (overview?.threads_awaiting_reply ?? 0) > 0 },
    { href: "/firm/tasks", label: "Tasks", hint: "The firm's open tasks, with owners", count: overview?.overdue_tasks ?? null, urgent: (overview?.overdue_tasks ?? 0) > 0 },
    { href: "/firm/uploads", label: "Uploads to review", hint: "What clients sent in, unlooked-at", count: overview?.client_uploads ?? null, urgent: (overview?.client_uploads ?? 0) > 0 },
    { href: "/firm/matters", label: "Matters", hint: "Every live file, searchable", count: overview?.open_matters ?? null },
    { href: "/firm/collaborations", label: "Work from other firms", hint: "Referrals, joint counsel and agency asked of us", count: null },
    { href: "/firm/inbox", label: "Service inbox", hint: "Process served on this firm", count: overview?.service_to_acknowledge ?? null, urgent: (overview?.service_to_acknowledge ?? 0) > 0 },
    { href: "/firm/invoices", label: "Invoices", hint: "Issued, part-paid and overdue", count: openInvoices },
    { href: "/firm/availability", label: "Availability", hint: "Hours, breaks and the daily cap", count: null },
    { href: "/firm/overview", label: "Firm overview", hint: "The whole firm at a glance", count: null },
    // Owners and admins only: the screens under /firm/admin ask admin_w() on every write, so the
    // link is offered to the people the database will let through. Until now it was reachable by
    // typing the address and nothing else.
    ...(ctx.isAdmin
      ? [{ href: "/firm/admin", label: "Administration", hint: "Settings, services, intake forms, people and the audit log", count: null }]
      : []),
  ];

  return (
    <div className="flex flex-col gap-3.5">
      <h1 className="font-heading text-[22px] font-bold tracking-[-0.02em] text-[#141414]">Me &amp; the firm</h1>

      <div className="flex items-center gap-3.5 rounded-card border border-[#DDD9D2] bg-white p-[15px]">
        <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-[10px] bg-[#141414] font-heading text-[17px] font-bold text-white">
          {initials}
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-bold text-[#141414]">{name}</p>
          <p className="mt-0.5 text-xs text-[#57534E]">
            {me?.title ?? ctx.role} · {ctx.firmName}
          </p>
          {me?.scn && <p className="mt-0.5 font-mono text-[11.5px] text-[#57534E]">{me.scn}</p>}
        </div>
      </div>

      <Card>
        <CardHeader title="Session" />
        <div className="flex flex-col gap-3 px-[15px] py-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-[#141414]">Two-factor</p>
              <p className="mt-0.5 text-[11.5px] leading-[1.45] text-[#57534E]">
                Required before any write. You would not be reading this screen without it.
              </p>
            </div>
            <Badge tone="settled" icon="check">aal2</Badge>
          </div>
          <div className="border-t border-[#F0EEEA] pt-3">
            <PushOptIn />
          </div>
        </div>
      </Card>

      {profile && (
        <Card>
          <CardHeader title="My profile on the firm's site" />
          <ProfileEditor firmId={firmId} userId={userId} firmSlug={firmSlug} firmStatus={firmStatus} profile={profile} categories={categories} />
        </Card>
      )}

      <CalendarFeedPanel firmId={firmId} feed={feed} feedBase={feedBase} timezone={timezone} />

      <Card>
        <ul>
          {links.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                className="flex items-center justify-between gap-3 border-t border-[#F0EEEA] px-[15px] py-3.5 first:border-t-0 hover:bg-gray-50"
              >
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold text-[#141414]">{l.label}</span>
                  <span className="mt-0.5 block text-[11.5px] text-[#57534E]">{l.hint}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2.5">
                  {l.count !== null && l.count > 0 && (
                    <span
                      className={
                        l.urgent
                          ? "grid h-[22px] min-w-[22px] place-items-center rounded-full bg-[#FFFAEB] px-1.5 text-[11px] font-bold text-[#92400E]"
                          : "grid h-[22px] min-w-[22px] place-items-center rounded-full bg-[#F0EEEA] px-1.5 text-[11px] font-bold text-[#57534E]"
                      }
                    >
                      {l.count}
                    </span>
                  )}
                  <Icon name="chevron-right" size={16} strokeWidth={2} className="text-gray-500" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <div className="rounded-card border border-[#DDD9D2] bg-white px-[15px] py-3.5">
        <p className="text-[11px] uppercase tracking-[0.06em] text-[#57534E]">This phone is a working tool</p>
        <p className="mt-1.5 text-xs leading-[1.55] text-[#57534E]">
          The console wears no firm&apos;s colours — those belong to the client app. Colour here means
          one thing: something is late, unpaid, or waiting on you.
        </p>
      </div>

      <form action={staffSignOut}>
        <Button type="submit" variant="ghost" size="lg" className="w-full border-[#D6D3CE] text-[#141414]">
          Sign out
        </Button>
      </form>
    </div>
  );
}
