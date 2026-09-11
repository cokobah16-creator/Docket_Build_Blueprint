"use client";

// The firm's settings, in the order a firm actually fills them in: who you are, how you work,
// where the money lands, how you are served, what you look like, what your clients agree to,
// what your address is, and what your messages say.
//
// Rules obeyed here:
//  · The database is the authorization layer. Nothing on this screen decides who may write.
//    Every button calls a server action, the action calls the database, and whatever the
//    database says comes back to the box below the button word for word.
//  · Three of these columns are rewritten by a trigger as they are stored. The rules those
//    triggers apply are mirrored in the fields below so the person typing is told BEFORE they
//    save — but the action re-reads the row afterwards and reports what the database actually
//    kept, because a mirror can drift and the trigger cannot.
//  · A suspended firm is read-only. admin_w() is false for it, so every form on this screen
//    would be refused; the values are shown instead, and the reason with them.
//  · Nothing firm-specific: every value on this screen arrives as a prop.
//  · Mobile first — one column, 44px targets, nothing wider than the screen.

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { NG_STATES, NG_STATE_OPTIONS } from "@/lib/nigeria";
import { PREFERENCE_EVENTS, describeNotification } from "@/lib/notifications-copy";
import { brandStyle } from "@/lib/brand";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import type { DomainRequestRow, FirmBrand } from "@/lib/db/types";
import {
  requestDomain,
  updateBrand,
  updateFirmIdentity,
  updateFirmOperations,
  updateFirmSettlement,
  updateNotificationTemplates,
  updatePolicies,
  updateServiceOfProcess,
  withdrawDomainRequest,
  type SettingsResult, updateMatterWalls, updateConflictChecksRequired } from "@/lib/actions/firm-settings";

const FIELD =
  "w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-base text-gray-900 " +
  "placeholder:text-gray-400 focus:border-brand focus:outline focus:outline-2 focus:outline-brand";
const AREA = cn(FIELD, "min-h-[7rem] font-body leading-relaxed");

/** The bucket's own limits (migration 4): 5 MB, and these four types. */
const LOGO_MAX_BYTES = 5 * 1024 * 1024;
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

export interface PolicyDoc {
  version: string;
  title: string;
  text: string;
  url: string;
}

export interface Colleague {
  id: string;
  label: string;
}

export interface FirmSettingsProps {
  firmId: string;
  firmName: string;
  firmSlug: string;
  status: string;
  timezone: string;
  identity: { name: string; legalName: string; rcNumber: string; tin: string; stateCode: string };
  operations: { timezone: string; defaultCurrency: string; vatRate: string; referencePrefix: string; referenceIssued: boolean };
  settlement: { paystackSubaccount: string };
  serviceOfProcess: { accepts: boolean; chambers: string; email: string; phone: string; contactUserId: string };
  /** firms.matter_walls: may a matter be restricted to its team? */
  matterWalls: boolean;
  /** firms.conflict_checks_required: must a check be cleared before a client joins a matter? */
  conflictChecksRequired: boolean;
  brand: FirmBrand;
  policies: { terms: PolicyDoc; privacy: PolicyDoc };
  /** Documents stored under firms.policies that validate_policies() will drop on the next write. */
  policyDocumentsAtRisk: string[];
  templates: Record<string, { subject?: string; text?: string }>;
  colleagues: Colleague[];
  timezones: string[];
  customDomain: string | null;
  openRequest: DomainRequestRow | null;
  decidedRequests: DomainRequestRow[];
  /** Where this deployment answers, so the DNS advice is not a guess. */
  deploymentHost: string;
}

// ---------------------------------------------------------------- shared pieces

function useSave() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<SettingsResult | null>(null);
  const run = (fn: () => Promise<SettingsResult>) => {
    setResult(null);
    start(async () => {
      const r = await fn();
      setResult(r);
      if (!r.error) router.refresh();
    });
  };
  return { pending, result, run };
}

function Outcome({ result }: { result: SettingsResult | null }) {
  if (!result) return null;
  if (result.error) {
    return (
      <Alert kind="error" title="The database refused this" className="mt-4">
        {result.error}
      </Alert>
    );
  }
  return (
    <Alert kind="success" title="Saved" className="mt-4">
      {result.notes && result.notes.length > 0 ? (
        <ul className="mt-1 list-disc space-y-1 pl-4">
          {result.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : (
        <span>The database accepted it as typed.</span>
      )}
    </Alert>
  );
}

function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody className="space-y-4">
        {hint && <div className="text-sm text-gray-600">{hint}</div>}
        {children}
      </CardBody>
    </Card>
  );
}

/**
 * A label for a control the shared Input/Select does not cover — a textarea, a colour pair, the
 * logo block. `htmlFor` names the single control it belongs to; without one the caption is a
 * heading over a group, and each control inside carries its own aria-label.
 */
function Labelled({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-800">
          {label}
        </label>
      ) : (
        <span className="block text-sm font-medium text-gray-800">{label}</span>
      )}
      {children}
      {hint && <p className="text-sm text-gray-500">{hint}</p>}
    </div>
  );
}

