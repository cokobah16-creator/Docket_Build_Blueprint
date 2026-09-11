// Everything a firm changes about itself, on one screen, grouped the way a firm thinks about it:
// identity, operations, settlement, service of process, brand, policies, domain, messages.
//
// Rules obeyed here:
//  · The firms row is read DIRECTLY. firm_public holds only ACTIVE firms, so a pending firm —
//    which is exactly the firm most likely to be on this screen — is absent from it, and reading
//    the view would show a firm setting itself up an empty page.
//  · firms_select is is_firm_member(id): every member of the firm may READ this row. Whether the
//    person may WRITE it is admin_w(), which the database asks on every write and which this
//    screen never second-guesses.
//  · A suspended firm degrades to read-only, because admin_w() is false for it and every form
//    would be refused one at a time.
//  · The reference prefix is fixed once the firm has issued a reference: next_reference() reads
//    firms.reference_prefix live, so changing it mid-year would leave one year's numbering
//    carrying two prefixes.
//  · Nothing firm-specific: every value on this page is read from the firm in context.

import Link from "next/link";
import { firmStaff, requestedFirmId, staffContext, staffLabel } from "@/lib/firm-data";
import { deploymentHost } from "@/lib/admin-data";
import { Alert } from "@/components/ui/alert";
import type { DomainRequestRow, FirmBrand } from "@/lib/db/types";
import { SettingsForms, type PolicyDoc } from "./settings-forms";

export const metadata = { title: "Firm settings" };

/** The documents validate_policies() knows. Anything else under firms.policies is dropped on a write. */
/** The documents validate_policies() keeps (migration 20). Anything else is dropped on save. */
const KEPT_POLICY_DOCUMENTS = ["terms", "privacy", "engagement", "cancellation", "disclaimer"];

interface FirmSettingsRow {
  id: string;
  slug: string;
  name: string;
  legal_name: string | null;
  rc_number: string | null;
  tin: string | null;
  state_code: string | null;
  reference_prefix: string;
  timezone: string;
  default_currency: string;
  vat_rate: number | string;
  paystack_subaccount: string | null;
  accepts_platform_service: boolean;
  address_for_service: Record<string, unknown> | null;
  brand: FirmBrand | null;
  policies: Record<string, unknown> | null;
  notification_templates: Record<string, { subject?: string; text?: string }> | null;
  status: string;
  custom_domain: string | null;
}

/** One policy document as the editor holds it: never null, so an input is never uncontrolled. */
function policyDoc(policies: Record<string, unknown> | null, key: string): PolicyDoc {
  const raw = policies?.[key];
  const doc = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));
  return { version: str(doc.version), title: str(doc.title), text: str(doc.text), url: str(doc.url) };
}

/**
 * Every zone this server can actually format in, so a firm outside Lagos is not forced to
 * mis-state its own working day. Older runtimes without supportedValuesOf still get a list that
 * contains the firm's own zone, which is the one that matters.
 */
function timeZones(current: string): string[] {
  try {
    const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    if (typeof supported === "function") return supported.call(Intl, "timeZone");
  } catch {
    /* fall through to the short list */
  }
  return Array.from(new Set([current, "Africa/Lagos", "Africa/Accra", "Africa/Johannesburg", "Europe/London", "UTC"]));
}

