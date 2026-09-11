// Client home: welcome, quick actions, next appointment (Join when live),
// matters, recent documents, outstanding balance, recent notifications.
//
// Everything below the welcome belongs to one firm — the one named under it.
// A client acting with several firms taps that name to switch, and the whole
// screen repaints (src/lib/portal-firm.ts).

import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { clientFirms, selectedFirm } from "@/lib/portal-firm";
import { clientMatters, firmNamesFor, outstandingByCurrency } from "@/lib/portal-data";
import { formatMoneyMinor } from "@/lib/money";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { StatusPill, type Status } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { NotificationsList } from "@/components/portal/notifications-list";
import { IosInstallHint } from "@/components/portal/pwa-hints";
import { OfflineBanner } from "@/components/portal/offline-banner";
import { FirmSwitcher, type FirmChoice } from "@/components/portal/firm-switcher";
import { Screen } from "@/components/portal/screen";
import { ConsentGate } from "./consent-gate";
import { DEFAULT_TOKENS } from "@/lib/brand";
import type { DocumentRow, NotificationRow } from "@/lib/db/types";

export const metadata = { title: "Home" };

interface AppointmentRow { id: string; reference: string; starts_at: string; ends_at: string; status: string; mode: string; lawyer_id: string | null }

export default async function ClientDashboard() {
  const supabase = await supabaseServer();
  if (!supabase) {
    return (
      <Screen>
        <Alert kind="warning" title="Not configured">Supabase environment variables are not set. See <code>.env.example</code>.</Alert>
      </Screen>
    );
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/app/login");
  const firms = await clientFirms(supabase);
  const firm = await selectedFirm(supabase, firms);

  if (firm) {
    const termsVersion = firm.policies.terms?.version;
    const privacyVersion = firm.policies.privacy?.version;
    // '0-…' versions are the unpublished skeleton every new firm starts with (seed_firm_defaults)
    if (termsVersion?.startsWith("0-") || privacyVersion?.startsWith("0-")) {
      return (
        <Screen>
          <Alert kind="info" title={`${firm.name} has not published its terms yet`}>
            The firm is still completing its setup on Docket. Its terms of service and
            privacy notice will appear here for your acceptance once published.
          </Alert>
        </Screen>
      );
    }
    if (termsVersion && privacyVersion) {
      const { data: consents } = await supabase.from("consent_records").select("kind, version").eq("firm_id", firm.id).eq("user_id", user.id);
      const rows = (consents ?? []) as Array<{ kind: string; version: string }>;
      if (!rows.some((r) => r.kind === "terms" && r.version === termsVersion) || !rows.some((r) => r.kind === "privacy" && r.version === privacyVersion)) {
        return (
          <Screen>
            <ConsentGate firmId={firm.id} firmName={firm.name} termsVersion={termsVersion} privacyVersion={privacyVersion} termsUrl={(firm.policies.terms?.url as string | null) ?? null} privacyUrl={(firm.policies.privacy?.url as string | null) ?? null} />
          </Screen>
        );
      }
    }
  }

  // Every read below is narrowed to the firm on screen, so the page tells one
  // firm's story rather than merging several. The builders are constructed
  // first and awaited together — adding a filter must not cost a round trip.
  const firmId = firm?.id ?? null;

  let apptQuery = supabase.from("appointments").select("id, reference, starts_at, ends_at, status, mode, lawyer_id").gte("ends_at", new Date().toISOString()).in("status", ["pending", "awaiting_payment", "confirmed", "rescheduled"]);
  let docQuery = supabase.from("documents").select("id, firm_id, matter_id, appointment_id, name, category, client_visible, current_version_id, uploaded_by, reviewed_at, reviewed_by, created_at").is("deleted_at", null);
  let invoiceQuery = supabase.from("invoices").select("id, currency, total_minor, paid_minor, status").in("status", ["issued", "partially_paid", "overdue"]);
  let notifQuery = supabase.from("notifications").select("id, firm_id, channel, event, payload, status, read_at, created_at").eq("channel", "in_app");
  if (firmId) {
    apptQuery = apptQuery.eq("firm_id", firmId);
    docQuery = docQuery.eq("firm_id", firmId);
    invoiceQuery = invoiceQuery.eq("firm_id", firmId);
    notifQuery = notifQuery.eq("firm_id", firmId);
  }

  const [{ data: profile }, { data: appt }, matters, { data: docRows }, { data: invoiceRows }, { data: notifRows }] = await Promise.all([
    supabase.from("profiles").select("full_name, timezone").eq("id", user.id).maybeSingle(),
    apptQuery.order("starts_at", { ascending: true }).limit(1).maybeSingle(),
    clientMatters(supabase, 5, firmId),
    docQuery.order("created_at", { ascending: false }).limit(5),
    invoiceQuery,
    notifQuery.order("created_at", { ascending: false }).limit(5),
  ]);
  const profileRow = (profile ?? null) as { full_name: string | null; timezone: string } | null;
  const nextAppointment = (appt ?? null) as AppointmentRow | null;
  const documents = (docRows ?? []) as DocumentRow[];
  const outstanding = outstandingByCurrency((invoiceRows ?? []) as Array<{ currency: string; total_minor: number; paid_minor: number; status: string }>);
  const notifications = (notifRows ?? []) as NotificationRow[];
  const firmNames = await firmNamesFor([...notifications.map((n) => n.firm_id ?? ""), ...documents.map((d) => d.firm_id)].filter(Boolean));
  const tz = profileRow?.timezone ?? "Africa/Lagos";
  const displayName = profileRow?.full_name ?? user.email ?? user.phone ?? "there";
  const unread = notifications.filter((n) => !n.read_at).length;

  const now = Date.now();
  const liveNow = nextAppointment && nextAppointment.mode === "virtual" && ["confirmed", "rescheduled"].includes(nextAppointment.status)
    && now >= new Date(nextAppointment.starts_at).getTime() - 10 * 60 * 1000 && now <= new Date(nextAppointment.ends_at).getTime() + 60 * 60 * 1000;
  const firstMatter = matters[0] ?? null;
  const owing = Object.entries(outstanding);

  const quickActions: Array<{ label: string; href: string; icon: IconName }> = [
    { label: "Book", href: firm ? `/${firm.slug}/book` : "/app/appointments", icon: "calendar" },
    { label: "Join", href: nextAppointment && liveNow ? `/app/appointments/${nextAppointment.id}/waiting-room` : "/app/appointments", icon: "video" },
    { label: "Upload", href: firstMatter ? `/app/matters/${firstMatter.id}?tab=documents` : "/app/matters", icon: "paperclip" },
    { label: "Message", href: firstMatter ? `/app/matters/${firstMatter.id}?tab=messages` : "/app/messages", icon: "mail" },
    { label: "Pay", href: "/app/payments", icon: "card" },
  ];
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: tz });

  const choices: FirmChoice[] = firms.map((f) => ({
    id: f.id,
    name: f.name,
    meta: f.meta,
    primary: f.brand?.colours?.primary ?? DEFAULT_TOKENS.primary,
    heading: f.brand?.fonts?.heading ?? DEFAULT_TOKENS.headingFont,
    initial: f.name.trim().charAt(0).toUpperCase() || "·",
  }));

  const firmLine = firm && (
    <>
      <span className="block font-heading text-[23px] font-semibold leading-tight tracking-[-0.015em] text-brand">
        Welcome, {displayName}
      </span>
      <span className="mt-0.5 block text-[13px] text-gray-600">{firm.name}</span>
    </>
  );

  return (
    <Screen className="gap-4">
      <IosInstallHint appName={firm?.name ?? "Docket"} />
      <OfflineBanner />

      <header className="flex items-start justify-between gap-3">
        {/* One firm is a fact, several is a choice — only the second is a button. */}
        {choices.length > 1 && firm ? (
          <div className="min-w-0 flex-1">
            <FirmSwitcher firms={choices} selectedId={firm.id}>
              <span className="min-w-0">{firmLine}</span>
            </FirmSwitcher>
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            {firmLine ?? (
              <h1 className="font-heading text-[23px] font-semibold leading-tight tracking-[-0.015em] text-brand">
                Welcome, {displayName}
              </h1>
            )}
          </div>
        )}
        <Link
          href="/app/notifications"
          aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
          className="relative grid size-[42px] shrink-0 place-items-center rounded-full border border-gray-200 bg-white text-brand"
        >
          <Icon name="bell" size={20} strokeWidth={1.6} />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 grid h-[19px] min-w-[19px] place-items-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-brand-on">
              {unread}
            </span>
          )}
        </Link>
      </header>

      <nav aria-label="Quick actions" className="grid grid-cols-5 gap-[7px]">
        {quickActions.map((a) => (
          <Link
            key={a.label}
            href={a.href}
            className="flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-[9px] border border-gray-200 bg-white px-0.5 py-2.5 text-center text-[11px] font-semibold leading-tight text-brand hover:bg-black/5"
          >
            <Icon name={a.icon} size={21} strokeWidth={1.6} />
            {a.label}
          </Link>
        ))}
      </nav>

      <Card>
        <CardHeader title="Next appointment" action={<Link href="/app/appointments" className="text-[12.5px] font-medium text-brand underline underline-offset-2">All</Link>} />
        {nextAppointment ? (
          <CardBody className="space-y-2.5">
            <p className="text-[14.5px] font-semibold leading-snug text-gray-900">{new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: tz }).format(new Date(nextAppointment.starts_at))}</p>
            <p className="text-[13px] text-gray-600"><span className="font-mono">{nextAppointment.reference}</span> · {nextAppointment.mode.replace("_", " ")}</p>
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill status={nextAppointment.status as Status} />
              {liveNow ? (
                <Link href={`/app/appointments/${nextAppointment.id}/waiting-room`} className={buttonClasses("primary", "md")}>Join now</Link>
              ) : (
                <Link href={`/app/appointments/${nextAppointment.id}`} className="text-[12.5px] font-medium text-brand underline underline-offset-2">Details</Link>
              )}
            </div>
          </CardBody>
        ) : (
          <EmptyState title="No upcoming consultations" hint="Book one and meet your lawyer face to face." action={firm && <Link href={`/${firm.slug}/book`} className={buttonClasses("primary", "md")}>Book a Consultation</Link>} />
        )}
      </Card>

      {owing.length > 0 && (
        <Card>
          <CardHeader title="Outstanding balance" action={<Link href="/app/payments" className="text-[12.5px] font-medium text-brand underline underline-offset-2">Pay</Link>} />
          <CardBody>
            {owing.map(([cur, minor]) => <p key={cur} className="font-heading text-2xl font-semibold text-brand">{formatMoneyMinor(minor, cur)}</p>)}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="My matters" action={matters.length > 0 ? <Link href="/app/matters" className="text-[12.5px] font-medium text-brand underline underline-offset-2">All</Link> : undefined} />
        {matters.length === 0 ? (
          <EmptyState title="No matters yet" hint="When your firm opens a matter for you, it appears here with its full timeline." />
        ) : (
          <ul>
            {matters.map((m) => (
              <li key={m.id}>
                <Link href={`/app/matters/${m.id}`} className="block border-t border-gray-100 px-[17px] py-[13px] hover:bg-gray-50">
                  <div className="flex items-start justify-between gap-2.5">
                    <p className="text-sm font-semibold leading-snug text-gray-900">{m.title}</p>
                    {m.status && <span className="shrink-0 whitespace-nowrap rounded-full border border-brand-accent px-2.5 py-0.5 text-[11.5px] font-semibold text-brand-accent" style={m.status.colour ? { borderColor: m.status.colour, color: m.status.colour } : undefined}>{m.status.label}</span>}
                  </div>
                  <p className="mt-1 text-xs text-gray-500"><span className="font-mono">{m.reference}</span>{m.lawyer_names.length ? ` · ${m.lawyer_names[0]}` : ""}</p>
                  {m.last_update && <p className="mt-0.5 truncate text-xs text-gray-600">{m.last_update.title} · {fmt.format(new Date(m.last_update.occurred_at))}</p>}
                  {m.next_action && <p className="mt-1 text-xs font-semibold text-brand">Next: {m.next_action}</p>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Recent documents" />
        {documents.length === 0 ? (
          <EmptyState title="No documents have been shared yet" hint="Documents you upload or your lawyer shares will show here." />
        ) : (
          <ul>
            {documents.map((d) => (
              <li key={d.id}>
                <Link href={d.matter_id ? `/app/matters/${d.matter_id}?tab=documents` : `/app/appointments/${d.appointment_id}`} className="flex items-center justify-between gap-3 border-t border-gray-100 px-[17px] py-3 hover:bg-gray-50">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Icon name="file" size={17} strokeWidth={1.6} className="shrink-0 text-gray-400" />
                    <span className="truncate text-[13.5px] text-gray-900">{d.name}</span>
                  </span>
                  <span className="shrink-0 text-[11.5px] text-gray-500">{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: tz }).format(new Date(d.created_at))}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Recent notifications" action={<Link href="/app/notifications" className="text-[12.5px] font-medium text-brand underline underline-offset-2">All</Link>} />
        <NotificationsList rows={notifications} firmNames={firmNames} timezone={tz} compact />
      </Card>

      <p className="pt-0.5 text-center text-[11.5px] text-gray-500">
        <Link href="/app/court-dates" className="underline underline-offset-2">Court dates</Link> · <Link href="/app/payments" className="underline underline-offset-2">Payments</Link> · <Link href="/app/profile" className="underline underline-offset-2">Profile</Link>
      </p>
    </Screen>
  );
}