function SaveButton({ pending, children = "Save" }: { pending: boolean; children?: ReactNode }) {
  return (
    <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
      {pending ? "Saving…" : children}
    </Button>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-gray-100 py-2.5 last:border-0 sm:flex-row sm:gap-4">
      <dt className="text-sm text-gray-500 sm:w-56 sm:shrink-0">{label}</dt>
      <dd className="break-words text-sm font-medium text-gray-900">{value || <span className="font-normal text-gray-400">Not set</span>}</dd>
    </div>
  );
}

// ================================================================ the screen

export function SettingsForms(props: FirmSettingsProps) {
  if (props.status === "suspended") return <SuspendedSettings {...props} />;
  return (
    <div className="space-y-6">
      {props.status === "pending" && (
        <Alert kind="info" title="This firm is not live yet">
          Everything on this page can be filled in now. Your public site at /{props.firmSlug} and
          your booking page open when Docket has verified the firm and set it active.
        </Alert>
      )}
      <IdentitySection {...props} />
      <OperationsSection {...props} />
      <SettlementSection {...props} />
      <ServiceSection {...props} />
      <WallsSection {...props} />
      <ConflictsSection {...props} />
      <BrandSection {...props} />
      <PoliciesSection {...props} />
      <DomainSection {...props} />
      <TemplatesSection {...props} />
    </div>
  );
}

/**
 * A suspended firm: admin_w() is false, so every form here would be refused one at a time.
 * Show what is stored, and say who can lift it.
 */
function SuspendedSettings(props: FirmSettingsProps) {
  const brand = props.brand ?? {};
  return (
    <div className="space-y-6">
      <Alert kind="error" title="This firm is suspended, so its settings are read-only">
        While a firm is suspended the database refuses every change on this screen, one at a time.
        Everything below is what is stored today, and it is all still readable. Only Docket can lift
        a suspension.
      </Alert>
      <Card>
        <CardHeader title="What is stored" />
        <CardBody>
          <dl>
            <Row label="Name" value={props.identity.name} />
            <Row label="Registered name" value={props.identity.legalName} />
            <Row label="RC or BN number" value={props.identity.rcNumber} />
            <Row label="TIN" value={props.identity.tin} />
            <Row label="State" value={props.identity.stateCode ? NG_STATES[props.identity.stateCode] ?? props.identity.stateCode : ""} />
            <Row label="Time zone" value={props.operations.timezone} />
            <Row label="Currency" value={props.operations.defaultCurrency} />
            <Row label="VAT rate" value={`${props.operations.vatRate}%`} />
            <Row label="Reference prefix" value={props.operations.referencePrefix} />
            <Row label="Paystack subaccount" value={props.settlement.paystackSubaccount} />
            <Row label="Accepts service through Docket" value={props.serviceOfProcess.accepts ? "Yes" : "No"} />
            <Row label="Address for service" value={props.serviceOfProcess.chambers} />
            <Row label="Tagline" value={brand.tagline ?? ""} />
            <Row label="Primary colour" value={brand.colours?.primary ?? ""} />
            <Row label="Terms version" value={props.policies.terms.version} />
            <Row label="Privacy version" value={props.policies.privacy.version} />
            <Row label="Custom domain" value={props.customDomain ?? ""} />
          </dl>
        </CardBody>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- identity

function IdentitySection({ firmId, identity }: FirmSettingsProps) {
  const { pending, result, run } = useSave();
  const [name, setName] = useState(identity.name);
  const [legalName, setLegalName] = useState(identity.legalName);
  const [rcNumber, setRcNumber] = useState(identity.rcNumber);
  const [tin, setTin] = useState(identity.tin);
  const [stateCode, setStateCode] = useState(identity.stateCode);

  return (
    <Section
      title="Identity"
      hint="The name here is the name your clients see on your site, in every message Docket sends them, and at the head of this console."
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => updateFirmIdentity(firmId, { name, legalName, rcNumber, tin, stateCode }));
        }}
      >
        <Input label="Firm name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required hint="What clients call you." />
        <Input
          label="Registered name"
          value={legalName}
          onChange={(e) => setLegalName(e.target.value)}
          maxLength={200}
          hint="The name on the CAC certificate, if it differs from the trading name."
        />
        <Input label="RC or BN number" value={rcNumber} onChange={(e) => setRcNumber(e.target.value)} maxLength={40} />
        <Input
          label="TIN"
          value={tin}
          onChange={(e) => setTin(e.target.value)}
          maxLength={40}
          hint="Your FIRS Tax Identification Number. Docket prints it on any invoice that carries VAT."
        />
        <Select label="State of the principal office" value={stateCode} onChange={(e) => setStateCode(e.target.value)}>
          <option value="">Not stated</option>
          {NG_STATE_OPTIONS.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </Select>
        <SaveButton pending={pending} />
      </form>
      <Outcome result={result} />
    </Section>
  );
}

// ---------------------------------------------------------------- operations

