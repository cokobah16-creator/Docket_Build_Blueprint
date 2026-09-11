// Client appointments list (design/pwa artboard, CLIENT · APPOINTMENTS):
// one card of rows — when, mono reference · mode, status — and the way to
// book another underneath it.

import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { currentFirmSlug } from "@/lib/firm";
import {
  AppScreen,
  ScreenTitle,
  AppCard,
  AppCardList,
  AppEmpty,
  AppStatusPill,
  AppButtonLink,
} from "@/components/app";
import type { Status } from "@/components/ui/badge";

export const metadata = { title: "Appointments" };

interface AppointmentRow {
  id: string;
  reference: string;
  starts_at: string;
  status: string;
  mode: string;
  client_timezone: string | null;
}

export default async function AppointmentsPage() {
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/app/login");

  const { data } = await supabase
    .from("appointments")
    .select("id, reference, starts_at, status, mode, client_timezone")
    .order("starts_at", { ascending: false })
    .limit(20);
  const appointments = (data ?? []) as AppointmentRow[];

  // The booking wizard lives on the firm's own site, so the button only
  // exists when the request resolved to a firm (middleware, blueprint §4).
  const slug = await currentFirmSlug();
  const bookHref = slug ? `/${slug}/book` : null;

  return (
    <AppScreen>
      <ScreenTitle>Appointments</ScreenTitle>

      <AppCard>
        {appointments.length === 0 ? (
          <AppEmpty
            title="No consultations yet"
            hint="Your booked consultations appear here with their status and join button."
            action={
              bookHref ? (
                <AppButtonLink href={bookHref} variant="primary-sm">
                  Book a Consultation
                </AppButtonLink>
              ) : undefined
            }
          />
        ) : (
          <AppCardList>
            {appointments.map((a) => (
              <Link
                key={a.id}
                href={`/app/appointments/${a.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3.5 text-left"
              >
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold text-dk-strong">
                    {new Intl.DateTimeFormat("en-GB", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: a.client_timezone ?? "Africa/Lagos",
                    }).format(new Date(a.starts_at))}
                  </span>
                  <span className="mt-[3px] block text-[12px] text-dk-muted">
                    <span className="font-mono">{a.reference}</span> ·{" "}
                    {a.mode.replace(/_/g, " ")}
                  </span>
                </span>
                <AppStatusPill status={a.status as Status} />
              </Link>
            ))}
          </AppCardList>
        )}
      </AppCard>

      {bookHref && appointments.length > 0 && (
        <AppButtonLink href={bookHref}>Book a Consultation</AppButtonLink>
      )}
    </AppScreen>
  );
}
