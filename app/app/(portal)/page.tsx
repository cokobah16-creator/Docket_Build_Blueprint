// Client home, built around the questions a client actually has: does my
// lawyer need anything from me, where does my matter stand, what happens next,
// when is my next date, and do I owe anything. Plain words, no firm jargon.
//
// Everything below the welcome belongs to one firm — the one named under it.
// A client acting with several firms taps that name to switch, and the whole
// screen repaints (src/lib/portal-firm.ts).

import { WorkspaceUnavailable } from "@/components/ui/unavailable";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loginPath } from "@/lib/auth-redirect-server";
import { supabaseServer } from "@/lib/supabase/server";
import { clientFirms, selectedFirm } from "@/lib/portal-firm";
import { clientMatters, firmNamesFor, outstandingByCurrency } from "@/lib/portal-data";
import { formatMoneyMinor } from "@/lib/money";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { MatterStatusChip, StatusPill, type Status } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { NotificationsList } from "@/components/portal/notifications-list";
import { IosInstallHint } from "@/components/portal/pwa-hints";
import { OfflineBanner } from "@/components/portal/offline-banner";
import { FirmSwitcher, type FirmChoice } from "@/components/portal/firm-switcher";
import { Screen } from "@/components/portal/screen";
import { DEFAULT_TOKENS } from "@/lib/brand";
import type { DocumentRow, NotificationRow } from "@/lib/db/types";

export const metadata = { title: "Home" };

interface AppointmentRow { id: string; reference: string; starts_at: string; ends_at: string; status: string; mode: string; lawyer_id: string | null }