function OperationsSection({ firmId, operations, timezones }: FirmSettingsProps) {
  const { pending, result, run } = useSave();
  const [timezone, setTimezone] = useState(operations.timezone);
  const [defaultCurrency, setDefaultCurrency] = useState(operations.defaultCurrency);
  const [vatRate, setVatRate] = useState(operations.vatRate);
  const [referencePrefix, setReferencePrefix] = useState(operations.referencePrefix);

  const zones = useMemo(() => {
    const set = new Set(timezones);
    if (operations.timezone) set.add(operations.timezone);
    return Array.from(set).sort();
  }, [timezones, operations.timezone]);

  const year = new Date().getUTCFullYear();

  return (
    <Section title="Operations" hint="How this firm's day, money and numbering work.">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(() =>
            updateFirmOperations(firmId, {
              timezone,
              defaultCurrency,
              vatRate,
              referencePrefix: operations.referenceIssued ? operations.referencePrefix : referencePrefix,
            }),
          );
        }}
      >
        <Select label="Time zone" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </Select>
        <p className="-mt-2 text-sm text-gray-500">
          A lawyer whose own profile names a zone keeps it — the booking engine reads the lawyer's
          zone first and falls back to this one.
        </p>

        <Select label="Currency new work is billed in" value={defaultCurrency} onChange={(e) => setDefaultCurrency(e.target.value)}>
          <option value="NGN">Naira (NGN)</option>
          <option value="USD">US dollars (USD)</option>
        </Select>
        <p className="-mt-2 text-sm text-gray-500">
          This is the currency a new service and a new invoice start in. Money already recorded keeps
          the currency it was recorded in, and Docket never adds two currencies together.
        </p>

        <Input
          label="VAT rate"
          value={vatRate}
          onChange={(e) => setVatRate(e.target.value)}
          inputMode="decimal"
          hint="A percentage. 7.5 charges VAT at seven and a half per cent; 0 charges none. It applies to the next invoice you raise, not to invoices already raised."
        />

        {operations.referenceIssued ? (
          <Labelled
            label="Reference prefix"
            hint={`This firm has already issued references. Docket reads the prefix afresh every time it numbers something, so changing it now would leave one year's numbering carrying two prefixes — ${operations.referencePrefix}-${year}-000004 followed by something else. It stays as it is.`}
          >
            <p className="rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-base font-medium text-gray-900">
              {operations.referencePrefix}
            </p>
          </Labelled>
        ) : (
          <Input
            label="Reference prefix"
            value={referencePrefix}
            onChange={(e) => setReferencePrefix(e.target.value.toUpperCase())}
            maxLength={8}
            hint={`2 to 8 letters or digits. Your references will read ${(referencePrefix || "…")}-${year}-000001 for a consultation, ${(referencePrefix || "…")}-M-${year}-000001 for a matter and ${(referencePrefix || "…")}-INV-${year}-000001 for an invoice. Once the first reference is issued this is fixed.`}
          />
        )}

        <SaveButton pending={pending} />
      </form>
      <Outcome result={result} />
    </Section>
  );
}

// ---------------------------------------------------------------- settlement

function SettlementSection({ firmId, settlement }: FirmSettingsProps) {
  const { pending, result, run } = useSave();
  const [code, setCode] = useState(settlement.paystackSubaccount);

  return (
    <Section
      title="Settlement"
      hint="Where a client's payment lands. Docket's Paystack account only routes the charge; this subaccount receives your fee."
    >
      {!settlement.paystackSubaccount && (
        <Alert kind="warning" title="This firm cannot take a prepaid booking yet">
          Until a subaccount is here, a booking for a service that must be paid for in advance is
          refused with: “this firm is not yet set up to receive payments”. A free consultation still
          books.
        </Alert>
      )}
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => updateFirmSettlement(firmId, { paystackSubaccount: code }));
        }}
      >
        <Input
          label="Paystack subaccount code"
          value={code}
          onChange={(e) => setCode(e.target.value.trim())}
          placeholder="ACCT_"
          spellCheck={false}
          autoCapitalize="off"
          hint="Starts with ACCT_ and is followed by letters and digits. Copy it from your Paystack dashboard. Leave it empty to stop taking money altogether — not only new prepaid bookings, but every invoice already issued and still unpaid."
        />
        <SaveButton pending={pending} />
      </form>
      <Outcome result={result} />
    </Section>
  );
}

// ---------------------------------------------------------------- matter walls

function ConflictsSection({ firmId, conflictChecksRequired }: FirmSettingsProps) {
  const { pending, result, run } = useSave();
  const [enabled, setEnabled] = useState(conflictChecksRequired);

  return (
    <Section
      title="Conflict checks"
      hint="A check searches this firm's own register — its clients, the other sides it has recorded, cause titles — and a lawyer decides. Off, checks are advisory. On, no client joins a matter until one is cleared."
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => updateConflictChecksRequired(firmId, enabled));
        }}
      >
        <label className="flex min-h-[44px] items-start gap-3 rounded-lg border border-gray-200 px-3.5 py-3">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="mt-1 h-5 w-5 shrink-0" />
          <span className="text-sm text-gray-800">
            <span className="font-medium">Require a cleared conflict check before a client is joined to a matter.</span>
            <span className="mt-1 block text-gray-600">
              With this on, the database refuses to put a client on a matter — when the matter is opened, by
              invitation, or any other way — until the latest decided check on it is <em>clear</em> or <em>waived</em>
              with a note. A contact may still be invited. A check that found a conflict blocks until a later check
              clears it. Nothing already on the books changes.
            </span>
            <span className="mt-1 block text-gray-600">
              Docket never decides a conflict: it finds the names and records who decided what, and when.
            </span>
          </span>
        </label>
        <SaveButton pending={pending} />
      </form>
      <Outcome result={result} />
    </Section>
  );
}

