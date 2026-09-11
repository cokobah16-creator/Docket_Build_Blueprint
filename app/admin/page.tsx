// The platform console: every firm on Docket, its lifecycle, and the domains firms have asked
// for. The gate is in the layout, so by the time this renders the caller is a platform admin
// with an MFA-verified session.
//
// WHAT A PLATFORM ADMIN CAN SEE HERE, and why it is so little. Everything on this page comes
// from firm_admin and domain_requests. A platform admin has no row read of firms, matters,
// clients, notifications or payments — migration 13 removed the last of it deliberately — so
// there is nothing on this screen about anybody's case, and there is no query here that could
// reach one.
//
// WHAT VERIFICATION READS. A firm is activated on the strength of two registers: the CAC entry
// behind its registered name and RC/BN number, and the Roll of Legal Practitioners behind each
// owner's enrolment number. Both are shown on every firm's card, because "active" is a claim
// this console makes on behalf of every client who books through it.

import Link from "next/link";
import type { ReactNode } from "react";
import { firmSiteHref } from "@/lib/tenant";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import {
  deploymentHost,
  domainRequests,
  platformContext,
  platformFirms,
} from "@/lib/admin-data";
import { vercelConfigured } from "@/lib/providers/domains/vercel";
import { formatWhen } from "@/lib/time";
import { NG_STATES } from "@/lib/nigeria";
import type { DomainRequestRow, FirmAdminRow } from "@/lib/db/types";
import { AdminCreateFirm } from "./create-firm";
import { FirmStatusControl } from "./firm-status-button";
import { DomainRequestControls, FirmDomainControl, FirmPlanControl } from "./firm-controls";

export const metadata = { title: "Firms and domains" };

/** Both reads are capped, and the caps are said out loud below rather than quietly truncating. */
const FIRM_LIMIT = 200;
const REQUEST_LIMIT = 100;

const STATUS_STYLE: Record<string, { classes: string; icon: string; label: string }> = {
  pending: { classes: "bg-amber-100 text-amber-900", icon: "◔", label: "Pending" },
  active: { classes: "bg-emerald-100 text-emerald-900", icon: "●", label: "Active" },
  suspended: { classes: "bg-red-100 text-red-900", icon: "✕", label: "Suspended" },
};

function FirmStatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? { classes: "bg-gray-100 text-gray-700", icon: "◦", label: status };
  return (
    <Badge className={s.classes}>
      <span aria-hidden="true" className="mr-1">
        {s.icon}
      </span>
      {s.label}
    </Badge>
  );
}

const REQUEST_STATUS_LABEL: Record<string, string> = {
  requested: "Asked for",
  verifying: "With Vercel, awaiting the firm's DNS",
  live: "Live",
  rejected: "Turned down",
  withdrawn: "Withdrawn by the firm",
};

/** What was saved from the provider the last time somebody asked it about this hostname. */
interface SavedVerification {
  provider?: string;
  checked_at?: string;
  verified?: boolean;
  misconfigured?: boolean | null;
  records?: Array<{ type: string; domain: string; value: string; reason?: string }>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-900">{children}</dd>
    </div>
  );
}

