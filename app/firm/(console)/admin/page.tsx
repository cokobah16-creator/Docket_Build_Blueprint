// The firm, at a glance: what it is today, what that means for its clients, and where to go to
// change each part of it.
//
// Rules obeyed here:
//  · Every read runs as the signed-in person; RLS decides what comes back. firms_select is
//    is_firm_member(id), so the firm's own row is read DIRECTLY — never firm_public, which
//    contains only active firms and would leave a pending firm looking like it did not exist.
//  · Whether the policies are published is not worked out here. firm_policies_published() is the
//    function book_appointment() itself calls, so the screen asks that, and reports its answer.
//  · Every line says what it MEANS, not just what it is: a pending firm has no public site yet,
//    a firm with no settlement account cannot take a prepaid booking.
//  · Nothing firm-specific — the firm arrives from staffContext().
//  · Every count that is capped says so; none of these are.

import Link from "next/link";
import { requestedFirmId, staffContext } from "@/lib/firm-data";
import { formatWhen } from "@/lib/time";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { DomainRequestRow, FirmReadiness } from "@/lib/db/types";
import { Checklist } from "./checklist";

export const metadata = { title: "Firm administration" };

interface FirmRow {
  id: string;
  slug: string;
  name: string;
  legal_name: string | null;
  status: string;
  plan: string;
  custom_domain: string | null;
  verified_at: string | null;
  paystack_subaccount: string | null;
  created_at: string;
}

const PLAN_MEANING: Record<string, string> = {
  free: "No charge from Docket. Docket sets a firm's plan; you cannot change it here.",
  standard: "Docket bills this firm on the standard plan. Docket sets a firm's plan.",
  enterprise: "Docket bills this firm on the enterprise plan. Docket sets a firm's plan.",
};

function Line({
  label,
  value,
  meaning,
  href,
  action,
  tone = "plain",
}: {
  label: string;
  value: string;
  meaning: string;
  href?: string;
  action?: string;
  tone?: "plain" | "good" | "warn" | "bad";
}) {
  const badge =
    tone === "good"
      ? "bg-emerald-100 text-emerald-900"
      : tone === "warn"
        ? "bg-amber-100 text-amber-900"
        : tone === "bad"
          ? "bg-red-100 text-red-900"
          : "";
  return (
    <div className="flex flex-col gap-1.5 border-b border-gray-100 py-4 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-gray-500">{label}</span>
        <Badge className={badge}>{value}</Badge>
      </div>
      <p className="text-sm text-gray-700">{meaning}</p>
      {href && (
        <Link href={href} className="min-h-[44px] py-2.5 text-sm font-medium text-brand underline">
          {action ?? "Change this"}
        </Link>
      )}
    </div>
  );
}

