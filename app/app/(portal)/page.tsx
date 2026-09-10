// Client home: welcome, quick actions, next appointment (Join when live),
// matters, recent documents, outstanding balance, recent notifications.

import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { currentFirm } from "@/lib/firm";
import { clientMatters, firmNamesFor, outstandingByCurrency } from "@/lib/portal-data";
import { formatMoneyMinor } from "@/lib/money";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { StatusPill, type Status } from "@/components/ui/badge";
import { NotificationsList } from "@/components/portal/notifications-list";
import { IosInstallHint } from "@/components/portal/pwa-hints";
import { ConsentGate } from "./consent-gate";
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

  const [{ data: profile }, { data: appt }, matters, { data: docRows }, { data: invoiceRows }, { data: notifRows }] = await Promise.all([
    supabase.from("profiles").select("full_name, timezone").eq("id", user.id).maybeSingle(),
    supabase.from("appointments").select("id, reference, starts_at, ends_at, status, mode, lawyer_id").gte("ends_at", new Date().toISOString()).in("status", ["pending", "awaiting_payment", "confirmed", "rescheduled"]).order("starts_at", { ascending: true }).limit(1).maybeSingle(),
    clientMatters(supabase, 5),
    supabase.from("documents").select("id, firm_id, matter_id, appointment_id, name, category, client_visible, current_version_id, uploaded_by, reviewed_at, reviewed_by, created_at").is("deleted_at", null).order("created_at", { ascending: false }).limit(5),
    supabase.from("invoices").select("id, currency, total_minor, paid_minor, status").in("status", ["issued", "partially_paid", "overdue"]),
    supabase.from("notifications").select("id, firm_id, channel, event, payload, status, read_at, created_at").eq("channel", "in_app").order("created_at", { ascending: false }).limit(5),
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

  const quickActions = [
    { label: "Book", href: firm ? `/${firm.slug}/book` : "/app/appointments", icon: "📅" },
    { label: "Join", href: nextAppointment && liveNow ? `/app/appointments/${nextAppointment.id}/waiting-room` : "/app/appointments", icon: "🎥" },
    { label: "Upload", href: firstMatter ? `/app/matters/${firstMatter.id}?tab=documents` : "/app/matters", icon: "📎" },
    { label: "Message", href: firstMatter ? `/app/matters/${firstMatter.id}?tab=messages` : "/app/messages", icon: "✉" },
    { label: "Pay", href: "/app/payments", icon: "₦" },
  ];
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: tz });

  return (
    <div className="space-y-5">
      <IosInstallHint appName={firm?.name ?? "Docket"} />
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-brand">Welcome, {displayName}</h1>
          {firm && <p className="text-sm text-gray-600">{firm.name}</p>}
        </div>
        <Link href="/app/notifications" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} className="relative rounded-full border border-gray-200 bg-white p-2 text-lg">
          <span aria-hidden="true">🔔</span>
          {unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-brand px-1.5 text-[10px] font-semibold text-white">{unread}</span>}
        </Link>
      </header>

      <nav aria-label="Quick actions" className="grid grid-cols-5 gap-2">
        {quickActions.map((a) => (
          <Link key={a.label} href={a.href} className="rounded-lg border border-gray-200 bg-white px-1 py-3 text-center text-xs font-medium text-brand hover:bg-black/5">
            <span aria-hidden="true" className="block text-base">{a.icon}</span>{a.label}
          </Link>
        ))}
      </nav>

      <Card>
        <CardHeader title="Next appointment" action={<Link href="/app/appointments" className="text-sm text-brand underline">All</Link>} />
        {nextAppointment ? (
          <CardBody className="space-y-2">
            <p className="text-sm font-medium text-gray-900">{new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: tz }).format(new Date(nextAppointment.starts_at))}</p>
            <p className="text-sm text-gray-600">{nextAppointment.reference} · {nextAppointment.mode.replace("_", " ")}</p>
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill status={nextAppointment.status as Status} />
              {liveNow ? (
                <Link href={`/app/appointments/${nextAppointment.id}/waiting-room`} className="rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:opacity-90">Join now</Link>
              ) : (
                <Link href={`/app/appointments/${nextAppointment.id}`} className="text-sm text-brand underline">Details</Link>
              )}
            </div>
          </CardBody>
        ) : (
          <EmptyState title="No upcoming consultations" hint="Book one and meet your lawyer face to face." action={firm && <Link href={`/${firm.slug}/book`} className="rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:opacity-90">Book a Consultation</Link>} />
        )}
      </Card>

      {owing.length > 0 && (
        <Card>
          <CardHeader title="Outstanding balance" action={<Link href="/app/payments" className="text-sm text-brand underline">Pay</Link>} />
          <CardBody>
            {owing.map(([cur, minor]) => <p key={cur} className="text-2xl font-semibold text-gray-900">{formatMoneyMinor(minor, cur)}</p>)}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="My matters" action={matters.length > 0 ? <Link href="/app/matters" className="text-sm text-brand underline">All</Link> : undefined} />
        {matters.length === 0 ? (
          <EmptyState title="No matters yet" hint="When your firm opens a matter for you, it appears here with its full timeline." />
        ) : (
          <CardBody className="divide-y divide-gray-100 p-0">
            {matters.map((m) => (
              <Link key={m.id} href={`/app/matters/${m.id}`} className="block px-5 py-3 hover:bg-gray-50">
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-medium text-gray-900">{m.title}</p>
                  {m.status && <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs" style={m.status.colour ? { borderColor: m.status.colour, color: m.status.colour } : undefined}>{m.status.label}</span>}
                </div>
                <p className="text-xs text-gray-500">{m.reference} · {m.firm_name}{m.lawyer_names.length ? ` · ${m.lawyer_names[0]}` : ""}</p>
                {m.last_update && <p className="mt-1 truncate text-xs text-gray-600">{m.last_update.title} · {fmt.format(new Date(m.last_update.occurred_at))}</p>}
                {m.next_action && <p className="mt-1 text-xs font-medium text-brand">Next: {m.next_action}</p>}
              </Link>
            ))}
          </CardBody>
        )}
      </Card>

      <Card>
        <CardHeader title="Recent documents" />
        {documents.length === 0 ? (
          <EmptyState title="No documents have been shared yet" hint="Documents you upload or your lawyer shares will show here." />
        ) : (
          <CardBody className="divide-y divide-gray-100 p-0">
            {documents.map((d) => (
              <Link key={d.id} href={d.matter_id ? `/app/matters/${d.matter_id}?tab=documents` : `/app/appointments/${d.appointment_id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-gray-50">
                <span className="truncate text-sm text-gray-900">📎 {d.name}</span>
                <span className="shrink-0 text-xs text-gray-500">{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: tz }).format(new Date(d.created_at))}</span>
              </Link>
            ))}
          </CardBody>
        )}
      </Card>

      <Card>
        <CardHeader title="Recent notifications" action={<Link href="/app/notifications" className="text-sm text-brand underline">All</Link>} />
        <NotificationsList rows={notifications} firmNames={firmNames} timezone={tz} compact />
      </Card>

      <p className="text-center text-xs text-gray-500"><Link href="/app/court-dates" className="underline">Court dates</Link> · <Link href="/app/payments" className="underline">Payments</Link> · <Link href="/app/profile" className="underline">Profile</Link></p>
    </div>
  );
}