export default async function ClientDashboard() {
  const supabase = await supabaseServer();
  if (!supabase) {
    return (
      <Screen>
        <WorkspaceUnavailable audience="client" />
      </Screen>
    );
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(await loginPath("client"));
  const firms = await clientFirms(supabase);
  const firm = await selectedFirm(supabase, firms);

  // Consent to this firm's terms is asked for by the layout, on every route, not here.

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
  // Upload and Message go straight to the matter only when there is exactly one to go to. With
  // several, the client chooses on the matters list — it used to pick the newest, silently, so a
  // client with two files could send a message about one to the other and never know.
  const only = matters.length === 1 ? matters[0] : null;
  const pickOr = (tab: "documents" | "messages", fallback: string) =>
    only ? `/app/matters/${only.id}?tab=${tab}` : matters.length > 1 ? `/app/matters?for=${tab}` : fallback;
  const owing = Object.entries(outstanding);

  // Only actions that go somewhere real. "Join" appears only while a call is
  // actually open; it used to sit there permanently, pointing at the list.
  const quickActions: Array<{ label: string; href: string; icon: IconName }> = [
    ...(nextAppointment && liveNow ? [{ label: "Join call", href: `/app/appointments/${nextAppointment.id}/waiting-room`, icon: "video" as IconName }] : []),
    { label: "Message", href: pickOr("messages", "/app/messages"), icon: "mail" },
    { label: "Upload", href: pickOr("documents", "/app/matters"), icon: "paperclip" },
    ...(firm ? [{ label: "Book", href: `/${firm.slug}/book`, icon: "calendar" as IconName }] : []),
    { label: "Pay", href: "/app/payments", icon: "card" },
  ];
  const fmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: tz });
  const fullFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: tz });

  const attention: Array<{ key: string; title: string; detail?: string; href: string; cta: string }> = [];
  if (nextAppointment && liveNow) {
    attention.push({ key: "live", title: "Your consultation is open", detail: fullFmt.format(new Date(nextAppointment.starts_at)), href: `/app/appointments/${nextAppointment.id}/waiting-room`, cta: "Join now" });
  }
  for (const m of matters) {
    if (m.last_update?.action_required) {
      attention.push({
        key: `act-${m.id}`,
        title: "Your lawyer needs something from you",
        detail: `${m.last_update.client_action ?? m.last_update.title} · ${m.title}`,
        href: `/app/matters/${m.id}`,
        cta: "See what",
      });
    }
  }
  for (const [cur, minor] of owing) {
    attention.push({ key: `owe-${cur}`, title: `${formatMoneyMinor(minor, cur)} to pay`, detail: "Issued, part-paid or overdue invoices", href: "/app/payments", cta: "Pay" });
  }
  if (unread > 0) {
    attention.push({ key: "unread", title: `${unread} new ${unread === 1 ? "notification" : "notifications"}`, href: "/app/notifications", cta: "Read" });
  }

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
      <span className="workspace-eyebrow mb-1 block">Client portal</span>
      <span className="workspace-title block">Welcome, {displayName}</span>
      <span className="mt-0.5 block text-13 text-ink-muted">{firm.name}</span>
    </>
  );

  return (
    <Screen className="client-home gap-5">
      <IosInstallHint appName={firm?.name ?? "Docket"} />
      <OfflineBanner />
      <h1 className="sr-only">Your client workspace</h1>

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
              <p className="workspace-title">
                Welcome, {displayName}
              </p>
            )}
          </div>
        )}
        <Link
          href="/app/notifications"
          aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
          className="relative grid size-[44px] shrink-0 place-items-center rounded-full border border-hairline bg-raised text-brand"
        >
          <Icon name="bell" size={20} strokeWidth={1.6} />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 grid h-[19px] min-w-[19px] place-items-center rounded-full bg-brand px-1.5 text-11 font-bold text-brand-on">
              {unread}
            </span>
          )}
        </Link>
      </header>

      {/* What needs you. The first thing a client asks is whether their lawyer is waiting on
          them; the answer is a short list, or a sentence saying there is nothing. */}
      <section aria-labelledby="attention-heading" className="overflow-hidden rounded-card border border-hairline bg-raised">
        <h2 id="attention-heading" className="border-b border-hairline bg-sunken px-4 py-2.5 text-13 font-semibold text-ink-strong">
          Needs your attention
        </h2>
        {attention.length === 0 ? (
          <p className="px-4 py-3 text-13 text-ink-muted">
            Nothing needs you right now. Your lawyer will let you know here, and by message, when something does.
          </p>
        ) : (
          <ul className="divide-y divide-hairline">
            {attention.map((item) => (
              <li key={item.key}>
                <Link href={item.href} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5 hover:bg-hover">
                  <span className="min-w-0">
                    <span className="block text-15 font-semibold text-ink-strong">{item.title}</span>
                    {item.detail && <span className="block text-13 text-ink-muted">{item.detail}</span>}
                  </span>
                  <span className="shrink-0 text-13 font-semibold text-brand">{item.cta}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Where each matter stands, in the client's words: status, what happened last, what
          happens next, the next date and who is handling it. */}
      <section aria-labelledby="matters-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="matters-heading" className="text-17 font-semibold text-ink-strong">{matters.length === 1 ? "Your matter" : "Your matters"}</h2>
          {matters.length > 1 && <Link href="/app/matters" className="inline-flex min-h-11 items-center text-13 font-medium text-brand underline underline-offset-2">See all</Link>}
        </div>
        {matters.length === 0 ? (
          <div className="rounded-card border border-hairline bg-raised">
            <EmptyState
              title="No matters yet"
              hint="When your firm opens a matter for you, it appears here with its latest update, next court date and the lawyer handling it."
              action={firm ? <Link href={`/${firm.slug}/book`} className={buttonClasses("primary", "md")}>Book a consultation</Link> : undefined}
            />
          </div>
        ) : (
          matters.map((m) => (
            <article key={m.id} className="overflow-hidden rounded-card border border-hairline bg-raised">
              <header className="flex flex-wrap items-start justify-between gap-2 border-b border-hairline px-4 py-3">
                <div className="min-w-0">
                  <h3 className="text-17 font-semibold leading-snug text-ink-strong">
                    <Link href={`/app/matters/${m.id}`} className="underline-offset-2 hover:underline">{m.title}</Link>
                  </h3>
                  <p className="mt-0.5 text-13 text-ink-muted"><span className="font-mono">{m.suit_number ?? m.reference}</span>{m.court_name ? ` · ${m.court_name}` : ""}</p>
                </div>
                {m.status && <MatterStatusChip status={m.status} />}
              </header>
              <dl className="grid gap-x-6 gap-y-3 px-4 py-3 text-13 sm:grid-cols-2">
                <div>
                  <dt className="text-11 font-semibold uppercase tracking-[0.06em] text-ink-muted">Latest update</dt>
                  <dd className="mt-0.5 text-ink">
                    {m.last_update ? <>{m.last_update.title}<span className="block text-ink-muted">{fmt.format(new Date(m.last_update.occurred_at))}</span></> : "No update yet"}
                  </dd>
                </div>
                <div>
                  <dt className="text-11 font-semibold uppercase tracking-[0.06em] text-ink-muted">What happens next</dt>
                  <dd className="mt-0.5 text-ink">{m.last_update?.next_step ?? "Your lawyer will post the next update here"}</dd>
                </div>
                <div>
                  <dt className="text-11 font-semibold uppercase tracking-[0.06em] text-ink-muted">Next court date</dt>
                  <dd className="mt-0.5 text-ink">{m.next_event_at ? fullFmt.format(new Date(m.next_event_at)) : "None fixed yet"}</dd>
                </div>
                <div>
                  <dt className="text-11 font-semibold uppercase tracking-[0.06em] text-ink-muted">{m.lawyer_names.length === 1 ? "Your lawyer" : "Your lawyers"}</dt>
                  <dd className="mt-0.5 text-ink">{m.lawyer_names.length ? m.lawyer_names.join(", ") : "Not yet assigned"}</dd>
                </div>
              </dl>
              <footer className="flex flex-wrap gap-2 border-t border-hairline px-4 py-2.5">
                <Link href={`/app/matters/${m.id}`} className={buttonClasses("primary", "sm")}>Open matter</Link>
                <Link href={`/app/matters/${m.id}?tab=messages`} className={buttonClasses("ghost", "sm")}>Message your lawyer</Link>
                <Link href={`/app/matters/${m.id}?tab=documents`} className={buttonClasses("ghost", "sm")}>Documents</Link>
              </footer>
            </article>
          ))
        )}
      </section>

      <nav aria-label="Quick actions" className="grid gap-2" style={{ gridTemplateColumns: `repeat(${quickActions.length}, minmax(0, 1fr))` }}>
        {quickActions.map((a) => (
          <Link
            key={a.label}
            href={a.href}
            className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-control border border-hairline bg-raised px-0.5 py-2 text-center text-11 font-semibold leading-tight text-ink hover:bg-hover md:flex-row md:gap-2 md:text-13"
          >
            <Icon name={a.icon} size={19} strokeWidth={1.6} className="text-brand" />
            {a.label}
          </Link>
        ))}
      </nav>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Next appointment" action={<Link href="/app/appointments" className="text-13 font-medium text-brand underline underline-offset-2">All</Link>} />
          {nextAppointment ? (
            <CardBody className="space-y-2">
              <p className="text-15 font-semibold leading-snug text-ink">{fullFmt.format(new Date(nextAppointment.starts_at))}</p>
              <p className="text-13 text-ink-muted"><span className="font-mono">{nextAppointment.reference}</span> · {nextAppointment.mode.replace("_", " ")}</p>
              <div className="flex flex-wrap items-center gap-3">
                <StatusPill status={nextAppointment.status as Status} />
                <Link
                  href={liveNow ? `/app/appointments/${nextAppointment.id}/waiting-room` : `/app/appointments/${nextAppointment.id}`}
                  className={liveNow ? buttonClasses("primary", "sm") : "inline-flex min-h-11 items-center text-13 font-medium text-brand underline underline-offset-2"}
                >
                  {liveNow ? "Join now" : "Details"}
                </Link>
              </div>
            </CardBody>
          ) : (
            <EmptyState align="start" title="No upcoming appointments" hint="Consultations you book with your firm appear here, with a link to join when it is time." />
          )}
        </Card>

        <Card>
          <CardHeader title="Recent documents" />
          {documents.length === 0 ? (
            <EmptyState align="start" title="No documents yet" hint="Documents your lawyer shares with you, and ones you upload, appear here." />
          ) : (
            <ul>
              {documents.map((d) => (
                <li key={d.id}>
                  <Link href={d.matter_id ? `/app/matters/${d.matter_id}?tab=documents` : `/app/appointments/${d.appointment_id}`} className="flex min-h-11 items-center justify-between gap-3 border-t border-hairline px-4 py-2.5 first:border-t-0 hover:bg-hover">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Icon name="file" size={17} strokeWidth={1.6} className="shrink-0 text-ink-muted" />
                      <span className="truncate text-13 text-ink">{d.name}</span>
                    </span>
                    <span className="shrink-0 text-11 text-ink-muted">{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: tz }).format(new Date(d.created_at))}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Recent notifications" action={<Link href="/app/notifications" className="text-13 font-medium text-brand underline underline-offset-2">All</Link>} />
          <NotificationsList rows={notifications} firmNames={firmNames} timezone={tz} compact />
        </Card>
      </div>

      <p className="pt-0.5 text-center text-11 text-ink-muted">
        <Link href="/app/search" className="underline underline-offset-2">Search</Link> · <Link href="/app/authority" className="underline underline-offset-2">Who may act for me</Link> · <Link href="/app/court-dates" className="underline underline-offset-2">Court dates</Link> · <Link href="/app/payments" className="underline underline-offset-2">Payments</Link> · <Link href="/app/profile" className="underline underline-offset-2">Profile</Link>
      </p>
    </Screen>
  );
}
