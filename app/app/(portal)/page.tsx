// Client home: welcome, quick actions, next appointment (Join when live),
// matters, recent documents, outstanding balance, recent notifications.

import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { currentFirm } from "@/lib/firm";
import { readableForeground } from "@/lib/brand";
import { firmAppHref } from "@/lib/tenant";
import { clientFirms, clientMatters, firmMeta, firmNamesFor, outstandingByCurrency } from "@/lib/portal-data";
import { formatMoneyMinor } from "@/lib/money";
import { Alert } from "@/components/ui/alert";
import {
  AppAccentPill,
  AppCard,
  AppCardBody,
  AppCardHeader,
  AppCardList,
  AppEmpty,
  AppButtonLink,
  AppLink,
  AppScreen,
  AppStatusPill,
  Footnote,
} from "@/components/app";
import {
  BellIcon,
  CalendarIcon,
  CardIcon,
  DocumentIcon,
  MailIcon,
  PaperclipIcon,
  VideoIcon,
  type IconProps,
} from "@/components/ui/icons";
import { NotificationsList } from "@/components/portal/notifications-list";
import { IosInstallHint } from "@/components/portal/pwa-hints";
import { OfflineBanner } from "@/components/portal/connection";
import { FirmSwitcher, type FirmChoice } from "@/components/portal/firm-switcher";
import { ConsentGate } from "./consent-gate";
import type { Status } from "@/components/ui/badge";
import type { DocumentRow, NotificationRow } from "@/lib/db/types";

export const metadata = { title: "Home" };

interface AppointmentRow { id: string; reference: string; starts_at: string; ends_at: string; status: string; mode: string; lawyer_id: string | null }

