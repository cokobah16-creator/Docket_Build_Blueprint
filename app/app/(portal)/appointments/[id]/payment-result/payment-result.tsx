"use client";

// The waiting screen after a booking payment (the twin of the invoice's paid
// screen): a medallion, one line of reassurance, the rows that make up what
// was held, and the way onward.
//
// Nothing here confirms anything — the Paystack webhook and record_payment()
// do that, and this page only watches. Realtime on our own appointment row
// (RLS-scoped) with a 5s poll behind it, and a 1s tick for the hold countdown.
//
// The countdown stays on screen when it reaches 0:00 rather than disappearing:
// a timer that vanishes reads as a timer that was met, and the honest state at
// zero is that the hold has run out while the provider may still answer.

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { startPayment } from "@/lib/actions/booking";
import { Alert } from "@/components/ui/alert";
import { CheckIcon, ClockIcon, WarningIcon } from "@/components/ui/icons";
import {
  AppButton,
  AppButtonLink,
  AppCard,
  AppCardList,
  AppScreen,
  Footnote,
  appButtonClass,
} from "@/components/app";

/** One label/value line of the receipt-shaped card. */
function Row({
  label,
  children,
  mono,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3 px-4 py-3.5 text-[13px]">
      <span className="flex-none text-dk-muted">{label}</span>
      <span
        className={`text-right font-semibold text-dk-strong${mono ? " font-mono" : ""}`}
      >
        {children}
      </span>
    </div>
  );
}

export function PaymentResult({
  appointmentId, reference, initialStatus, holdExpiresAt, startsAt, timezone, invoiceId, bookHref,
}: {
  appointmentId: string; reference: string; initialStatus: string; holdExpiresAt: string | null;
  startsAt: string; timezone: string; invoiceId: string | null; bookHref: string;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [expiresAt, setExpiresAt] = useState(holdExpiresAt);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);

  // Realtime on our own row (RLS-scoped) with a polling fallback; never writes.
  useEffect(() => {
    const supabase = supabaseBrowser();
    if (!supabase) return;
    const apply = (row: { status?: string; hold_expires_at?: string | null } | null) => {
      if (!row?.status) return;
      setStatus(row.status);
      setExpiresAt(row.hold_expires_at ?? null);
    };
    const channel = supabase
      .channel(`appointment-${appointmentId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "appointments", filter: `id=eq.${appointmentId}` },
        (payload) => apply(payload.new as { status?: string; hold_expires_at?: string | null }),
      )
      .subscribe();
    const poll = setInterval(async () => {
      const { data } = await supabase.from("appointments").select("status, hold_expires_at").eq("id", appointmentId).maybeSingle();
      apply(data as { status?: string; hold_expires_at?: string | null } | null);
    }, 5000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [appointmentId]);

  const remainingMs = expiresAt ? new Date(expiresAt).getTime() - now : 0;
  const mm = Math.max(0, Math.floor(remainingMs / 60000));
  const ss = Math.max(0, Math.floor((remainingMs % 60000) / 1000));
  const when = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: timezone }).format(new Date(startsAt));
  const held = Boolean(expiresAt);
  const lapsed = held && remainingMs <= 0;

  async function retry() {
    setError(null);
    const r = await startPayment(appointmentId);
    if (r?.error) setError(r.error);
  }

  // The medallions use the app's own semantic pair — the green and amber the
  // pills are drawn in, and the red kept for actual bad news — never the
  // firm's colours, because this says whether money moved. The glyph and the
  // heading say it too, so the colour is never carrying it alone.
  if (status === "confirmed" || status === "rescheduled" || status === "completed") {
    return (
      <AppScreen>
        <div className="flex flex-col items-center gap-3.5 px-2 pb-1 pt-3 text-center">
          <span className="grid h-[62px] w-[62px] flex-none place-items-center rounded-full border border-[#A7D8BE] bg-[#ECFDF3] text-[#05603A]">
            <CheckIcon size={30} />
          </span>
          <h1 className="font-app-head text-[22px] font-semibold leading-[1.25] tracking-[-0.015em] text-dk-pri">
            You&rsquo;re booked
          </h1>
          <p className="max-w-[280px] text-[13.5px] leading-[1.5] text-dk-soft">
            Payment received. Consultation <span className="font-mono">{reference}</span> is
            confirmed.
          </p>
        </div>

        <AppCard>
          <AppCardList>
            <Row label="Consultation" mono>{reference}</Row>
            <Row label="When">{when}</Row>
            <Row label="Timezone">{timezone}</Row>
          </AppCardList>
        </AppCard>

        <AppButtonLink href={`/app/appointments/${appointmentId}`}>
          View appointment
        </AppButtonLink>
        {invoiceId && (
          <div className="flex">
            <Link href={`/app/payments/${invoiceId}`} className={appButtonClass("ghost")}>
              Receipt
            </Link>
          </div>
        )}
      </AppScreen>
    );
  }

  if (status === "cancelled") {
    return (
      <AppScreen>
        <div className="flex flex-col items-center gap-3.5 px-2 pb-1 pt-3 text-center">
          <span className="grid h-[62px] w-[62px] flex-none place-items-center rounded-full border border-[#E5C4C4] bg-[#FEF3F2] text-[#912018]">
            <WarningIcon size={30} />
          </span>
          <h1 className="font-app-head text-[22px] font-semibold leading-[1.25] tracking-[-0.015em] text-dk-pri">
            Your hold expired
          </h1>
          <p className="max-w-[280px] text-[13.5px] leading-[1.5] text-dk-soft">
            We didn&rsquo;t receive payment in time, so the slot was released. Nothing has
            been charged.
          </p>
        </div>

        <AppCard>
          <AppCardList>
            <Row label="Consultation" mono>{reference}</Row>
            <Row label="Slot held">{when}</Row>
          </AppCardList>
        </AppCard>

        <AppButtonLink href={bookHref}>Book again</AppButtonLink>
        <div className="flex">
          <Link href={`/app/appointments/${appointmentId}`} className={appButtonClass("ghost")}>
            Appointment details
          </Link>
        </div>
      </AppScreen>
    );
  }

  return (
    <AppScreen>
      <div className="flex flex-col items-center gap-3.5 px-2 pb-1 pt-3 text-center">
        <span className="grid h-[62px] w-[62px] flex-none place-items-center rounded-full border border-[#F3DDA4] bg-[#FFFAEB] text-[#92400E]">
          <ClockIcon size={30} />
        </span>
        <h1 className="font-app-head text-[22px] font-semibold leading-[1.25] tracking-[-0.015em] text-dk-pri">
          Confirming your payment
        </h1>
        <p className="max-w-[280px] text-[13.5px] leading-[1.5] text-dk-soft">
          We&rsquo;re waiting for the payment provider to confirm. This page updates by
          itself — no need to refresh.
        </p>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <AppCard>
        <AppCardList>
          <Row label="Consultation" mono>{reference}</Row>
          <Row label="When">{when}</Row>
          {held && (
            <Row label={lapsed ? "Hold ran out" : "Slot held for"} mono>
              {mm}:{String(ss).padStart(2, "0")}
            </Row>
          )}
        </AppCardList>
      </AppCard>

      <AppButton onClick={retry}>Haven&rsquo;t paid yet? Pay now</AppButton>
      <div className="flex">
        <Link href={`/app/appointments/${appointmentId}`} className={appButtonClass("ghost")}>
          Appointment details
        </Link>
      </div>

      {lapsed && (
        <Footnote>
          The hold on this slot has run out. If your payment did go through, this page
          will still say so as soon as the provider confirms it.
        </Footnote>
      )}
    </AppScreen>
  );
}
