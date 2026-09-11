"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { startPayment } from "@/lib/actions/booking";

export function PaymentResult({
  appointmentId, reference, initialStatus, holdExpiresAt, startsAt, timezone, invoiceId, invoiceNumber, amount, bookHref,
}: {
  appointmentId: string; reference: string; initialStatus: string; holdExpiresAt: string | null;
  startsAt: string; timezone: string; invoiceId: string | null; invoiceNumber: string | null;
  amount: string | null; bookHref: string;
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

  async function retry() {
    setError(null);
    const r = await startPayment(appointmentId);
    if (r?.error) setError(r.error);
  }

  if (status === "confirmed" || status === "rescheduled" || status === "completed") {
    return (
      <div className="flex flex-col gap-4 pt-3">
        <div className="flex flex-col items-center gap-3 px-2 pb-1 pt-2 text-center">
          <span className="grid size-[62px] place-items-center rounded-full border border-[#A7D8BE] bg-[#ECFDF3] text-[#05603A]">
            <Icon name="check" size={30} strokeWidth={2.4} />
          </span>
          <h1 className="font-heading text-[22px] font-semibold leading-tight tracking-[-0.015em] text-brand">
            Booked and paid
          </h1>
          <p className="max-w-[280px] text-[13.5px] leading-relaxed text-gray-600">
            {when} ({timezone}). A receipt is on its way to your email.
          </p>
        </div>
        <Card>
          <dl>
            <div className="flex justify-between gap-3 border-b border-gray-100 px-4 py-3 text-[13px]">
              <dt className="text-gray-500">Reference</dt>
              <dd className="font-mono font-semibold text-gray-900">{reference}</dd>
            </div>
            {invoiceNumber && (
              <div className="flex justify-between gap-3 border-b border-gray-100 px-4 py-3 text-[13px]">
                <dt className="text-gray-500">Invoice</dt>
                <dd className="font-mono font-semibold text-gray-900">{invoiceNumber}</dd>
              </div>
            )}
            {amount && (
              <div className="flex justify-between gap-3 px-4 py-3 text-[13px]">
                <dt className="text-gray-500">Paid</dt>
                <dd className="font-bold text-gray-900">{amount}</dd>
              </div>
            )}
          </dl>
        </Card>
        <Link href={`/app/appointments/${appointmentId}`} className={buttonClasses("primary", "lg", "w-full")}>
          See the appointment
        </Link>
        <div className="flex gap-2.5">
          <Link href="/app" className={buttonClasses("ghost", "lg", "flex-1")}>Back to home</Link>
          {invoiceId && <Link href={`/app/payments/${invoiceId}`} className={buttonClasses("ghost", "lg", "flex-1")}>Receipt</Link>}
        </div>
      </div>
    );
  }

  if (status === "cancelled") {
    return (
      <Card>
        <CardHeader title="Your hold expired" />
        <CardBody className="space-y-4">
          <Alert kind="warning">
            We didn&apos;t receive payment in time, so the slot was released. Nothing has been charged.
          </Alert>
          <Link href={bookHref} className={buttonClasses("primary", "lg", "w-full")}>Book again</Link>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Confirming your payment…" />
      <CardBody className="space-y-3.5">
        <p className="text-[13.5px] leading-relaxed text-gray-700">
          We&apos;re waiting for the payment provider to confirm. This page updates by itself — no need to refresh.
        </p>
        {expiresAt && remainingMs > 0 && (
          <p className="text-[13px] text-gray-600">
            Slot held for <span className="font-mono font-semibold text-gray-900">{mm}:{String(ss).padStart(2, "0")}</span>
          </p>
        )}
        {error && <Alert kind="error">{error}</Alert>}
        <Button onClick={retry} size="lg" className="w-full">Haven&apos;t paid yet? Pay now</Button>
        <Link href={`/app/appointments/${appointmentId}`} className={buttonClasses("ghost", "lg", "w-full")}>
          Appointment details
        </Link>
      </CardBody>
    </Card>
  );
}
