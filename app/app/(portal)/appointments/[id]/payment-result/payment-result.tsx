"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { startPayment } from "@/lib/actions/booking";

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

  async function retry() {
    setError(null);
    const r = await startPayment(appointmentId);
    if (r?.error) setError(r.error);
  }

  if (status === "confirmed" || status === "rescheduled" || status === "completed") {
    return (
      <Card>
        <CardHeader title="You're booked" />
        <CardBody className="space-y-4">
          <Alert kind="success" title="Payment received">
            Consultation {reference} is confirmed for {when} ({timezone}).
          </Alert>
          <div className="flex flex-wrap gap-3">
            <Link href={`/app/appointments/${appointmentId}`} className="rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-brand-on hover:opacity-90">View appointment</Link>
            {invoiceId && <Link href={`/app/payments/${invoiceId}`} className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-brand hover:bg-black/5">Receipt</Link>}
          </div>
        </CardBody>
      </Card>
    );
  }

  if (status === "cancelled") {
    return (
      <Card>
        <CardHeader title="Your hold expired" />
        <CardBody className="space-y-4">
          <Alert kind="warning">
            We didn't receive payment in time, so the slot was released. Nothing has been charged.
          </Alert>
          <Link href={bookHref} className="inline-block rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-brand-on hover:opacity-90">Book again</Link>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Confirming your payment…" />
      <CardBody className="space-y-4">
        <p className="text-sm text-gray-700">
          We're waiting for the payment provider to confirm. This page updates by itself — no need to refresh.
        </p>
        {expiresAt && remainingMs > 0 && (
          <p className="text-sm text-gray-600">
            Slot held for <span className="font-mono font-semibold text-gray-900">{mm}:{String(ss).padStart(2, "0")}</span>
          </p>
        )}
        {error && <Alert kind="error">{error}</Alert>}
        <div className="flex flex-wrap gap-3">
          <Button onClick={retry}>Haven't paid yet? Pay now</Button>
          <Link href={`/app/appointments/${appointmentId}`} className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-brand hover:bg-black/5">Appointment details</Link>
        </div>
      </CardBody>
    </Card>
  );
}
