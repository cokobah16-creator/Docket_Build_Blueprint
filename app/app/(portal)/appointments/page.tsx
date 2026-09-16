import Link from "next/link";
import { redirect } from "next/navigation";
import { loginPath } from "@/lib/auth-redirect-server";
import { supabaseServer } from "@/lib/supabase/server";
import { selectedFirm } from "@/lib/portal-firm";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { StatusPill, type Status } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Screen } from "@/components/portal/screen";
import { PageHeader, WithAside } from "@/components/shell/layout";

export const metadata = { title: "Appointments" };

interface AppointmentRow {
  id: string;
  reference: string;
  starts_at: string;
  ends_at: string;
  status: string;
  mode: string;
  client_timezone: string | null;
  service_id: string | null;
}

/** A consultation is joinable from ten minutes before until an hour after. */
function isLive(a: AppointmentRow, now: number): boolean {
  return (
    a.mode === "virtual" &&
    ["confirmed", "rescheduled"].includes(a.status) &&
    now >= new Date(a.starts_at).getTime() - 10 * 60 * 1000 &&
    now <= new Date(a.ends_at).getTime() + 60 * 60 * 1000
  );
}

export default async function AppointmentsPage() {
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(await loginPath("client"));
  const firm = await selectedFirm(supabase);

  let query = supabase
    .from("appointments")
    .select("id, reference, starts_at, ends_at, status, mode, client_timezone, service_id");
  if (firm) query = query.eq("firm_id", firm.id);
  const { data } = await query.order("starts_at", { ascending: false }).limit(20);
  const appointments = (data ?? []) as AppointmentRow[];

  // One lookup for the service names rather than one per row.
  const serviceIds = Array.from(new Set(appointments.map((a) => a.service_id).filter((v): v is string => Boolean(v))));
  const { data: serviceRows } = serviceIds.length
    ? await supabase.from("services").select("id, name").in("id", serviceIds)
    : { data: [] as Array<{ id: string; name: string }> };
  const serviceName = new Map(((serviceRows ?? []) as Array<{ id: string; name: string }>).map((s) => [s.id, s.name]));

  // One read, split in two: what is still to come, soonest first, and what has
  // been. The agenda a client actually wants is the first of those.
  const now = Date.now();
  const upcoming = appointments
    .filter((a) => new Date(a.ends_at).getTime() >= now)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = appointments.filter((a) => new Date(a.ends_at).getTime() < now);
  const bookHref = firm ? `/${firm.slug}/book` : null;

  const row = (a: AppointmentRow) => {
    const live = isLive(a, now);
    const when = new Intl.DateTimeFormat("en-GB", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: a.client_timezone ?? "Africa/Lagos",
    }).format(new Date(a.starts_at));
    return (
      <li key={a.id}>
        <div className="flex flex-col gap-2.5 border-t border-hairline px-4 py-3.5 first:border-t-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <Link href={`/app/appointments/${a.id}`} className="min-w-0 hover:underline">
            <p className="text-sm font-semibold text-ink">{when}</p>
            <p className="mt-0.5 text-xs text-ink-muted">
              <span className="font-mono">{a.reference}</span> · {a.mode.replace("_", " ")}
            </p>
            {a.service_id && serviceName.has(a.service_id) && (
              <p className="mt-0.5 text-xs text-ink-muted">{serviceName.get(a.service_id)}</p>
            )}
          </Link>
          <div className="flex shrink-0 flex-wrap items-center gap-2.5">
            <StatusPill status={a.status as Status} />
            {live && (
              <Link href={`/app/appointments/${a.id}/waiting-room`} className={buttonClasses("primary", "sm")}>
                Join now
              </Link>
            )}
          </div>
        </div>
      </li>
    );
  };

  return (
    <Screen>
      <PageHeader
        title="Appointments"
        description="Your consultations with this firm, soonest first."
        actions={
          bookHref && (
            <Link href={bookHref} className={buttonClasses("primary", "md", "hidden md:inline-flex")}>
              Book a Consultation
            </Link>
          )
        }
      />

      <WithAside
        from="xl"
        aside={
          <Card>
            <CardHeader title="Booking and changes" />
            <div className="space-y-3 px-[17px] py-[15px]">
              <p className="text-[12.5px] leading-relaxed text-ink-muted">
                A virtual consultation opens its waiting room ten minutes before the start. Tap
                Join then; there is nothing to install.
              </p>
              <p className="text-[12.5px] leading-relaxed text-ink-muted">
                Rescheduling and cancellation are on each appointment, free of charge up to 24
                hours before it.
              </p>
            </div>
          </Card>
        }
      >
        <Card>
          <CardHeader title={`Upcoming (${upcoming.length})`} />
          {upcoming.length === 0 ? (
            <EmptyState
              title="Nothing booked"
              hint="Your booked consultations appear here with their status and a Join button when the room opens."
              action={bookHref && <Link href={bookHref} className={buttonClasses("primary", "md")}>Book a Consultation</Link>}
            />
          ) : (
            <ul>{upcoming.map(row)}</ul>
          )}
        </Card>

        {past.length > 0 && (
          <Card>
            <CardHeader title={`Past (${past.length})`} />
            <ul>{past.map(row)}</ul>
          </Card>
        )}
      </WithAside>

      {/* Booking is offered exactly once at every width: in the header from md
          up, and here on a phone, where the header has no room for it and the
          thumb expects a full-width button at the end of the list. */}
      {bookHref && (
        <Link href={bookHref} className={buttonClasses("primary", "lg", "w-full md:hidden")}>
          <Icon name="calendar" size={18} />
          Book a Consultation
        </Link>
      )}
    </Screen>
  );
}