export default async function ClientDashboard() {
  const supabase = await supabaseServer();
  if (!supabase) {
    return <Alert kind="warning" title="Not configured">Supabase environment variables are not set. See <code>.env.example</code>.</Alert>;
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/app/login");
  const firm = await currentFirm();

  if (firm) {
    const termsVersion = firm.policies.terms?.version;
    const privacyVersion = firm.policies.privacy?.version;
    // '0-…' versions are the unpublished skeleton every new firm starts with (seed_firm_defaults)
    if (termsVersion?.startsWith("0-") || privacyVersion?.startsWith("0-")) {
      return (
        <Alert kind="info" title={`${firm.name} has not published its terms yet`}>
          The firm is still completing its setup on Docket. Its terms of service and
          privacy notice will appear here for your acceptance once published.
        </Alert>
      );
    }
    if (termsVersion && privacyVersion) {
      const { data: consents } = await supabase.from("consent_records").select("kind, version").eq("firm_id", firm.id).eq("user_id", user.id);
      const rows = (consents ?? []) as Array<{ kind: string; version: string }>;
      if (!rows.some((r) => r.kind === "terms" && r.version === termsVersion) || !rows.some((r) => r.kind === "privacy" && r.version === privacyVersion)) {
        return <ConsentGate firmId={firm.id} firmName={firm.name} termsVersion={termsVersion} privacyVersion={privacyVersion} termsUrl={(firm.policies.terms?.url as string | null) ?? null} privacyUrl={(firm.policies.privacy?.url as string | null) ?? null} />;
      }
    }
  }

  const [{ data: profile }, { data: appt }, matters, { data: docRows }, { data: invoiceRows }, { data: notifRows }, firms, { count: unreadCount }] = await Promise.all([
    supabase.from("profiles").select("full_name, timezone").eq("id", user.id).maybeSingle(),
    supabase.from("appointments").select("id, reference, starts_at, ends_at, status, mode, lawyer_id").gte("ends_at", new Date().toISOString()).in("status", ["pending", "awaiting_payment", "confirmed", "rescheduled"]).order("starts_at", { ascending: true }).limit(1).maybeSingle(),
    clientMatters(supabase, 5),
    supabase.from("documents").select("id, firm_id, matter_id, appointment_id, name, category, client_visible, current_version_id, uploaded_by, reviewed_at, reviewed_by, created_at").is("deleted_at", null).order("created_at", { ascending: false }).limit(5),
    supabase.from("invoices").select("id, currency, total_minor, paid_minor, status").in("status", ["issued", "partially_paid", "overdue"]),
    supabase.from("notifications").select("id, firm_id, channel, event, payload, status, read_at, created_at").eq("channel", "in_app").order("created_at", { ascending: false }).limit(5),
    clientFirms(supabase),
    // Counted rather than derived from the five rows above: the badge used to
    // read off that page, so it could never say more than 5 however many were
    // waiting.
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("channel", "in_app").is("read_at", null),
  ]);
  const profileRow = (profile ?? null) as { full_name: string | null; timezone: string } | null;
  const nextAppointment = (appt ?? null) as AppointmentRow | null;
  const documents = (docRows ?? []) as DocumentRow[];
  const outstanding = outstandingByCurrency((invoiceRows ?? []) as Array<{ currency: string; total_minor: number; paid_minor: number; status: string }>);
  const notifications = (notifRows ?? []) as NotificationRow[];
  const firmNames = await firmNamesFor([...notifications.map((n) => n.firm_id ?? ""), ...documents.map((d) => d.firm_id)].filter(Boolean));
  const tz = profileRow?.timezone ?? "Africa/Lagos";
  const displayName = profileRow?.full_name ?? user.email ?? user.phone ?? "there";
  const unread = unreadCount ?? notifications.filter((n) => !n.read_at).length;

  const firmChoices: FirmChoice[] = firms.map((f) => ({
    id: f.id,
    name: f.name,
    meta: firmMeta(f),
    primary: f.primary,
    onPrimary: readableForeground(f.primary),
    href: firmAppHref(f),
    current: firm?.id === f.id,
  }));

  const now = Date.now();
  const liveNow = nextAppointment && nextAppointment.mode === "virtual" && ["confirmed", "rescheduled"].includes(nextAppointment.status)
    && now >= new Date(nextAppointment.starts_at).getTime() - 10 * 60 * 1000 && now <= new Date(nextAppointment.ends_at).getTime() + 60 * 60 * 1000;
  const firstMatter = matters[0] ?? null;
  const owing = Object.entries(outstanding);

  const quickActions: Array<{ label: string; href: string; Icon: (p: IconProps) => React.JSX.Element }> = [
    { label: "Book", href: firm ? `/${firm.slug}/book` : "/app/appointments", Icon: CalendarIcon },
    { label: "Join", href: nextAppointment && liveNow ? `/app/appointments/${nextAppointment.id}/waiting-room` : "/app/appointments", Icon: VideoIcon },
    { label: "Upload", href: firstMatter ? `/app/matters/${firstMatter.id}?tab=documents` : "/app/matters", Icon: PaperclipIcon },
    { label: "Message", href: firstMatter ? `/app/matters/${firstMatter.id}?tab=messages` : "/app/messages", Icon: MailIcon },
    { label: "Pay", href: "/app/payments", Icon: CardIcon },
  ];
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: tz });
  const dateOnly = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: tz });

  return (
    <AppScreen className="gap-4">
      <IosInstallHint appName={firm?.name ?? "Docket"} />
      <OfflineBanner />

      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-app-head text-[23px] font-semibold leading-tight tracking-[-0.015em] text-dk-pri">
            Welcome, {displayName}
          </h1>
          {firm && (
            <div className="mt-0.5">
              <FirmSwitcher firmName={firm.name} firms={firmChoices} />
            </div>
          )}
        </div>
        <Link
          href="/app/notifications"
          aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
          className="relative grid h-[42px] w-[42px] flex-none place-items-center rounded-full border border-dk-line bg-white text-dk-pri"
        >
          <BellIcon size={20} />
          {unread > 0 && (
            <span className="absolute -right-[3px] -top-[3px] grid h-[19px] min-w-[19px] place-items-center rounded-full bg-dk-pri px-[5px] text-[11px] font-bold text-dk-on-pri">
              {unread}
            </span>
          )}
        </Link>
      </header>

      <nav aria-label="Quick actions" className="grid grid-cols-5 gap-[7px]">
        {quickActions.map(({ label, href, Icon }) => (
          <Link
            key={label}
            href={href}
            className="flex min-h-[64px] flex-col items-center justify-center gap-[5px] rounded-[9px] border border-dk-line bg-white px-0.5 py-2.5 text-[11px] font-semibold text-dk-pri"
          >
            <Icon size={21} />
            {label}
          </Link>
        ))}
      </nav>

      <AppCard>
        <AppCardHeader title="Next appointment" action={<AppLink href="/app/appointments">All</AppLink>} />
        {nextAppointment ? (
          <AppCardBody className="flex flex-col gap-2.5">
            <p className="text-[14.5px] font-semibold leading-snug text-dk-strong">
              {new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: tz }).format(new Date(nextAppointment.starts_at))}
            </p>
            <p className="text-[13px] text-dk-soft">
              <span className="font-mono">{nextAppointment.reference}</span> · {nextAppointment.mode.replace("_", " ")}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <AppStatusPill status={nextAppointment.status as Status} />
              {liveNow ? (
                <AppButtonLink href={`/app/appointments/${nextAppointment.id}/waiting-room`} variant="primary-sm">
                  Join now
                </AppButtonLink>
              ) : (
                <AppLink href={`/app/appointments/${nextAppointment.id}`}>Details</AppLink>
              )}
            </div>
          </AppCardBody>
        ) : (
          <AppEmpty
            title="No upcoming consultations"
            hint="Book one and meet your lawyer face to face."
            action={firm && <AppButtonLink href={`/${firm.slug}/book`} variant="primary-sm">Book a Consultation</AppButtonLink>}
          />
        )}
      </AppCard>

      {owing.length > 0 && (
        <AppCard>
          <AppCardHeader title="Outstanding balance" action={<AppLink href="/app/payments">Pay</AppLink>} />
          <AppCardBody>
            {owing.map(([cur, minor]) => (
              <p key={cur} className="font-app-head text-[26px] font-semibold text-dk-pri">
                {formatMoneyMinor(minor, cur)}
              </p>
            ))}
          </AppCardBody>
        </AppCard>
      )}

      <AppCard>
        <AppCardHeader title="My matters" action={matters.length > 0 ? <AppLink href="/app/matters">All</AppLink> : undefined} />
        {matters.length === 0 ? (
          <AppEmpty title="No matters yet" hint="When your firm opens a matter for you, it appears here with its full timeline." />
        ) : (
          <AppCardList>
            {matters.map((m) => (
              <Link key={m.id} href={`/app/matters/${m.id}`} className="block px-[17px] py-[13px]">
                <div className="flex items-start justify-between gap-2.5">
                  <p className="text-[14px] font-semibold leading-snug text-dk-strong">{m.title}</p>
                  {m.status && (
                    <AppAccentPill colour={m.status.colour}>{m.status.label}</AppAccentPill>
                  )}
                </div>
                <p className="mt-1 text-[12px] text-dk-muted">
                  <span className="font-mono">{m.reference}</span> · {m.firm_name}
                  {m.lawyer_names.length ? ` · ${m.lawyer_names[0]}` : ""}
                </p>
                {m.last_update && (
                  <p className="mt-[3px] truncate text-[12px] text-dk-soft">
                    {m.last_update.title} · {fmt.format(new Date(m.last_update.occurred_at))}
                  </p>
                )}
                {m.next_action && (
                  <p className="mt-[5px] text-[12px] font-semibold text-dk-pri">Next: {m.next_action}</p>
                )}
              </Link>
            ))}
          </AppCardList>
        )}
      </AppCard>

      <AppCard>
        <AppCardHeader title="Recent documents" />
        {documents.length === 0 ? (
          <AppEmpty title="No documents have been shared yet" hint="Documents you upload or your lawyer shares will show here." />
        ) : (
          <AppCardList>
            {documents.map((d) => (
              <Link
                key={d.id}
                href={
                  d.matter_id
                    ? `/app/matters/${d.matter_id}?tab=documents`
                    : d.appointment_id
                      ? `/app/appointments/${d.appointment_id}`
                      : "/app/matters"
                }
                className="flex items-center justify-between gap-3 px-[17px] py-3"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <DocumentIcon size={17} className="flex-none text-gray-400" />
                  <span className="truncate text-[13.5px] text-dk-strong">{d.name}</span>
                </span>
                <span className="flex-none text-[11.5px] text-dk-muted">
                  {dateOnly.format(new Date(d.created_at))}
                </span>
              </Link>
            ))}
          </AppCardList>
        )}
      </AppCard>

      <AppCard>
        <AppCardHeader title="Recent notifications" action={<AppLink href="/app/notifications">All</AppLink>} />
        <NotificationsList rows={notifications} firmNames={firmNames} timezone={tz} compact />
      </AppCard>

      <Footnote className="pt-0.5 text-center">
        <Link href="/app/court-dates" className="underline">Court dates</Link> ·{" "}
        <Link href="/app/payments" className="underline">Payments</Link> ·{" "}
        <Link href="/app/profile" className="underline">Profile</Link>
      </Footnote>
    </AppScreen>
  );
}
