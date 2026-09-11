// Services — the catalogue a client picks from, and therefore the screen that decides whether a
// firm can sell anything at all on Docket.
//
// seed_firm_defaults() leaves every new firm with exactly one service: "Legal Consultation",
// inactive and priced at zero. Until an owner or admin prices and switches on something here,
// the booking wizard has nothing to offer and the whole front of the firm is a shop window with
// an empty shelf. That is what this page is for.
//
// Rules obeyed here:
//  · The database is the authorization layer. services_write_ins/upd/del is admin_w(firm_id) —
//    owner or admin, MFA session, firm not suspended. This page shows the forms only to a person
//    the database would let write, and degrades to a read-only catalogue for everybody else
//    rather than offering buttons that all refuse. Refusals themselves are shown word for word
//    by the actions in src/lib/actions/services.ts.
//  · Money is integer minor units. price_minor comes out of the database in kobo or cents and is
//    rendered with formatMoneyMinor(); VAT is worked out here the way book_appointment() works
//    it out — round(price_minor * vat_rate / 100) on the minor units, never on a decimal — so
//    the figure on this screen is the figure the client's invoice will carry. Nothing on this
//    page adds minor units of two currencies together.
//  · Nothing firm-specific: the firm, its currency, its VAT rate and its public web address all
//    arrive from context.
//  · A PENDING firm can still write everything (that is the setup path) but is absent from
//    firm_public, so the firm's own row is read from `firms` directly, never from the view.
//  · Nothing fake. Every count on this screen is a real count from the database, and where a
//    consequence depends on something that does not exist yet — a settlement account, a lawyer's
//    working week — the screen says so and links to where it is fixed.

import Link from "next/link";
import { requestedFirmId, staffContext } from "@/lib/firm-data";
import { formatMoneyMinor } from "@/lib/money";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ServicesEditor, type ServiceView } from "./services-editor";

export const metadata = { title: "Services" };

/** The statuses that mean a consultation is still standing in the diary. */
const LIVE_STATUSES = ["pending", "awaiting_payment", "confirmed", "rescheduled"];

const SERVICE_COLUMNS =
  "id, firm_id, slug, name, description, price_minor, currency, duration_min, lawyer_category, requires_prepayment, virtual_available, is_active, sort";

interface ServiceRecord {
  id: string;
  firm_id: string;
  slug: string;
  name: string;
  description: string | null;
  price_minor: number;
  currency: "NGN" | "USD";
  duration_min: number;
  lawyer_category: string | null;
  requires_prepayment: boolean;
  virtual_available: boolean;
  is_active: boolean;
  sort: number;
}

interface FirmRecord {
  slug: string;
  status: string;
  default_currency: "NGN" | "USD";
  vat_rate: number | null;
  paystack_subaccount: string | null;
}

