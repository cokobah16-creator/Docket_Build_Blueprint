// Raise an invoice. The screen gathers only what create_invoice() needs: the
// client, the matter it belongs to, the lines and the currency. Everything it
// offers — the people the firm acts for, its matters, its currency and its VAT
// rate — is read as the signed-in staff member from the firm in context.
//
// Rules enforced here: every read runs under RLS as that staff member and no
// service key is used; the number is minted inside create_invoice()
// (next_reference() is service-only), never in this code; money is integer minor
// units, so the composer collects naira or dollars and the server action does
// the rounding; and nothing is firm-specific — the firm, its VAT rate and its
// default currency all arrive from staffContext().

import Link from "next/link";
import { firmMatters, requestedFirmId, staffContext } from "@/lib/firm-data";
import { Alert } from "@/components/ui/alert";
import { InvoiceComposer, type ClientOption, type MatterOption } from "./invoice-composer";

export const metadata = { title: "Raise an invoice" };

/** How far back the two scans that build the client list reach. */
const APPOINTMENT_SCAN = 1000;
const PARTY_SCAN = 2000;
const MATTER_LIMIT = 200;

interface PersonRow {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  company_name: string | null;
}

/** PostgREST returns a to-one embed as an object; tolerate an array all the same. */
function one(value: PersonRow | PersonRow[] | null | undefined): PersonRow | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ firm?: string; matter?: string; client?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await staffContext(await requestedFirmId({ firm: sp.firm }));

  if (!ctx) {
    return (
      <Alert kind="warning" title="Not configured">
        Supabase environment variables are not set, or this account is not a member of a firm.
        See <code>.env.example</code>, or ask a firm owner to add you.
      </Alert>
    );
  }

  const { supabase, firmId } = ctx;
  const firmQuery = sp.firm ? `?firm=${sp.firm}` : "";

  const [{ data: firmRow }, { data: apptRows }, { data: partyRows }, matterRows] = await Promise.all([
    supabase.from("firms").select("default_currency, vat_rate").eq("id", firmId).maybeSingle(),
    supabase
      .from("appointments")
      .select("client_id, client:profiles!appointments_client_id_fkey(id, full_name, phone, email, company_name)")
      .eq("firm_id", firmId)
      .order("starts_at", { ascending: false })
      .limit(APPOINTMENT_SCAN),
    supabase
      .from("matter_parties")
      .select("user_id, client:profiles!matter_parties_user_id_fkey(id, full_name, phone, email, company_name)")
      .eq("firm_id", firmId)
      .limit(PARTY_SCAN),
    firmMatters(supabase, firmId, { limit: MATTER_LIMIT }),
  ]);

  const defaultCurrency = ((firmRow as { default_currency: string } | null)?.default_currency ?? "NGN") as "NGN" | "USD";
  const vatRate = Number((firmRow as { vat_rate: number | string } | null)?.vat_rate ?? 0);

  // Everyone the firm acts for: the same union the clients list is built from —
  // the people who have booked a consultation and the people on a matter.
  const byId = new Map<string, ClientOption>();
  const add = (person: PersonRow | null, id: string) => {
    if (!id) return;
    const existing = byId.get(id);
    const name = person?.full_name?.trim() || person?.company_name?.trim() || "Client";
    if (existing) {
      if (existing.name === "Client" && name !== "Client") existing.name = name;
      existing.phone = existing.phone ?? person?.phone ?? null;
      existing.email = existing.email ?? person?.email ?? null;
      return;
    }
    byId.set(id, { id, name, phone: person?.phone ?? null, email: person?.email ?? null });
  };

  for (const row of (apptRows ?? []) as unknown as Array<{ client_id: string; client: PersonRow | PersonRow[] | null }>) {
    add(one(row.client), row.client_id);
  }
  for (const row of (partyRows ?? []) as unknown as Array<{ user_id: string; client: PersonRow | PersonRow[] | null }>) {
    add(one(row.client), row.user_id);
  }

  const clients = Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));

  const matters: MatterOption[] = matterRows.map((m) => ({
    id: m.id,
    reference: m.reference,
    title: m.title,
    closed: Boolean(m.closed_at),
  }));

  // ?matter= arrives from the money tab of a matter; ?client= from anywhere the
  // person is already known. A matter also names its own client, so billing from
  // a file needs no further picking.
  const preselectedMatterId = matters.some((m) => m.id === sp.matter) ? sp.matter! : null;
  let preselectedClientId = sp.client && byId.has(sp.client) ? sp.client : null;
  if (!preselectedClientId && preselectedMatterId) {
    const { data: partyRow } = await supabase
      .from("matter_parties")
      .select("user_id")
      .eq("matter_id", preselectedMatterId)
      .eq("role", "client")
      .limit(1)
      .maybeSingle();
    const partyId = (partyRow as { user_id: string } | null)?.user_id ?? null;
    if (partyId && byId.has(partyId)) preselectedClientId = partyId;
  }

  const backHref = preselectedMatterId
    ? `/firm/matters/${preselectedMatterId}?tab=invoices`
    : `/firm/invoices${firmQuery}`;

  return (
    <div className="space-y-5">
      <p className="text-sm">
        <Link href={backHref} className="text-brand underline">
          ← {preselectedMatterId ? "Back to the matter" : "Invoices"}
        </Link>
      </p>
      <header>
        <h1 className="font-heading text-2xl font-semibold text-brand">Raise an invoice</h1>
        <p className="text-sm text-gray-600">
          {ctx.firmName} · the number is issued by the database as the invoice is raised · fees settle into the
          firm&rsquo;s own account
        </p>
      </header>

      <InvoiceComposer
        firmId={firmId}
        firmName={ctx.firmName}
        clients={clients}
        matters={matters}
        defaultCurrency={defaultCurrency}
        vatRate={vatRate}
        preselectedClientId={preselectedClientId}
        preselectedMatterId={preselectedMatterId}
        firmQuery={firmQuery}
      />
    </div>
  );
}