function WallsSection({ firmId, matterWalls }: FirmSettingsProps) {
  const { pending, result, run } = useSave();
  const [enabled, setEnabled] = useState(matterWalls);

  return (
    <Section
      title="Matter walls"
      hint="Off, every member of the firm sees every matter — the default. On, a matter's team can restrict it to themselves."
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => updateMatterWalls(firmId, enabled));
        }}
      >
        <label className="flex min-h-[44px] items-start gap-3 rounded-lg border border-gray-200 px-3.5 py-3">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="mt-1 h-5 w-5 shrink-0" />
          <span className="text-sm text-gray-800">
            <span className="font-medium">Members of a matter's team may restrict that matter to the team.</span>
            <span className="mt-1 block text-gray-600">
              A restricted matter — its documents, messages, timeline, tasks, court dates, parties and invoices — is
              readable and writable only by the people on its team. Owners and admins are not exempt: a wall partners
              can walk through is not a wall. The client on the matter sees exactly what they saw before. Nothing is
              restricted by switching this on; each matter is restricted, by its own team, from its Edit tab.
            </span>
            <span className="mt-1 block text-gray-600">
              It cannot be switched off while any matter is still restricted: open those first, one by one, so nobody's
              file is quietly opened to the whole firm by a checkbox.
            </span>
          </span>
        </label>
        <SaveButton pending={pending} />
      </form>
      <Outcome result={result} />
    </Section>
  );
}

// ---------------------------------------------------------------- service of process

function ServiceSection({ firmId, serviceOfProcess, colleagues, status }: FirmSettingsProps) {
  const { pending, result, run } = useSave();
  const [accepts, setAccepts] = useState(serviceOfProcess.accepts);
  const [chambers, setChambers] = useState(serviceOfProcess.chambers);
  const [email, setEmail] = useState(serviceOfProcess.email);
  const [phone, setPhone] = useState(serviceOfProcess.phone);
  const [contactUserId, setContactUserId] = useState(serviceOfProcess.contactUserId);

  return (
    <Section
      title="Service of process"
      hint="Your address for service, and whether other firms on Docket may serve non-originating processes on you here."
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => updateServiceOfProcess(firmId, { acceptsPlatformService: accepts, chambers, email, phone, contactUserId }));
        }}
      >
        <label className="flex min-h-[44px] items-start gap-3 rounded-lg border border-gray-200 px-3.5 py-3">
          <input
            type="checkbox"
            checked={accepts}
            onChange={(e) => setAccepts(e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0"
          />
          <span className="text-sm text-gray-800">
            <span className="font-medium">This firm undertakes to accept service of non-originating processes through Docket.</span>
            <span className="mt-1 block text-gray-600">
              An originating process is never served through Docket. Turning this on puts your firm
              in the directory other firms choose from when they serve, and anything served arrives
              in your service inbox.
              {status === "pending" && " Docket only offers a firm for service once it is active."}
            </span>
          </span>
        </label>

        <Labelled
          label="Address for service"
          htmlFor="address-for-service"
          hint="What gets printed on a process served on this firm. Give the full chambers address."
        >
          <textarea
            id="address-for-service"
            className={AREA}
            value={chambers}
            maxLength={400}
            onChange={(e) => setChambers(e.target.value)}
            placeholder="Floor, building, street, city, state"
          />
        </Labelled>

        <Input label="Email for service" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} inputMode="email" />
        <Input
          label="Phone for service"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="tel"
          hint="A Nigerian number in any form, or a full international number."
        />

        <Select label="Who is told first when something is served" value={contactUserId} onChange={(e) => setContactUserId(e.target.value)}>
          <option value="">Every owner and administrator</option>
          {colleagues.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>

        <SaveButton pending={pending} />
      </form>
      <Outcome result={result} />
    </Section>
  );
}

// ---------------------------------------------------------------- brand

