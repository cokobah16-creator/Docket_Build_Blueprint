// Client dashboard (slice 0: branded shell, consent capture, real empty
// states; appointments/matters/documents fill in through slices 1–3).

import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { currentFirm } from "@/lib/firm";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { StatusPill, type Status } from "@/components/ui/badge";
import { ConsentGate } from "./consent-gate";

export const metadata = { title: "Home" };

interface AppointmentRow {
  id: string;
  reference: string;
  starts_at: string;
  status: string;
  mode: string;
}

export default async function ClientDashboard() {
  const supabase = await supabaseServer();
  if (!supabase) {
    return (
      <Alert kind="warning" title="Not configured">
        Supabase environment variables are not set. See <code>.env.example</code>.
      </Alert>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/app/login");

  const firm = await currentFirm();

  // First-login consent (terms + privacy at the firm's current versions).
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
      const { data: consents } = await supabase
        .from("consent_records")
        .select("kind, version")
        .eq("firm_id", firm.id)
        .eq("user_id", user.id);
      const rows = (consents ?? []) as Array<{ kind: string; version: string }>;
      const hasTerms = rows.some((r) => r.kind === "terms" && r.version === termsVersion);
      const hasPrivacy = rows.some((r) => r.kind === "privacy" && r.version === privacyVersion);
      if (!hasTerms || !hasPrivacy) {
        return (
          <ConsentGate
            firmId={firm.id}
            firmName={firm.name}
            termsVersion={termsVersion}
            privacyVersion={privacyVersion}
            termsUrl={(firm.policies.terms?.url as string | null) ?? null}
            privacyUrl={(firm.policies.privacy?.url as string | null) ?? null}
          />
        );
      }
    }
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, timezone")
    .eq("id", user.id)
    .maybeSingle();
  const profileRow = (profile ?? null) as { full_name: string | null; timezone: string } | null;

  const { data: appt } = await supabase
    .from("appointments")
    .select("id, reference, starts_at, status, mode")
    .gte("starts_at", new Date().toISOString())
    .in("status", ["pending", "awaiting_payment", "confirmed", "rescheduled"])
    .order("starts_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const nextAppointment = (appt ?? null) as AppointmentRow | null;

  const displayName =
    profileRow?.full_name ?? user.email ?? user.phone ?? "there";
  const timezone = profileRow?.timezone ?? "Africa/Lagos";

  const quickActions = [
    { label: "Book", href: firm ? `/${firm.slug}/book` : "/app/appointments" },
    { label: "Message", href: "/app/messages" },
    { label: "Pay", href: "/app/appointments" },
  ];

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-heading text-2xl font-semibold text-brand">
          Welcome, {displayName}
        </h1>
        {firm && <p className="text-sm text-gray-600">{firm.name}</p>}
      </header>

      <nav aria-label="Quick actions" className="grid grid-cols-3 gap-2">
        {quickActions.map((a) => (
          <Link
            key={a.label}
            href={a.href}
            className="rounded-lg border border-gray-200 bg-white px-2 py-3 text-center text-xs font-medium text-brand hover:bg-black/5"
          >
            {a.label}
          </Link>
        ))}
      </nav>

      <Card>
        <CardHeader title="Next appointment" />
        {nextAppointment ? (
          <CardBody className="space-y-2">
            <p className="text-sm font-medium text-gray-900">
              {new Intl.DateTimeFormat("en-GB", {
                dateStyle: "full",
                timeStyle: "short",
                timeZone: timezone,
              }).format(new Date(nextAppointment.starts_at))}
            </p>
            <p className="text-sm text-gray-600">
              {nextAppointment.reference} · {nextAppointment.mode}
            </p>
            <StatusPill status={nextAppointment.status as Status} />
          </CardBody>
        ) : (
          <EmptyState
            title="No upcoming consultations"
            hint="Book one and it appears here once your firm confirms it."
            action={
              firm && (
                <Link
                  href={`/${firm.slug}/book`}
                  className="rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-brand-on hover:opacity-90"
                >
                  Book a Consultation
                </Link>
              )
            }
          />
        )}
      </Card>

      <Card>
        <CardHeader title="My matters" />
        <EmptyState
          title="No matters yet"
          hint="Matters your firm opens for you appear here with their timeline (slice 3)."
        />
      </Card>

      <Card>
        <CardHeader title="Recent documents" />
        <EmptyState
          title="No documents have been shared yet"
          hint="Documents shared on your matters appear here (slice 3)."
        />
      </Card>
    </div>
  );
}