export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ firm?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await staffContext(await requestedFirmId({ firm: sp.firm }));

  if (!ctx) {
    return (
      <Alert kind="warning" title="Not configured">
        Supabase environment variables are not set, or this account is not a member of a firm. See{" "}
        <code>.env.example</code>, or ask a firm owner to add you.
      </Alert>
    );
  }

  const { supabase, firmId, firmName, isAdmin } = ctx;

  const [{ data: firmRow }, { data: serviceRows }, { data: formRows }, { data: lawyerRows }, availability] =
    await Promise.all([
      // firm_public excludes a pending firm, and a firm that is still setting itself up is
      // exactly the firm that needs this screen. Read the row itself.
      supabase.from("firms").select("slug, status, default_currency, vat_rate, paystack_subaccount").eq("id", firmId).maybeSingle(),
      supabase.from("services").select(SERVICE_COLUMNS).eq("firm_id", firmId).order("sort", { ascending: true }).order("name", { ascending: true }).limit(200),
      supabase.from("intake_forms").select("id, service_id, name, is_active").eq("firm_id", firmId).limit(200),
      supabase.from("lawyer_profiles").select("user_id, category, is_public").eq("firm_id", firmId).limit(200),
      supabase.from("availability_rules").select("lawyer_id", { count: "exact", head: true }).eq("firm_id", firmId),
    ]);

  const firm = (firmRow ?? null) as FirmRecord | null;
  const services = (serviceRows ?? []) as unknown as ServiceRecord[];
  const forms = (formRows ?? []) as Array<{ id: string; service_id: string | null; name: string | null; is_active: boolean }>;
  const lawyers = (lawyerRows ?? []) as Array<{ user_id: string; category: string | null; is_public: boolean }>;

  // How many consultations each service is carrying. Two exact counts per service, asked of the
  // database with head:true so no rows travel — the numbers decide whether a service can be
  // deleted at all, so they must be counts and not estimates.
  const usage = await Promise.all(
    services.map(async (s) => {
      const [total, upcoming] = await Promise.all([
        supabase.from("appointments").select("id", { count: "exact", head: true }).eq("firm_id", firmId).eq("service_id", s.id),
        supabase
          .from("appointments")
          .select("id", { count: "exact", head: true })
          .eq("firm_id", firmId)
          .eq("service_id", s.id)
          .in("status", LIVE_STATUSES)
          .gte("starts_at", new Date().toISOString()),
      ]);
      return { id: s.id, total: total.count ?? 0, upcoming: upcoming.count ?? 0 };
    }),
  );
  const usageById = new Map(usage.map((u) => [u.id, u]));

  const vatRate = Number(firm?.vat_rate ?? 0);
  const defaultCurrency = firm?.default_currency ?? "NGN";
  const firmStatus = firm?.status ?? "pending";
  const hasSettlementAccount = Boolean(firm?.paystack_subaccount);
  const suspended = firmStatus === "suspended";
  const canWrite = isAdmin && !suspended;

  const views: ServiceView[] = services.map((s) => {
    // The same arithmetic book_appointment() does, on the same integers: VAT is rounded on the
    // minor units, so this is the figure the invoice will carry and not a re-derived decimal.
    const vatMinor = vatRate > 0 ? Math.round((s.price_minor * vatRate) / 100) : 0;
    const u = usageById.get(s.id);
    const form = forms.find((f) => f.service_id === s.id) ?? null;
    return {
      id: s.id,
      slug: s.slug,
      name: s.name,
      description: s.description ?? "",
      priceMinor: s.price_minor,
      // The fee put back into the box the way a lawyer would type it: whole units when the
      // minor units are round, and only then the decimals. Dividing to display is safe; the
      // multiplication back to minor units happens once, in the action, and nowhere else.
      priceText: s.price_minor % 100 === 0 ? String(s.price_minor / 100) : (s.price_minor / 100).toFixed(2),
      currency: s.currency,
      durationMin: s.duration_min,
      lawyerCategory: s.lawyer_category ?? "",
      requiresPrepayment: s.requires_prepayment,
      virtualAvailable: s.virtual_available,
      isActive: s.is_active,
      sort: s.sort,
      feeLabel: formatMoneyMinor(s.price_minor, s.currency),
      vatLabel: vatMinor > 0 ? formatMoneyMinor(vatMinor, s.currency) : null,
      totalLabel: formatMoneyMinor(s.price_minor + vatMinor, s.currency),
      minorLabel: `${s.price_minor.toLocaleString("en-NG")} ${s.currency === "NGN" ? "kobo" : "cents"}`,
      totalAppointments: u?.total ?? 0,
      upcomingAppointments: u?.upcoming ?? 0,
      formName: form ? form.name?.trim() || "Untitled form" : null,
      formActive: form ? form.is_active : false,
    };
  });

  // The categories this firm already uses on its own lawyers, offered as suggestions so the
  // word on a service matches the word on a profile.
  const categories = Array.from(
    new Set(lawyers.map((l) => (l.category ?? "").trim()).filter(Boolean)),
  ).sort();

  const activeServices = views.filter((s) => s.isActive);
  const publicLawyers = lawyers.filter((l) => l.is_public).length;
  const availabilityRules = availability.count ?? 0;
  const prepaidWithoutAccount = activeServices.some((s) => s.priceMinor > 0 && s.requiresPrepayment);

  // "Can a client book today?" — every line is a fact the booking engine itself checks, in the
  // order it checks them, each with the place it is fixed. No dead ends.
  const checks: Array<{ ok: boolean; label: string; detail: string; href?: string; hrefLabel?: string }> = [
    {
      ok: firmStatus === "active",
      label: "The firm is active on Docket",
      detail:
        firmStatus === "active"
          ? "book_appointment() only takes a booking for an active firm."
          : firmStatus === "suspended"
            ? "This firm is suspended. book_appointment() refuses every booking with “this firm is not taking bookings”, and the database refuses every write on this screen."
            : "This firm is still awaiting verification by Docket. book_appointment() refuses every booking with “this firm is not taking bookings” until it is active. Everything on this screen can still be set up now.",
    },
    {
      ok: activeServices.length > 0,
      label: `${activeServices.length} service${activeServices.length === 1 ? "" : "s"} switched on`,
      detail:
        activeServices.length > 0
          ? "A client picks one of these on the booking page."
          : "The booking page shows nothing to pick, so nobody can book. Price a service below and switch it on.",
    },
    {
      ok: availabilityRules > 0 && publicLawyers > 0,
      label: "A lawyer has hours and a public profile",
      detail:
        availabilityRules === 0
          ? "No lawyer has a working week yet, so the wizard offers no times whatever the catalogue says."
          : publicLawyers === 0
            ? "Hours are set, but no lawyer profile is public, so the booking page lists nobody to book with."
            : `${availabilityRules} block${availabilityRules === 1 ? "" : "s"} of hours across ${publicLawyers} public profile${publicLawyers === 1 ? "" : "s"}.`,
      href: "/firm/availability",
      hrefLabel: "Open availability",
    },
    {
      ok: hasSettlementAccount || !prepaidWithoutAccount,
      label: "Payment can be taken for a priced service",
      detail: hasSettlementAccount
        ? "The firm has a settlement account, so a paid consultation can be checked out."
        : prepaidWithoutAccount
          ? "This firm has no settlement account yet. book_appointment() refuses a priced service that asks for payment first with “this firm is not yet set up to receive payments”. Until Docket sets one up, price a service at zero or turn off “payment before the consultation is confirmed”."
          : "Nothing switched on asks for payment up front, so no settlement account is needed yet.",
    },
  ];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-heading text-2xl font-semibold text-brand">Services</h2>
          <p className="text-sm text-gray-600">
            {firmName} · what a client can book, how long it takes and what it costs
          </p>
        </div>
        {firm?.slug && (
          <Link
            href={`/${firm.slug}/book`}
            className="flex min-h-[44px] items-center rounded-lg border border-gray-300 px-4 text-sm font-medium text-brand hover:border-brand"
          >
            See the booking page
          </Link>
        )}
      </header>

      {suspended && (
        <Alert kind="error" title="This firm is suspended">
          The catalogue is readable, and every change to it is refused by the database until Docket lifts the
          suspension. Nothing below can be saved.
        </Alert>
      )}

      {services.length >= 200 && (
        <Alert kind="warning" title="Only the first 200 services are shown">
          This firm has at least 200 services and this screen reads 200 of them, ordered by their position on the
          booking page. Anything beyond that is not listed here.
        </Alert>
      )}

      {!isAdmin && !suspended && (
        <Alert kind="info" title="You can read this, not change it">
          Pricing and switching a service on is an owner's or an admin's act — services_write is admin_w(), and the
          database refuses everybody else. Ask an owner or admin of {firmName} to make the change.
        </Alert>
      )}

      <Card>
        <CardHeader title="Can a client book today?" />
        <CardBody className="p-0">
          <ul className="divide-y divide-gray-100">
            {checks.map((c) => (
              <li key={c.label} className="flex flex-wrap items-start gap-3 px-5 py-3">
                <span
                  aria-hidden="true"
                  className={
                    c.ok
                      ? "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-sm font-semibold text-emerald-800"
                      : "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-50 text-sm font-semibold text-amber-900"
                  }
                >
                  {c.ok ? "✓" : "!"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900">
                    {c.label}
                    <span className="sr-only">{c.ok ? " — done" : " — not yet"}</span>
                  </p>
                  <p className="text-sm text-gray-600">{c.detail}</p>
                </div>
                {c.href && (
                  <Link
                    href={c.href}
                    className="flex min-h-[44px] items-center text-sm font-medium text-brand underline"
                  >
                    {c.hrefLabel ?? "Open"}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <ServicesEditor
        firmId={firmId}
        firmSlug={firm?.slug ?? null}
        canWrite={canWrite}
        defaultCurrency={defaultCurrency}
        vatRate={vatRate}
        hasSettlementAccount={hasSettlementAccount}
        firmIsActive={firmStatus === "active"}
        services={views}
        categories={categories}
      />

      <Card>
        <CardHeader title="What the booking page does with these" />
        <CardBody className="space-y-2 text-sm text-gray-600">
          <p>
            A service switched <span className="font-medium text-gray-900">off</span> is not on the booking page at
            all, and book_appointment() refuses it with “service unavailable”. Consultations already in the diary are
            untouched.
          </p>
          <p>
            A service priced at <span className="font-medium text-gray-900">zero</span> is confirmed the moment it is
            booked: no invoice is raised and nothing is charged.
          </p>
          <p>
            A priced service with{" "}
            <span className="font-medium text-gray-900">payment before the consultation is confirmed</span> holds the
            slot for fifteen minutes while the client pays, and the consultation stays “awaiting payment” until the
            money arrives. Without that switch the consultation is confirmed straight away and the invoice is left to
            be paid.
          </p>
          <p>
            {vatRate > 0
              ? `VAT is added by the database at ${vatRate}% of the fee when the invoice is raised.`
              : "This firm's VAT rate is 0%, so no VAT is added to an invoice."}
          </p>
          <p>
            The public booking page reads this catalogue through a cache that lasts up to two minutes, so a change here
            can take that long to show up there.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