function BrandSection({ firmId, firmName, brand }: FirmSettingsProps) {
  const { pending, result, run } = useSave();
  const [tagline, setTagline] = useState(brand?.tagline ?? "");
  const [cta, setCta] = useState(brand?.cta ?? "");
  const [logoPath, setLogoPath] = useState(brand?.logo_path ?? "");
  const [primary, setPrimary] = useState(brand?.colours?.primary ?? "");
  const [accent, setAccent] = useState(brand?.colours?.accent ?? "");
  const [surface, setSurface] = useState(brand?.colours?.surface ?? "");
  const [headingFont, setHeadingFont] = useState(brand?.fonts?.heading ?? "");
  const [bodyFont, setBodyFont] = useState(brand?.fonts?.body ?? "");
  const [contactEmail, setContactEmail] = useState(brand?.contact?.email ?? "");
  const [contactPhone, setContactPhone] = useState(brand?.contact?.phone ?? "");
  const [contactAddress, setContactAddress] = useState(brand?.contact?.address ?? "");
  const [contactWhatsapp, setContactWhatsapp] = useState(
    ((brand?.contact ?? {}) as { whatsapp?: string | null }).whatsapp ?? "",
  );
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const preview: FirmBrand = {
    tagline,
    cta,
    colours: { primary: primary || undefined, accent: accent || undefined, surface: surface || undefined },
    fonts: { heading: headingFont || undefined, body: bodyFont || undefined },
  };

  const logoUrl = useMemo(() => {
    if (!logoPath) return null;
    const supabase = supabaseBrowser();
    if (!supabase) return null;
    return supabase.storage.from("firm-assets").getPublicUrl(logoPath).data.publicUrl;
  }, [logoPath]);

  async function uploadLogo(file: File) {
    setUploadError(null);
    const supabase = supabaseBrowser();
    if (!supabase) {
      setUploadError("Storage is not configured on this host, so a logo cannot be uploaded here.");
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setUploadError(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The firm-assets bucket refuses anything over 5 MB.`);
      return;
    }
    if (!LOGO_TYPES.includes(file.type)) {
      setUploadError(`The bucket accepts PNG, JPEG, WebP and SVG. That file is ${file.type || "of an unknown type"}.`);
      return;
    }
    setUploading(true);
    const extension = (file.name.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    // The bucket's policy is `admin_w(firm_id)` on the FIRST folder of the path, so the firm id
    // has to lead. A new name each time, because the file is cached publicly by its URL.
    const path = `${firmId}/logo-${Date.now()}${extension ? `.${extension}` : ""}`;
    const { error } = await supabase.storage.from("firm-assets").upload(path, file, { contentType: file.type, upsert: false });
    setUploading(false);
    if (error) {
      setUploadError(error.message);
      return;
    }
    setLogoPath(path);
  }

  return (
    <Section
      title="Brand"
      hint="Docket keeps only what is on this form. Anything else is thrown away as it is saved, without a word of warning — so the form offers exactly what survives."
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(() =>
            updateBrand(firmId, {
              tagline,
              cta,
              logoPath,
              primary,
              accent,
              surface,
              headingFont,
              bodyFont,
              contactEmail,
              contactPhone,
              contactAddress,
              contactWhatsapp,
            }),
          );
        }}
      >
        <Input label="Tagline" value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={200} hint="One line under your name on the public site." />
        <Input label="Button wording" value={cta} onChange={(e) => setCta(e.target.value)} maxLength={200} hint="What the booking button says, for example “Book a consultation”." />

        <div className="grid gap-4 sm:grid-cols-3">
          <ColourField label="Primary" value={primary} onChange={setPrimary} />
          <ColourField label="Accent" value={accent} onChange={setAccent} />
          <ColourField label="Background" value={surface} onChange={setSurface} />
        </div>
        <p className="-mt-2 text-sm text-gray-500">
          Six-digit hex, such as #1c2b3a. The database stores it lowercase and drops anything that is
          not six hex digits.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Heading typeface" value={headingFont} onChange={(e) => setHeadingFont(e.target.value)} maxLength={40} hint="Letters, digits and spaces only." />
          <Input label="Body typeface" value={bodyFont} onChange={(e) => setBodyFont(e.target.value)} maxLength={40} hint="A Google Fonts family name." />
        </div>

        <Labelled
          label="Logo"
          htmlFor="brand-logo-file"
          hint="Stored in the firm-assets bucket under this firm's own folder: public to read, and only an owner or administrator of this firm may write there. PNG, JPEG, WebP or SVG, up to 5 MB."
        >
          <div className="space-y-3">
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="The logo currently stored for this firm" className="max-h-24 w-auto rounded border border-gray-200 bg-white p-2" />
            )}
            <input
              id="brand-logo-file"
              type="file"
              accept={LOGO_TYPES.join(",")}
              className="block w-full text-sm text-gray-700 file:mr-3 file:min-h-[44px] file:rounded-lg file:border-0 file:bg-brand file:px-4 file:py-2.5 file:text-sm file:font-medium file:text-white"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadLogo(file);
              }}
            />
            {uploading && <p className="text-sm text-gray-600">Uploading…</p>}
            {uploadError && (
              <Alert kind="error" title="The upload was refused">
                {uploadError}
              </Alert>
            )}
            {logoPath && (
              <p className="text-sm text-gray-500">
                Stored at <code className="break-all">{logoPath}</code>. Press Save to keep it on the
                firm — until you do, the path is only in this browser.
              </p>
            )}
            <Alert kind="info" title="Where the logo is used today">
              Docket keeps the path on the firm and shows the file here. The site icon your clients
              see in a browser tab is still drawn from your firm's initial on your primary colour —
              no page renders this file yet.
            </Alert>
          </div>
        </Labelled>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Contact email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} maxLength={200} inputMode="email" />
          <Input label="Contact phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} maxLength={200} inputMode="tel" />
          <Input label="Contact address" value={contactAddress} onChange={(e) => setContactAddress(e.target.value)} maxLength={200} />
          <Input label="WhatsApp number" value={contactWhatsapp} onChange={(e) => setContactWhatsapp(e.target.value)} maxLength={200} inputMode="tel" />
        </div>

        <Labelled label="How it looks">
          {/* text-brand-on and text-brand-on-accent, NOT text-white. This panel is inside
              brandStyle(preview), so bg-brand here is the firm's own colour, and the real
              site draws its foreground with readableForeground() — ink on a pale brand,
              paper on a dark one. Hard-coding white would make the preview disagree with
              the page it is previewing: a firm that picks pale gold would see illegible
              white-on-gold here and go and change a colour that was never wrong. */}
          <div style={brandStyle(preview)} className="rounded-card border border-gray-200 bg-brand-surface p-4">
            <p className="font-heading text-lg font-semibold text-brand">{firmName}</p>
            {tagline && <p className="mt-1 font-body text-sm text-gray-700">{tagline}</p>}
            <span className="mt-3 inline-flex min-h-[44px] items-center rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-brand-on">
              {cta || "Book a consultation"}
            </span>
            <span className="ml-2 inline-flex min-h-[44px] items-center rounded-lg bg-brand-accent px-4 py-2.5 text-sm font-medium text-brand-on-accent">
              Our services
            </span>
          </div>
        </Labelled>

        <SaveButton pending={pending} />
      </form>
      <Outcome result={result} />
    </Section>
  );
}

function ColourField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <Labelled label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} colour picker`}
          value={valid ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-12 shrink-0 rounded border border-gray-300 bg-white"
        />
        <input
          className={cn(FIELD, !valid && value !== "" && "border-red-600")}
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          placeholder="#000000"
          maxLength={7}
          spellCheck={false}
          aria-label={label}
        />
      </div>
      {!valid && value !== "" && <p className="text-sm text-red-700">Six hex digits after a #, or the database drops it.</p>}
    </Labelled>
  );
}

// ---------------------------------------------------------------- policies

function PoliciesSection({ firmId, policies, policyDocumentsAtRisk }: FirmSettingsProps) {
  const { pending, result, run } = useSave();
  const [terms, setTerms] = useState<PolicyDoc>(policies.terms);
  const [privacy, setPrivacy] = useState<PolicyDoc>(policies.privacy);
  const [acknowledge, setAcknowledge] = useState(false);

  const published = (v: string) => v !== "" && !v.startsWith("0-");
  const termsWasPublished = published(policies.terms.version);
  const privacyWasPublished = published(policies.privacy.version);
  const changing: string[] = [];
  if (termsWasPublished && terms.version !== policies.terms.version) changing.push("terms of service");
  if (privacyWasPublished && privacy.version !== policies.privacy.version) changing.push("privacy notice");

  const draft = !termsWasPublished || !privacyWasPublished;
  const badVersion = terms.version.startsWith("0-") || privacy.version.startsWith("0-");
  const blocked = badVersion || (changing.length > 0 && !acknowledge);

  return (
    <Section
      title="Policies"
      hint="Your terms of service and your privacy notice, each with its own version. Docket records which version a client accepted, against that exact string."
    >
      {draft && (
        <Alert kind="warning" title="Booking is closed until both are published">
          A document with no version, or one whose version begins “0-” — Docket's mark for “not
          published yet” — counts as unpublished, and while either stands every booking is refused
          with: “this firm has not published its terms and privacy notice yet”. Give both documents
          a real version to open bookings.
        </Alert>
      )}

      {policyDocumentsAtRisk.length > 0 && (
        <Alert kind="warning" title="Saving here removes something else that is stored">
          Docket keeps four policy documents and no others: terms, privacy, engagement and
          cancellation. The {policyDocumentsAtRisk.join(", ")} stored today{" "}
          {policyDocumentsAtRisk.length === 1 ? "is" : "are"} dropped the moment anything on this card
          is saved. Copy the wording somewhere safe first if you still need it.
        </Alert>
      )}

      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (blocked) return;
          run(() => updatePolicies(firmId, { terms, privacy, acknowledgeReconsent: acknowledge }));
        }}
      >
        <PolicyFields title="Terms of service" idPrefix="terms" doc={terms} onChange={setTerms} />
        <PolicyFields title="Privacy notice" idPrefix="privacy" doc={privacy} onChange={setPrivacy} />

        {badVersion && (
          <Alert kind="error" title="That version cannot be published">
            A version that starts “0-” means “not published yet” everywhere in Docket, and booking
            stays closed while one is in force. Use something like {new Date().getUTCFullYear()}-01
            instead.
          </Alert>
        )}

        {changing.length > 0 && (
          <Alert kind="warning" title="Every client of this firm will be asked to accept again">
            <p>
              You are changing the version of the {changing.join(" and the ")}. The portal compares
              a client&rsquo;s recorded consent against the version string exactly, so the moment
              this is saved every client of this firm meets a consent screen the next time they open
              their portal home, and until they accept, what Docket has on record is their consent
              to the old version.
            </p>
            <label className="mt-3 flex min-h-[44px] items-start gap-3">
              <input type="checkbox" checked={acknowledge} onChange={(e) => setAcknowledge(e.target.checked)} className="mt-1 h-5 w-5 shrink-0" />
              <span className="font-medium">I understand, and I mean to ask every client to accept again.</span>
            </label>
          </Alert>
        )}

        <SaveButton pending={pending}>{draft ? "Publish" : "Save"}</SaveButton>
        {blocked && !badVersion && <p className="text-sm text-gray-600">Tick the box above to save.</p>}
      </form>
      <Outcome result={result} />
    </Section>
  );
}

function PolicyFields({
  title,
  doc,
  onChange,
  idPrefix,
}: {
  title: string;
  doc: PolicyDoc;
  onChange: (d: PolicyDoc) => void;
  idPrefix: string;
}) {
  const set = (patch: Partial<PolicyDoc>) => onChange({ ...doc, ...patch });
  return (
    <fieldset className="space-y-4 rounded-card border border-gray-200 p-4">
      <legend className="px-1 font-heading text-sm font-semibold text-gray-900">{title}</legend>
      <div className="flex items-center gap-2">
        <Badge className={doc.version && !doc.version.startsWith("0-") ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}>
          {doc.version ? (doc.version.startsWith("0-") ? "not published" : `version ${doc.version}`) : "no version"}
        </Badge>
      </div>
      <Input
        id={`${idPrefix}-version`}
        label="Version"
        value={doc.version}
        onChange={(e) => set({ version: e.target.value })}
        maxLength={40}
        hint="Any short label you will recognise later, such as 2026-01. Changing it asks every client to accept again."
      />
      <Input id={`${idPrefix}-title`} label="Title" value={doc.title} onChange={(e) => set({ title: e.target.value })} maxLength={200} />
      <Input
        id={`${idPrefix}-url`}
        label="Link to the full document"
        value={doc.url}
        onChange={(e) => set({ url: e.target.value.trim() })}
        placeholder="https://"
        spellCheck={false}
        hint="An https:// address. Your public page shows this link when you give one; the database drops anything that is not https."
      />
      <Labelled
        label="Text"
        htmlFor={`${idPrefix}-text`}
        hint="The wording recorded against this version. Angle brackets are removed by the database as it stores this."
      >
        <textarea id={`${idPrefix}-text`} className={AREA} value={doc.text} onChange={(e) => set({ text: e.target.value })} rows={8} />
      </Labelled>
    </fieldset>
  );
}

// ---------------------------------------------------------------- domain

function DomainSection({ firmId, firmSlug, customDomain, openRequest, decidedRequests, deploymentHost }: FirmSettingsProps) {
  const { pending, result, run } = useSave();
  const [hostname, setHostname] = useState("");
  const [note, setNote] = useState("");

  // Vercel returns the records to add as a LIST of {type, domain, value, reason}. This used to
  // run Object.entries() over that list and String() each entry, which printed "[object Object]"
  // where a firm expected a TXT record to copy — the one thing the panel exists to show.
  type DnsRecord = { type?: unknown; domain?: unknown; value?: unknown; reason?: unknown };
  const raw: unknown = openRequest?.verification ?? null;
  const records: DnsRecord[] = Array.isArray(raw)
    ? (raw as DnsRecord[])
    : raw && typeof raw === "object"
      ? Object.values(raw as Record<string, DnsRecord>).filter((r) => r && typeof r === "object")
      : [];
  const text = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");

  return (
    <Section
      title="Your address on the web"
      hint="Only Docket can map a hostname to a firm, so a firm asks and Docket maps it. Your site is always reachable at its Docket address."
    >
      <dl>
        <Row label="Docket address" value={`/${firmSlug}`} />
        <Row label="Custom domain" value={customDomain ?? ""} />
      </dl>

      {openRequest ? (
        <div className="space-y-3">
          <Alert kind="info" title={`${openRequest.hostname} — ${openRequest.status}`}>
            {openRequest.status === "requested"
              ? "Docket has your request and has not started on it yet."
              : "Docket is verifying this hostname."}
            {openRequest.note ? ` Docket says: ${openRequest.note}` : ""}
          </Alert>
          {records.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full min-w-[24rem] text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th scope="col" className="px-3 py-2">Type</th>
                    <th scope="col" className="px-3 py-2">Name</th>
                    <th scope="col" className="px-3 py-2">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {records.map((r, i) => (
                    <tr key={`${text(r.type)}-${text(r.domain)}-${i}`}>
                      <td className="px-3 py-2 font-medium text-gray-700">{text(r.type) || "—"}</td>
                      <td className="break-all px-3 py-2 text-gray-800"><code>{text(r.domain) || "—"}</code></td>
                      <td className="break-all px-3 py-2 text-gray-800">
                        <code>{text(r.value) || "—"}</code>
                        {text(r.reason) && <p className="mt-1 text-xs text-gray-500">{text(r.reason)}</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-600">
              No DNS records to add yet. When Docket starts verifying, the records appear here. In
              most cases the record points at <code className="break-all">{deploymentHost || "this deployment"}</code>.
            </p>
          )}
          <Button
            variant="ghost"
            size="lg"
            disabled={pending}
            className="w-full sm:w-auto"
            onClick={() => run(() => withdrawDomainRequest(openRequest.id))}
          >
            {pending ? "Withdrawing…" : "Withdraw this request"}
          </Button>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => requestDomain(firmId, hostname, note));
          }}
        >
          <Input
            label="The hostname you want"
            value={hostname}
            onChange={(e) => setHostname(e.target.value.trim().toLowerCase())}
            placeholder="chambers.example.ng"
            spellCheck={false}
            autoCapitalize="off"
            hint="The bare hostname: no https://, no trailing slash, no port. Docket refuses anything it could not match against a request arriving at your site."
          />
          <Input
            label="Anything Docket should know"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            hint="Optional — who controls the DNS, when you need it live."
          />
          <SaveButton pending={pending}>Ask Docket for this domain</SaveButton>
        </form>
      )}

      {decidedRequests.length > 0 && (
        <div className="pt-2">
          <h3 className="text-sm font-medium text-gray-700">Earlier requests, five most recent</h3>
          <ul className="mt-2 space-y-1 text-sm text-gray-600">
            {decidedRequests.map((r) => (
              <li key={r.id} className="break-words">
                <span className="font-medium text-gray-800">{r.hostname}</span> — {r.status}
                {r.note ? `: ${r.note}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Outcome result={result} />
    </Section>
  );
}

// ---------------------------------------------------------------- templates

/** Docket's own words for an event, with the blanks it fills from the appointment removed. */
function docketSentence(event: string, firmName: string, timezone: string): { title: string; body: string } {
  const copy = describeNotification(event, {}, firmName, timezone);
  const body = copy.body.replace(/\s*·\s*/g, " ").trim();
  return { title: copy.title.trim(), body };
}

function TemplatesSection({ firmId, firmName, timezone, templates }: FirmSettingsProps) {
  const { pending, result, run } = useSave();
  const [rows, setRows] = useState(() =>
    PREFERENCE_EVENTS.map((e) => ({
      event: e.event,
      label: e.label,
      subject: templates[e.event]?.subject ?? "",
      text: templates[e.event]?.text ?? "",
    })),
  );
  // Which sections start open, decided ONCE. Deriving it from the text on every render would
  // snap a section shut the moment someone deleted the last character they had typed.
  const [openAtFirst] = useState(
    () => new Set(PREFERENCE_EVENTS.filter((e) => (templates[e.event]?.text ?? "").trim().length > 0).map((e) => e.event)),
  );

  const overridden = rows.filter((r) => r.text.trim().length > 0).length;
  const set = (event: string, patch: { subject?: string; text?: string }) =>
    setRows((current) => current.map((r) => (r.event === event ? { ...r, ...patch } : r)));

  return (
    <Section
      title="What your messages say"
      hint="Docket writes every message to your clients in its own words and signs it with your firm's name. Where those words are not yours, replace them here."
    >
      <Alert kind="warning" title="What you write here is what your client receives">
        This is not a draft. Whatever you save for an event is the sentence Docket sends for it,
        by email, SMS and push, to real clients. An empty box means Docket&rsquo;s own words.
      </Alert>

      <Alert kind="info" title="Putting the details in">
        A word in braces is replaced when the message goes out. Every message can use{" "}
        <code>{"{firm}"}</code> for your firm&rsquo;s name and <code>{"{when}"}</code> for the time
        of the appointment or sitting, in the client&rsquo;s own time zone. Depending on the event
        you can also use <code>{"{reference}"}</code>, <code>{"{invoice_number}"}</code>,{" "}
        <code>{"{amount}"}</code> and <code>{"{purpose}"}</code>. A word in braces that Docket does
        not recognise is left in the message exactly as you typed it, so the client would read it —
        which is deliberate, because you are the only person who can correct it.
      </Alert>

      <Alert kind="info" title="An empty box means Docket's own sentence">
        Leave a message empty and it goes out in Docket's words, which are shown above each box.
        Docket keeps a subject of up to 200 characters and a message of up to 1,000, and strips out
        angle brackets. These are the messages a client can choose to receive; a few others — the
        nudge when a consultation is ready to join, for instance — always go out in Docket's words
        and cannot be changed here. The notices clients see inside the app are worded separately and
        are not changed here either.
      </Alert>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => updateNotificationTemplates(firmId, rows.map(({ event, subject, text }) => ({ event, subject, text }))));
        }}
      >
        {rows.map((row) => {
          const docket = docketSentence(row.event, firmName, timezone);
          return (
            <details key={row.event} className="rounded-card border border-gray-200" open={openAtFirst.has(row.event)}>
              <summary className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-gray-900">
                <span>{row.label}</span>
                <Badge className={row.text.trim() ? "bg-emerald-100 text-emerald-900" : ""}>
                  {row.text.trim() ? "your words" : "Docket's words"}
                </Badge>
              </summary>
              <div className="space-y-3 border-t border-gray-100 px-4 py-3">
                <p className="text-sm text-gray-600">
                  Docket says: <span className="font-medium text-gray-800">{docket.title}</span>
                  {docket.body ? ` — ${docket.body}` : ""}
                </p>
                <Input
                  id={`tpl-${row.event}-subject`}
                  label="Subject"
                  value={row.subject}
                  onChange={(e) => set(row.event, { subject: e.target.value })}
                  maxLength={200}
                  hint="Used on email. Leave it empty to keep Docket's."
                />
                <Labelled label="Message" htmlFor={`tpl-${row.event}-text`}>
                  <textarea
                    id={`tpl-${row.event}-text`}
                    className={AREA}
                    value={row.text}
                    maxLength={1000}
                    rows={3}
                    onChange={(e) => set(row.event, { text: e.target.value })}
                    placeholder="Leave empty to keep Docket's wording"
                  />
                </Labelled>
              </div>
            </details>
          );
        })}

        <p className="text-sm text-gray-600">
          {overridden === 0
            ? "Nothing is overridden: every message goes out in Docket's words."
            : `${overridden} of ${rows.length} events would go out in your words.`}
        </p>
        <SaveButton pending={pending} />
      </form>
      <Outcome result={result} />
    </Section>
  );
}