export default async function FirmAdminPage({ searchParams }: { searchParams: Promise<{ firm?: string }> }) {
  const { firm: firmParam } = await searchParams;
  const ctx = await staffContext(await requestedFirmId({ firm: firmParam }));

  if (!ctx) {
    return (
      <Alert kind="warning" title="Not configured">
        Supabase environment variables are not set, or this account is not a member of a firm.
      </Alert>
    );
  }
  const { supabase, firmId, timezone: tz } = ctx;

  if (!ctx.isAdmin) {
    const elsewhere = ctx.memberships.filter((m) => m.role === "owner" || m.role === "admin");
    const { data: firmRows } = elsewhere.length
      ? await supabase.from("firms").select("id, name").in("id", elsewhere.map((m) => m.firm_id))
      : { data: [] as Array<{ id: string; name: string }> };
    const others = (firmRows ?? []) as Array<{ id: string; name: string }>;
    return (
      <Alert kind="info" title={`You are ${ctx.role} at ${ctx.firmName}`}>
        <p>
          Only an owner or an administrator changes a firm's settings, catalogue, people and audit
          trail. Ask one of them, or{" "}
          <Link href="/firm" className="font-medium underline">
            go back to Today
          </Link>
          .
        </p>
        {others.length > 0 && (
          <p className="mt-2">
            You do administer{" "}
            {others.map((f, i) => (
              <span key={f.id}>
                {i > 0 ? ", " : ""}
                <Link href={`/firm/admin?firm=${f.id}`} className="font-medium underline">
                  {f.name}
                </Link>
              </span>
            ))}
            .
          </p>
        )}
      </Alert>
    );
  }

  // Where the firm stands is ONE answer: firm_readiness() (migration 34) asks book_appointment()'s
  // gates in its order and adds the setup facts. The services page reads the same function, so
  // the two screens can no longer disagree.
  const [
    { data: firmData },
    { data: readinessData, error: readinessError },
    { data: requestRows },
  ] = await Promise.all([
    supabase
      .from("firms")
      .select("id, slug, name, legal_name, status, plan, custom_domain, verified_at, paystack_subaccount, created_at")
      .eq("id", firmId)
      .maybeSingle(),
    supabase.rpc("firm_readiness", { p_firm: firmId }),
    supabase
      .from("domain_requests")
      .select("id, firm_id, hostname, status, verification, note, requested_by, decided_by, decided_at, created_at, updated_at")
      .eq("firm_id", firmId)
      .in("status", ["requested", "verifying"])
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const firm = (firmData ?? null) as FirmRow | null;
  if (!firm) {
    return (
      <Alert kind="error" title="This firm's row could not be read">
        The database returned nothing for this firm, which means the membership this console is
        using no longer matches a firm. Sign out and in again, and if it keeps happening, tell
        Docket.
      </Alert>
    );
  }

  const readiness = (readinessData ?? null) as FirmReadiness | null;
  if (!readiness) {
    return (
      <Alert kind="error" title="Where the firm stands could not be read">
        {readinessError?.message ?? "firm_readiness() returned nothing."} Nothing here is guessed in its place.
      </Alert>
    );
  }
  const policiesPublished = readiness.policies_published;
  const memberCount = readiness.members;
  const activeServices = readiness.active_services;
  const allServices = readiness.all_services;
  const intakeCount = readiness.intake_forms;
  const openRequest = ((requestRows ?? []) as DomainRequestRow[])[0] ?? null;

  const canSell = readiness.gates.bookable;

  return (
    <div className="space-y-6">
      {firm.status === "suspended" && (
        <Alert kind="error" title="This firm is suspended">
          Everything here can still be read. While a firm is suspended the database refuses every
          change on these screens, until Docket lifts it.
        </Alert>
      )}

      {firm.status === "pending" && (
        <Alert kind="warning" title="Your public site is not open yet">
          While a firm is pending, its public pages are closed: /{firm.slug} does not answer, and a
          booking is refused with “this firm is not taking bookings”. The console works in full.
          Docket opens the site when it has verified the firm — finish the settings below and the
          only wait left is Docket's.
        </Alert>
      )}

      {firm.status === "active" && !canSell && (
        <Alert kind="warning" title="Your site is open, but nothing can be booked on it yet">
          {!policiesPublished && "Your terms and privacy notice are not published. "}
          {activeServices === 0 && "You have no service switched on. "}
          {readiness.availability_rules === 0 && "No lawyer has a working week. "}
          {readiness.public_lawyers === 0 && "No practitioner profile is public. "}
          Until each is done a visitor can read about the firm and no more.
        </Alert>
      )}

      <Card>
        <CardHeader title="Your checklist" />
        <CardBody>
          <Checklist firmId={firmId} readiness={readiness} canWrite={firm.status !== "suspended"} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={firm.name} action={<Badge>{firm.slug}</Badge>} />
        <CardBody>
          <div>
            <Line
              label="Status"
              value={firm.status}
              tone={firm.status === "active" ? "good" : firm.status === "pending" ? "warn" : "bad"}
              meaning={
                firm.status === "active"
                  ? `Your public site is open at /${firm.slug}${firm.verified_at ? `, verified by Docket on ${formatWhen(firm.verified_at, tz, { dateStyle: "medium" })}` : ""}.`
                  : firm.status === "pending"
                    ? "Created, not yet verified. The console works; the public site and booking do not."
                    : "Suspended by Docket. Reads work, writes do not, and nothing is deleted."
              }
            />
            <Line
              label="Plan"
              value={firm.plan}
              meaning={PLAN_MEANING[firm.plan] ?? "Docket sets a firm's plan."}
            />
            <Line
              label="Terms and privacy"
              value={policiesPublished ? "published" : "not published"}
              tone={policiesPublished ? "good" : "bad"}
              meaning={
                policiesPublished
                  ? "Booking is allowed. Changing a version asks every client of this firm to accept again before they can use their portal."
                  : "Every booking is refused with “this firm has not published its terms and privacy notice yet”."
              }
              href="/firm/admin/settings"
              action={policiesPublished ? "Read or change the policies" : "Publish the policies"}
            />
            <Line
              label="Taking payments"
              value={firm.paystack_subaccount ? "settlement account set" : "no settlement account"}
              tone={firm.paystack_subaccount ? "good" : "warn"}
              meaning={
                firm.paystack_subaccount
                  ? "A prepaid booking settles to your Paystack subaccount. Docket refuses to apply a payment that reports settling anywhere else."
                  : "A booking for a service that requires prepayment is refused with “this firm is not yet set up to receive payments”. Free consultations still book."
              }
              href="/firm/admin/settings"
              action="Set the settlement account"
            />
            <Line
              label="People"
              value={`${memberCount} ${memberCount === 1 ? "person" : "people"}`}
              meaning={
                memberCount === 1
                  ? "You are the only member. A firm with one owner cannot have that owner removed or stood down — appoint another first."
                  : "Everyone who can sign in to this console. Removing a lawyer clears their diary and takes their profile off the public site."
              }
              href="/firm/admin/people"
              action="Manage people and invitations"
            />
            <Line
              label="Services"
              value={`${activeServices} of ${allServices} switched on`}
              tone={activeServices > 0 ? "good" : "warn"}
              meaning={
                activeServices > 0
                  ? "These are what a visitor can book. A service that is switched off is invisible to the booking wizard and refused outright if asked for."
                  : "Nothing is bookable. Every new firm starts with one unpriced consultation that is switched off; price it and switch it on."
              }
              href="/firm/admin/services"
              action="Manage the catalogue"
            />
            <Line
              label="Intake questions"
              value={`${intakeCount} ${intakeCount === 1 ? "form" : "forms"}`}
              meaning={
                intakeCount > 0
                  ? "What a client is asked before a consultation. The answers land on the appointment for the lawyer to read."
                  : "No form, so a client books with nothing but their name and the time. Add one and the lawyer walks in prepared."
              }
              href="/firm/admin/intake"
              action="Edit the intake questions"
            />
            <Line
              label="Address on the web"
              value={firm.custom_domain ?? `/${firm.slug}`}
              meaning={
                firm.custom_domain
                  ? `${firm.custom_domain} is mapped to this firm, and /${firm.slug} keeps working.`
                  : openRequest
                    ? `You have asked Docket for ${openRequest.hostname}; it is ${openRequest.status}.`
                    : `Your site answers at /${firm.slug}. Only Docket can map a domain of your own, so you ask and Docket maps it.`
              }
              href="/firm/admin/settings"
              action={firm.custom_domain || openRequest ? "See the domain" : "Ask for your own domain"}
            />
            <Line
              label="On Docket since"
              value={formatWhen(firm.created_at, tz, { dateStyle: "medium" })}
              meaning="Everything anyone here has done to this firm is in the audit trail, which nobody can edit or delete."
              href="/firm/admin/audit"
              action="Read the audit trail"
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="The rest of the firm" />
        <CardBody className="space-y-2 text-sm text-gray-700">
          <p>
            Identity, operations, settlement, service of process, brand, policies, your domain and
            the wording of your messages all live on one screen.
          </p>
          <Link href="/firm/admin/settings" className="inline-block min-h-[44px] py-2.5 font-medium text-brand underline">
            Open settings
          </Link>
        </CardBody>
      </Card>
    </div>
  );
}