export default async function FirmSettingsPage({ searchParams }: { searchParams: Promise<{ firm?: string }> }) {
  const { firm: firmParam } = await searchParams;
  const ctx = await staffContext(await requestedFirmId({ firm: firmParam }));

  if (!ctx) {
    return (
      <Alert kind="warning" title="Not configured">
        Supabase environment variables are not set, or this account is not a member of a firm.
      </Alert>
    );
  }
  const { supabase, firmId } = ctx;

  if (!ctx.isAdmin) {
    return (
      <Alert kind="info" title={`You are ${ctx.role} at ${ctx.firmName}`}>
        A firm's settings belong to its owner and its administrators. Ask one of them, or{" "}
        <Link href="/firm/admin" className="font-medium underline">
          go back to the firm page
        </Link>
        .
      </Alert>
    );
  }

  const [{ data: firmData }, { data: requestRows }, colleagues, host] = await Promise.all([
    supabase
      .from("firms")
      .select(
        "id, slug, name, legal_name, rc_number, tin, state_code, reference_prefix, timezone, default_currency, vat_rate, paystack_subaccount, accepts_platform_service, address_for_service, brand, policies, notification_templates, status, custom_domain",
      )
      .eq("id", firmId)
      .maybeSingle(),
    supabase
      .from("domain_requests")
      .select("id, firm_id, hostname, status, verification, note, requested_by, decided_by, decided_at, created_at, updated_at")
      .eq("firm_id", firmId)
      .order("created_at", { ascending: false })
      .limit(20),
    firmStaff(supabase, firmId),
    deploymentHost(),
  ]);

  const firm = (firmData ?? null) as FirmSettingsRow | null;
  if (!firm) {
    return (
      <Alert kind="error" title="This firm's row could not be read">
        The database returned nothing for this firm. Sign out and in again; if it keeps happening,
        tell Docket.
      </Alert>
    );
  }

  // The firm has issued a reference when firm_counters says so. The schema migration revoked
  // every grant on firm_counters from authenticated — only next_reference() touches it — so the
  // read is attempted and then falls back to the references themselves, which a member may read.
  let referenceIssued = false;
  const counters = await supabase
    .from("firm_counters")
    .select("kind", { count: "exact", head: true })
    .eq("firm_id", firmId);
  if (!counters.error) {
    referenceIssued = (counters.count ?? 0) > 0;
  } else {
    const [matters, invoices, appointments] = await Promise.all([
      supabase.from("matters").select("id", { count: "exact", head: true }).eq("firm_id", firmId),
      supabase.from("invoices").select("id", { count: "exact", head: true }).eq("firm_id", firmId),
      supabase.from("appointments").select("id", { count: "exact", head: true }).eq("firm_id", firmId),
    ]);
    referenceIssued = (matters.count ?? 0) > 0 || (invoices.count ?? 0) > 0 || (appointments.count ?? 0) > 0;
  }

  const requests = (requestRows ?? []) as DomainRequestRow[];
  const openRequest = requests.find((r) => r.status === "requested" || r.status === "verifying") ?? null;
  const decidedRequests = requests.filter((r) => r !== openRequest).slice(0, 5);

  const address = (firm.address_for_service ?? {}) as Record<string, unknown>;
  const asText = (v: unknown) => (typeof v === "string" ? v : "");

  const policies = firm.policies ?? {};
  const policyDocumentsAtRisk = Object.entries(policies)
    .filter(([key, value]) => value && typeof value === "object" && !KEPT_POLICY_DOCUMENTS.includes(key))
    .map(([key]) => key);

  return (
    <SettingsForms
      firmId={firm.id}
      firmName={firm.name}
      firmSlug={firm.slug}
      status={firm.status}
      timezone={ctx.timezone}
      identity={{
        name: firm.name,
        legalName: firm.legal_name ?? "",
        rcNumber: firm.rc_number ?? "",
        tin: firm.tin ?? "",
        stateCode: firm.state_code ?? "",
      }}
      operations={{
        timezone: firm.timezone,
        defaultCurrency: firm.default_currency,
        vatRate: String(Number(firm.vat_rate ?? 0)),
        referencePrefix: firm.reference_prefix,
        referenceIssued,
      }}
      settlement={{ paystackSubaccount: firm.paystack_subaccount ?? "" }}
      serviceOfProcess={{
        accepts: firm.accepts_platform_service,
        chambers: asText(address.chambers),
        email: asText(address.email),
        phone: asText(address.phone),
        contactUserId: asText(address.contact_user_id),
      }}
      brand={firm.brand ?? {}}
      policies={{ terms: policyDoc(policies, "terms"), privacy: policyDoc(policies, "privacy") }}
      policyDocumentsAtRisk={policyDocumentsAtRisk}
      templates={firm.notification_templates ?? {}}
      colleagues={colleagues.map((c) => ({ id: c.user_id, label: `${staffLabel(c)} — ${c.role}` }))}
      timezones={timeZones(firm.timezone)}
      customDomain={firm.custom_domain}
      openRequest={openRequest}
      decidedRequests={decidedRequests}
      deploymentHost={host}
    />
  );
}