export default async function AdminFirmsPage() {
  const ctx = await platformContext();
  if (!ctx) {
    // The layout has already said which of the four things went wrong; this is only here so the
    // page can never render a half-authenticated screen if it is ever reached another way.
    return (
      <Alert kind="error" title="Not available">
        This screen is for Docket platform administrators.
      </Alert>
    );
  }

  const [firms, requests, host] = await Promise.all([
    platformFirms(ctx.supabase, FIRM_LIMIT),
    domainRequests(ctx.supabase, REQUEST_LIMIT),
    deploymentHost(),
  ]);
  const providerConfigured = vercelConfigured();

  const byId = new Map<string, FirmAdminRow>(firms.map((f) => [f.id, f]));
  const open = requests.filter((r) => r.status === "requested" || r.status === "verifying");
  const decided = requests.filter((r) => r.status !== "requested" && r.status !== "verifying");

  const pendingCount = firms.filter((f) => f.status === "pending").length;
  const suspendedCount = firms.filter((f) => f.status === "suspended").length;

  const firmName = (row: DomainRequestRow) => byId.get(row.firm_id)?.name ?? null;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold text-brand">Firms and domains</h1>
        <p className="text-sm text-gray-600">
          {firms.length} firm{firms.length === 1 ? "" : "s"} · {pendingCount} awaiting verification ·{" "}
          {suspendedCount} suspended · no access to matter content
        </p>
        {open.length > 0 && (
          <p className="text-sm">
            <Link href="#domains" className="font-medium text-brand underline">
              {open.length} domain request{open.length === 1 ? "" : "s"} waiting
            </Link>
          </p>
        )}
        {firms.length === FIRM_LIMIT && (
          <p className="text-xs text-gray-500">
            Showing the {FIRM_LIMIT} most recently created firms. Older ones are not on this page.
          </p>
        )}
      </header>

      {/* ============================================================ firms */}
      <section id="firms" className="space-y-4">
        <h2 className="font-heading text-lg font-semibold text-gray-900">Firms</h2>

        {firms.length === 0 ? (
          <Card>
            <EmptyState
              title="No firms on Docket yet"
              hint="Create the first one below, or send a founding partner to /firm/start to register their own."
            />
          </Card>
        ) : (
          <ul className="space-y-4">
            {firms.map((f) => {
              const owners = (f.owners ?? "")
                .split(";")
                .map((o) => o.trim())
                .filter(Boolean);
              return (
                <li key={f.id} id={`firm-${f.id}`}>
                  <Card>
                    <CardHeader
                      title={f.name}
                      action={
                        <span className="flex flex-wrap items-center justify-end gap-2">
                          <FirmStatusBadge status={f.status} />
                          <Badge>{f.plan}</Badge>
                        </span>
                      }
                    />
                    <CardBody className="space-y-4">
                      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <Field label="Docket address">
                          <Link href={firmSiteHref(f)} className="text-brand underline">
                            {f.slug}
                          </Link>
                        </Field>
                        <Field label="Custom domain">
                          {f.custom_domain ? (
                            <span className="break-all">{f.custom_domain}</span>
                          ) : (
                            <span className="text-gray-500">none — reached at its Docket address</span>
                          )}
                        </Field>
                        <Field label="Registered name">
                          {f.legal_name ?? <span className="text-amber-700">not given</span>}
                        </Field>
                        <Field label="RC / BN number">
                          {f.rc_number ?? <span className="text-amber-700">not given</span>}
                        </Field>
                        <Field label="Principal office">
                          {f.state_code ? (NG_STATES[f.state_code] ?? f.state_code) : <span className="text-gray-500">not given</span>}
                        </Field>
                        <Field label="People">
                          {f.member_count} member{f.member_count === 1 ? "" : "s"}
                        </Field>
                        <Field label="Client terms and privacy">
                          {f.policies_published ? (
                            "published"
                          ) : (
                            <span className="text-amber-700">
                              unpublished — the database refuses bookings until both are published
                            </span>
                          )}
                        </Field>
                        <Field label="Settlement account">
                          {f.has_settlement_account ? (
                            "Paystack subaccount set"
                          ) : (
                            <span className="text-amber-700">none — this firm cannot be paid</span>
                          )}
                        </Field>
                        <Field label="Created">{formatWhen(f.created_at, ctx.timezone)}</Field>
                        <Field label="Verified">
                          {f.verified_at ? (
                            formatWhen(f.verified_at, ctx.timezone)
                          ) : (
                            <span className="text-amber-700">never activated</span>
                          )}
                        </Field>
                      </dl>

                      <div>
                        <p className="text-xs uppercase tracking-wide text-gray-500">
                          Owners and enrolment numbers
                        </p>
                        {owners.length === 0 ? (
                          <p className="text-sm text-amber-700">
                            No owner on record. Do not activate this firm — add an owner first.
                          </p>
                        ) : (
                          <ul className="mt-1 space-y-0.5">
                            {owners.map((o) => (
                              <li
                                key={o}
                                className={`text-sm ${o.includes("no SCN") ? "text-amber-700" : "text-gray-900"}`}
                              >
                                {o}
                              </li>
                            ))}
                          </ul>
                        )}
                        <p className="mt-1 text-xs text-gray-500">
                          Check each number against the Roll, and the RC/BN number against the CAC
                          register, before setting a firm active.
                        </p>
                      </div>

                      <div className="grid grid-cols-1 gap-4 border-t border-gray-100 pt-4 sm:grid-cols-2 lg:grid-cols-3">
                        <FirmStatusControl firmId={f.id} status={f.status} />
                        <FirmPlanControl firmId={f.id} plan={f.plan} />
                        <FirmDomainControl
                          firmId={f.id}
                          currentDomain={f.custom_domain}
                          providerConfigured={providerConfigured}
                        />
                      </div>
                    </CardBody>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ============================================================ domains */}
      <section id="domains" className="space-y-4">
        <h2 className="font-heading text-lg font-semibold text-gray-900">Domain requests</h2>

        <Alert kind="info" title="How a custom domain goes live">
          Vercel is asked first and the firm is written second. That order matters: Postgres cannot
          make an outbound request, so a hostname written here that Vercel does not serve is a firm
          whose whole site stops loading. Point the firm&apos;s DNS at{" "}
          <strong className="break-all">{host || "this deployment"}</strong>. Once a domain is
          mapped, Docket caches host lookups for 60 seconds on each running instance, so give it a
          minute before deciding it has not worked.
        </Alert>

        {!providerConfigured && (
          <Alert kind="warning" title="Vercel is not configured on this deployment">
            VERCEL_TOKEN and VERCEL_PROJECT_ID are not set, so Docket cannot ask a provider to serve
            a hostname and cannot check whether one is served. You can still map a domain on a
            firm&apos;s card by ticking &ldquo;map it anyway&rdquo; — but then pointing the host at
            this deployment is entirely your own job.
          </Alert>
        )}

        {open.length === 0 ? (
          <Card>
            <EmptyState
              title="No firm is waiting on a domain"
              hint="A firm asks for one from its own settings. You can also map a domain directly on any firm's card above."
            />
          </Card>
        ) : (
          <ul className="space-y-4">
            {open.map((r) => {
              const saved = (r.verification ?? {}) as unknown as SavedVerification;
              const records = saved.records ?? [];
              const name = firmName(r);
              return (
                <li key={r.id}>
                  <Card>
                    <CardHeader
                      title={r.hostname}
                      action={<Badge>{REQUEST_STATUS_LABEL[r.status] ?? r.status}</Badge>}
                    />
                    <CardBody className="space-y-4">
                      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field label="Firm">
                          {name ? (
                            <Link href={`#firm-${r.firm_id}`} className="text-brand underline">
                              {name}
                            </Link>
                          ) : (
                            <span className="text-gray-500">
                              not among the {FIRM_LIMIT} firms listed above ({r.firm_id})
                            </span>
                          )}
                        </Field>
                        <Field label="Asked for">{formatWhen(r.created_at, ctx.timezone)}</Field>
                        {r.note && <Field label="Note">{r.note}</Field>}
                        {saved.checked_at && (
                          <Field label="Last checked with Vercel">
                            {formatWhen(saved.checked_at, ctx.timezone)}
                            {saved.verified === true
                              ? " — verified"
                              : saved.verified === false
                                ? " — not verified yet"
                                : ""}
                            {saved.misconfigured === true ? "; DNS not pointing here yet" : ""}
                          </Field>
                        )}
                      </dl>

                      {records.length > 0 && (
                        <div>
                          <p className="text-xs uppercase tracking-wide text-gray-500">
                            Records the firm must add at its registrar
                          </p>
                          <ul className="mt-1 space-y-1">
                            {records.map((rec, i) => (
                              <li key={`${rec.type}-${rec.domain}-${i}`} className="break-all text-sm text-gray-900">
                                <span className="font-medium">{rec.type}</span> {rec.domain} →{" "}
                                <code className="break-all">{rec.value}</code>
                                {rec.reason && <span className="text-gray-500"> ({rec.reason})</span>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="border-t border-gray-100 pt-4">
                        <DomainRequestControls requestId={r.id} hostname={r.hostname} status={r.status} />
                      </div>
                    </CardBody>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}

        {decided.length > 0 && (
          <Card>
            <CardHeader title="Already dealt with" />
            <CardBody>
              <ul className="space-y-2">
                {decided.map((r) => (
                  <li key={r.id} className="text-sm text-gray-700">
                    <span className="break-all font-medium text-gray-900">{r.hostname}</span> —{" "}
                    {REQUEST_STATUS_LABEL[r.status] ?? r.status}
                    {firmName(r) ? ` · ${firmName(r)}` : ""} ·{" "}
                    {formatWhen(r.decided_at ?? r.updated_at, ctx.timezone)}
                    {r.note && <span className="block text-gray-500">{r.note}</span>}
                  </li>
                ))}
              </ul>
              {requests.length === REQUEST_LIMIT && (
                <p className="mt-3 text-xs text-gray-500">
                  Showing the {REQUEST_LIMIT} most recent requests. Older ones are not on this page.
                </p>
              )}
            </CardBody>
          </Card>
        )}
      </section>

      {/* ============================================================ create */}
      <section className="space-y-4">
        <h2 className="font-heading text-lg font-semibold text-gray-900">Create a firm for an owner</h2>
        <Card>
          <CardBody>
            <AdminCreateFirm />
          </CardBody>
        </Card>
      </section>
    </div>
  );
}
