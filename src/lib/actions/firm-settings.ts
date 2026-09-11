"use server";

// The firm's own settings: every write behind /firm/admin/settings.
//
// Screens served: /firm/admin/settings (identity, operations, settlement, service of process,
// brand, policies, domain, message templates).
//
// Rules obeyed here:
//  · THE DATABASE IS THE AUTHORIZATION LAYER. Seven of these nine writes are plain UPDATEs on
//    the firms row, running as the signed-in person under `firms_update` — `admin_w(id)`, which
//    is owner-or-admin AND an MFA session AND a firm that is not suspended (migration 13).
//    The other two are the RPCs migration 20 added, request_firm_domain() and
//    withdraw_firm_domain_request(), because a firm may not write firms.custom_domain and
//    should not be able to. Nothing in this file decides who may write.
//  · A row that an RLS policy's USING clause excludes is NOT an error in Postgres: the
//    statement simply changes nothing and says nothing. So every update asks PostgREST for the
//    affected-row count, and when it is zero it asks the DATABASE why — admin_w(), mfa_ok() and
//    firm_not_suspended() are called directly and their answers are reported. Where the
//    database does give words, those words are passed through untouched.
//  · Three columns are rewritten by triggers as they are stored: firms.brand by
//    validate_brand() (migration 13), firms.policies by validate_policies() and
//    firms.notification_templates by validate_notification_templates() (both migration 20).
//    Each of those three writes re-reads the row afterwards and reports, field by field, what
//    the database dropped or changed — a silent rewrite that nobody is told about is a lie on
//    the screen.
//  · Nothing firm-specific. The firm arrives as an argument from staffContext(): no slug, no
//    name, no colour, no domain is written down here.
//  · firms.status, plan, verified_at, slug and custom_domain are never patched from this file.
//    guard_firm_lifecycle_columns() raises 42501 on any of them, and it is right to.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { NG_STATES, isE164, normalizeNigerianPhone } from "@/lib/nigeria";

// ---------------------------------------------------------------- shared shapes

export interface SettingsResult {
  error?: string;
  ok?: true;
  /** True things worth saying that are not failures: what the database rewrote, dropped or kept. */
  notes?: string[];
}

export interface IdentityInput {
  name: string;
  legalName: string;
  rcNumber: string;
  tin: string;
  stateCode: string;
}

export interface OperationsInput {
  timezone: string;
  defaultCurrency: string;
  vatRate: string;
  /** Only read when the firm has not issued a reference yet; refused otherwise. */
  referencePrefix: string;
}

export interface SettlementInput {
  paystackSubaccount: string;
}

export interface ServiceOfProcessInput {
  acceptsPlatformService: boolean;
  chambers: string;
  email: string;
  phone: string;
  contactUserId: string;
}

/** Exactly the fields validate_brand() keeps. Anything else is dropped by the database. */
export interface BrandInput {
  tagline: string;
  cta: string;
  logoPath: string;
  primary: string;
  accent: string;
  surface: string;
  headingFont: string;
  bodyFont: string;
  contactEmail: string;
  contactPhone: string;
  contactAddress: string;
  contactWhatsapp: string;
}

export interface PolicyDocInput {
  version: string;
  title: string;
  text: string;
  url: string;
}

export interface PoliciesInput {
  terms: PolicyDocInput;
  privacy: PolicyDocInput;
  /** Ticked by the person saving when a published version changes and every client must re-accept. */
  acknowledgeReconsent: boolean;
}

export interface TemplateInput {
  event: string;
  subject: string;
  text: string;
}

type Json = Record<string, unknown>;

const uuid = z.string().uuid();

/** A PostgREST error, word for word, with whatever detail the database attached to it. */
function verbatim(error: { message: string; details?: string | null; hint?: string | null }): string {
  return [error.message, error.details ?? "", error.hint ?? ""]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" — ");
}

/**
 * Nothing was updated and Postgres said nothing, because a USING clause that excludes a row is
 * silence, not an error. Ask the database the three questions firms_update actually asks, and
 * report its answers rather than guessing at them here.
 */
async function whyNothingChanged(
  supabase: NonNullable<Awaited<ReturnType<typeof supabaseServer>>>,
  firmId: string,
): Promise<string> {
  const [allowed, mfa, notSuspended] = await Promise.all([
    supabase.rpc("admin_w", { f: firmId }),
    supabase.rpc("mfa_ok"),
    supabase.rpc("firm_not_suspended", { f: firmId }),
  ]);
  if (allowed.error) {
    return `Nothing was changed, and the database could not say why: ${verbatim(allowed.error)}. Reload the page and try again.`;
  }
  if (allowed.data === true) {
    return "The database says you may write here, but no firm row matched. Reload the page and try again.";
  }
  const reasons: string[] = [];
  if (mfa.data === false) {
    reasons.push("your session is not two-factor verified, so sign in again with your authenticator");
  }
  if (notSuspended.data === false) {
    reasons.push("this firm is suspended, and every change is refused until Docket lifts it");
  }
  if (mfa.data !== false && notSuspended.data !== false) {
    reasons.push("this account is not an owner or an administrator of this firm");
  }
  // The refusal has no words of its own — a row a policy excludes simply does not change — so
  // the rule is named once, and the database's own answers stand as the reason.
  const why = reasons.join("; ");
  return `The database refused it and gave no message: that is what happens when a rule excludes the row, and the rule here is admin_w(). ${why.charAt(0).toUpperCase()}${why.slice(1)}. Nothing was changed.`;
}

/**
 * The firm's own screens, plus Today. The PUBLIC site reads firm_public through the tenant
 * cache in src/lib/tenant.ts, which holds a firm for sixty seconds; brand and policy changes
 * appear there within a minute, and the screens say so.
 */
function refresh() {
  revalidatePath("/firm/admin/settings");
  revalidatePath("/firm/admin");
  revalidatePath("/firm");
}

/**
 * Has this firm ever issued a reference? next_reference() feeds on firms.reference_prefix
 * live, so changing the prefix mid-year leaves one year's numbering carrying two prefixes.
 *
 * firm_counters is the authoritative answer, but the schema migration revoked ALL grants on it
 * from anon and authenticated — only next_reference() touches it — so the read is attempted and
 * then falls back to the references themselves, which a firm member may read.
 */
async function referenceIssued(
  supabase: NonNullable<Awaited<ReturnType<typeof supabaseServer>>>,
  firmId: string,
): Promise<boolean> {
  const counters = await supabase
    .from("firm_counters")
    .select("kind", { count: "exact", head: true })
    .eq("firm_id", firmId);
  if (!counters.error) return (counters.count ?? 0) > 0;

  const [matters, invoices, appointments] = await Promise.all([
    supabase.from("matters").select("id", { count: "exact", head: true }).eq("firm_id", firmId),
    supabase.from("invoices").select("id", { count: "exact", head: true }).eq("firm_id", firmId),
    supabase.from("appointments").select("id", { count: "exact", head: true }).eq("firm_id", firmId),
  ]);
  return (matters.count ?? 0) > 0 || (invoices.count ?? 0) > 0 || (appointments.count ?? 0) > 0;
}

/** Every leaf of a small json object, as path → value, so two versions can be compared. */
function flatten(value: unknown, prefix = "", out: Map<string, string> = new Map()): Map<string, string> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, inner] of Object.entries(value as Json)) {
      flatten(inner, prefix ? `${prefix}.${key}` : key, out);
    }
  } else if (value !== null && value !== undefined && value !== "") {
    out.set(prefix, String(value));
  }
  return out;
}

/** Long text is described, not quoted: a 60,000-character diff is not a sentence. */
function describeChange(label: string, sent: string, stored: string): string {
  if (sent.length > 120 || stored.length > 120) {
    return stored.length < sent.length
      ? `${label} was shortened by the database to ${stored.length} characters (it stores at most what the column allows, and strips < and >).`
      : `${label} was changed by the database as it was stored (< and > are stripped).`;
  }
  return `${label} was stored as “${stored}”, not “${sent}”.`;
}

const BRAND_LABELS: Record<string, string> = {
  tagline: "The tagline",
  cta: "The button wording",
  logo_path: "The logo",
  "colours.primary": "The primary colour",
  "colours.accent": "The accent colour",
  "colours.surface": "The background colour",
  "fonts.heading": "The heading typeface",
  "fonts.body": "The body typeface",
  "contact.email": "The contact email",
  "contact.phone": "The contact phone",
  "contact.address": "The contact address",
  "contact.whatsapp": "The WhatsApp number",
};

/** What the database kept, and what it quietly did not. */
function diffNotes(sent: Json, stored: Json, labels: Record<string, string>): string[] {
  const sentLeaves = flatten(sent);
  const storedLeaves = flatten(stored);
  const notes: string[] = [];
  for (const [path, sentValue] of sentLeaves) {
    const label = labels[path] ?? path;
    const storedValue = storedLeaves.get(path);
    if (storedValue === undefined) {
      notes.push(`${label} was dropped by the database and is not saved.`);
    } else if (storedValue !== sentValue) {
      notes.push(describeChange(label, sentValue, storedValue));
    }
  }
  return notes;
}

/**
 * Reads one column of the firms row, and says so when it could not.
 *
 * The distinction matters more than it looks. updatePolicies() reads the column BEFORE writing,
 * to carry forward the documents this screen does not edit and to notice a version change. If a
 * failed read came back as an empty object, those documents would be silently destroyed and the
 * re-consent confirmation would be skipped — both without a word on screen. So a failure is a
 * failure here, and every caller has to decide what to do about it.
 */
async function readFirmColumn(
  supabase: NonNullable<Awaited<ReturnType<typeof supabaseServer>>>,
  firmId: string,
  column: string,
): Promise<{ value: Json; error: string | null }> {
  const { data, error } = await supabase.from("firms").select(column).eq("id", firmId).maybeSingle();
  if (error) return { value: {}, error: error.message };
  const row = (data ?? null) as unknown as Record<string, unknown> | null;
  if (!row) return { value: {}, error: "This firm could not be read back." };
  const value = row[column];
  return { value: value && typeof value === "object" ? (value as Json) : {}, error: null };
}

/**
 * One UPDATE on the firms row, with the affected-row count PostgREST can return, so a refusal
 * that Postgres expresses as silence is caught and explained instead of looking like a save.
 */
async function updateFirm(firmId: string, patch: Record<string, unknown>): Promise<SettingsResult> {
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Docket is not configured on this host yet." };
  const { error, count } = await supabase
    .from("firms")
    .update(patch, { count: "exact" })
    .eq("id", firmId);
  if (error) return { error: verbatim(error) };
  if (count === 0) return { error: await whyNothingChanged(supabase, firmId) };
  return { ok: true };
}

// ---------------------------------------------------------------- shared field rules

/** Anything validate_brand() and validate_policies() would strip. Say so before saving, not after. */
const noAngles = (field: string) =>
  z.string().refine((v) => !/[<>]/.test(v), {
    message: `${field} cannot contain < or >. The database removes them as it stores the value.`,
  });

const plain = (field: string, max: number) => noAngles(field).pipe(z.string().trim().max(max, `${field} is longer than ${max} characters.`));

// ================================================================ identity

/**
 * Who the firm is on paper: the trading name clients see, the registered name that goes on a
 * process, the CAC number and the FIRS TIN that is printed on an invoice carrying VAT.
 */
export async function updateFirmIdentity(firmId: string, input: IdentityInput): Promise<SettingsResult> {
  if (!uuid.safeParse(firmId).success) return { error: "That firm could not be read." };

  const schema = z.object({
    name: z.string().trim().min(2, "A firm needs a name of at least two characters.").max(120, "Keep the name to 120 characters."),
    legalName: z.string().trim().max(200, "Keep the registered name to 200 characters."),
    rcNumber: z.string().trim().max(40, "Keep the RC or BN number to 40 characters."),
    tin: z.string().trim().max(40, "Keep the TIN to 40 characters."),
    stateCode: z
      .string()
      .trim()
      .toUpperCase()
      .refine((c) => c === "" || c in NG_STATES, "Choose a state from the list."),
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the details and try again." };
  const d = parsed.data;

  const result = await updateFirm(firmId, {
    name: d.name,
    legal_name: d.legalName || null,
    rc_number: d.rcNumber || null,
    tin: d.tin || null,
    state_code: d.stateCode || null,
  });
  if (result.error) return result;
  refresh();
  return {
    ok: true,
    notes: [
      "The name here is the name on the public site, on every notification Docket sends your clients, and at the head of the console.",
    ],
  };
}

// ================================================================ operations

/**
 * The four columns the rest of Docket calculates with: the zone a firm's day is measured in,
 * the currency new work starts in, the VAT rate an invoice is raised at, and the prefix on
 * every reference the firm issues.
 */
export async function updateFirmOperations(firmId: string, input: OperationsInput): Promise<SettingsResult> {
  if (!uuid.safeParse(firmId).success) return { error: "That firm could not be read." };

  const schema = z.object({
    timezone: z.string().trim().min(1, "Choose the zone this firm's day is measured in."),
    defaultCurrency: z.enum(["NGN", "USD"], { errorMap: () => ({ message: "Docket bills in naira or US dollars." }) }),
    vatRate: z
      .string()
      .trim()
      .regex(/^\d{1,3}(\.\d{1,2})?$/, "Give the VAT rate as a percentage, for example 7.5 or 0.")
      .refine((v) => Number(v) <= 100, "A VAT rate cannot be more than 100%."),
    referencePrefix: z.string().trim().toUpperCase(),
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the details and try again." };
  const d = parsed.data;

  // The column carries no zone list of its own — create_firm() checks pg_timezone_names, a
  // direct UPDATE does not — so an unusable zone would be stored and then break every rendered
  // time. Ask the runtime whether it can actually format in it.
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: d.timezone });
  } catch {
    return { error: `“${d.timezone}” is not a time zone this server knows. Pick one from the list.` };
  }

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Docket is not configured on this host yet." };

  const { data: current } = await supabase
    .from("firms")
    .select("reference_prefix")
    .eq("id", firmId)
    .maybeSingle();
  const currentPrefix = (current as { reference_prefix: string } | null)?.reference_prefix ?? "";

  const patch: Record<string, unknown> = {
    timezone: d.timezone,
    default_currency: d.defaultCurrency,
    vat_rate: Number(d.vatRate),
  };

  const notes: string[] = [];
  if (d.referencePrefix && d.referencePrefix !== currentPrefix) {
    if (!/^[A-Z0-9]{2,8}$/.test(d.referencePrefix)) {
      return { error: "A reference prefix is 2 to 8 letters or digits. Docket puts it in front of every reference this firm issues." };
    }
    if (await referenceIssued(supabase, firmId)) {
      return {
        error: `This firm has already issued references beginning ${currentPrefix}-. Changing the prefix now would leave one year's numbering carrying two prefixes, so it stays as it is.`,
      };
    }
    patch.reference_prefix = d.referencePrefix;
    notes.push(`References from now on read ${d.referencePrefix}-${new Date().getUTCFullYear()}-000001 for a consultation, ${d.referencePrefix}-M-… for a matter and ${d.referencePrefix}-INV-… for an invoice.`);
  }

  const result = await updateFirm(firmId, patch);
  if (result.error) return result;
  refresh();
  notes.push(
    "Invoices already raised keep the VAT rate and the currency they were raised at; this rate applies to the next one.",
  );
  return { ok: true, notes };
}

// ================================================================ settlement

/**
 * Where a client's money lands. The platform's Paystack account only routes: the subaccount
 * below is what receives the firm's fees, and until it is set book_appointment() refuses any
 * prepaid booking outright.
 */
export async function updateFirmSettlement(firmId: string, input: SettlementInput): Promise<SettingsResult> {
  if (!uuid.safeParse(firmId).success) return { error: "That firm could not be read." };

  const value = (input.paystackSubaccount ?? "").trim();
  if (value !== "" && !/^ACCT_[A-Za-z0-9]+$/.test(value)) {
    return { error: "A Paystack subaccount code starts with ACCT_ and is followed by letters and digits — copy it from your Paystack dashboard." };
  }

  const result = await updateFirm(firmId, { paystack_subaccount: value || null });
  if (result.error) return result;
  refresh();
  return {
    ok: true,
    notes: [
      value
        ? "Prepaid bookings can now settle to this account. Docket checks the subaccount a charge reports against this one and refuses to apply a payment that settled elsewhere."
        : "With no subaccount, a booking that requires prepayment is refused with “this firm is not yet set up to receive payments”. Free consultations still work.",
    ],
  };
}

// ================================================================ service of process

/**
 * Whether other firms on Docket may serve non-originating processes on this firm here, and the
 * address that is printed when they do. serve_process() also requires the firm to be ACTIVE, so
 * a pending firm can undertake this and it takes effect when Docket verifies the firm.
 */
/**
 * Matter walls: may this firm restrict a matter to its team? Off by default, which is the pooled
 * stance every partner sees the whole firm. The database refuses to switch it off while any
 * matter is still restricted (migration 29), and that refusal is shown verbatim: the fix is to
 * open those matters one by one, not to flip a checkbox over them.
 */
export async function updateMatterWalls(firmId: string, enabled: boolean): Promise<SettingsResult> {
  if (!uuid.safeParse(firmId).success) return { error: "That firm could not be read." };
  return updateFirm(firmId, { matter_walls: Boolean(enabled) });
}

export async function updateServiceOfProcess(firmId: string, input: ServiceOfProcessInput): Promise<SettingsResult> {
  if (!uuid.safeParse(firmId).success) return { error: "That firm could not be read." };

  const schema = z.object({
    acceptsPlatformService: z.boolean(),
    chambers: plain("The address for service", 400),
    email: plain("The email for service", 200),
    phone: z.string().trim().max(40, "Keep the phone number to 40 characters."),
    contactUserId: z.string().trim(),
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the address and try again." };
  const d = parsed.data;

  if (d.acceptsPlatformService && d.chambers.length === 0) {
    return { error: "Give the address for service before undertaking to accept service here — it is what gets printed on the process." };
  }

  let phone: string | null = null;
  if (d.phone) {
    phone = normalizeNigerianPhone(d.phone) ?? (isE164(d.phone) ? d.phone : null);
    if (!phone) {
      return { error: `“${d.phone}” is not a phone number Docket can read. Use 0803 123 4567 or a full international number such as +44 20 7946 0000.` };
    }
  }

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Docket is not configured on this host yet." };

  // address_for_service has no constraint of any kind on the column, and contact_user_id is
  // read by notify_firm() to decide who is told first when something is served. A stranger's
  // uuid there would silently notify nobody, so it is checked against the firm's own members —
  // integrity, not authorization: the RLS policy above still decides whether this write lands.
  let contact: string | null = null;
  if (d.contactUserId) {
    if (!uuid.safeParse(d.contactUserId).success) return { error: "That contact could not be read. Choose a colleague from the list." };
    const { data: member } = await supabase
      .from("firm_members")
      .select("user_id")
      .eq("firm_id", firmId)
      .eq("user_id", d.contactUserId)
      .maybeSingle();
    if (!member) return { error: "That person is not a member of this firm, so they would never be told when something is served." };
    contact = d.contactUserId;
  }

  const address: Json = {};
  if (d.chambers) address.chambers = d.chambers;
  if (d.email) address.email = d.email;
  if (phone) address.phone = phone;
  if (contact) address.contact_user_id = contact;

  const result = await updateFirm(firmId, {
    accepts_platform_service: d.acceptsPlatformService,
    address_for_service: address,
  });
  if (result.error) return result;
  refresh();

  const notes: string[] = [];
  notes.push(
    d.acceptsPlatformService
      ? "Other firms can now list this firm as accepting service through Docket. Docket only offers a firm for service while it is active."
      : "Docket will refuse any attempt to serve this firm through the platform. Service by every other means is unaffected.",
  );
  if (!contact) notes.push("With no named contact, Docket tells every owner and administrator of the firm when something is served.");
  if (phone && phone !== d.phone.trim()) notes.push(`The phone number is stored as ${phone}.`);
  return { ok: true, notes };
}

// ================================================================ brand

/**
 * firms.brand is rewritten as it is stored. validate_brand() (migration 13) keeps ONLY tagline,
 * cta, logo_path, colours.primary/accent/surface as six-digit hex, fonts.heading/body as
 * letters, digits and spaces up to 40 characters, and contact.email/phone/address/whatsapp —
 * everything else is dropped with no error at all. The schema below is that whitelist, so the
 * person typing is told first; the row is then re-read and the difference reported, because the
 * schema is a courtesy and the trigger is the rule.
 */
export async function updateBrand(firmId: string, input: BrandInput): Promise<SettingsResult> {
  if (!uuid.safeParse(firmId).success) return { error: "That firm could not be read." };

  const hex = (field: string) =>
    z
      .string()
      .trim()
      .refine((v) => v === "" || /^#[0-9a-fA-F]{6}$/.test(v), `${field} must be a six-digit hex colour such as #1c2b3a. The database drops anything else.`);
  const font = (field: string) =>
    z
      .string()
      .trim()
      .refine((v) => v === "" || /^[A-Za-z0-9 ]{1,40}$/.test(v), `${field} may only use letters, digits and spaces, up to 40 characters. The database drops anything else.`);

  const schema = z.object({
    tagline: plain("The tagline", 200),
    cta: plain("The button wording", 200),
    logoPath: plain("The logo", 200),
    primary: hex("The primary colour"),
    accent: hex("The accent colour"),
    surface: hex("The background colour"),
    headingFont: font("The heading typeface"),
    bodyFont: font("The body typeface"),
    contactEmail: plain("The contact email", 200),
    contactPhone: plain("The contact phone", 200),
    contactAddress: plain("The contact address", 200),
    contactWhatsapp: plain("The WhatsApp number", 200),
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the brand and try again." };
  const d = parsed.data;

  // Built exactly as validate_brand() would keep it, so the diff afterwards is meaningful:
  // the trigger lowercases a colour, so it is sent lowercase and never reported as a change.
  const brand: Json = {};
  if (d.tagline) brand.tagline = d.tagline;
  if (d.cta) brand.cta = d.cta;
  if (d.logoPath) brand.logo_path = d.logoPath;
  const colours: Json = {};
  if (d.primary) colours.primary = d.primary.toLowerCase();
  if (d.accent) colours.accent = d.accent.toLowerCase();
  if (d.surface) colours.surface = d.surface.toLowerCase();
  if (Object.keys(colours).length > 0) brand.colours = colours;
  const fonts: Json = {};
  if (d.headingFont) fonts.heading = d.headingFont;
  if (d.bodyFont) fonts.body = d.bodyFont;
  if (Object.keys(fonts).length > 0) brand.fonts = fonts;
  const contact: Json = {};
  if (d.contactEmail) contact.email = d.contactEmail;
  if (d.contactPhone) contact.phone = d.contactPhone;
  if (d.contactAddress) contact.address = d.contactAddress;
  if (d.contactWhatsapp) contact.whatsapp = d.contactWhatsapp;
  if (Object.keys(contact).length > 0) brand.contact = contact;

  const result = await updateFirm(firmId, { brand });
  if (result.error) return result;

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Docket is not configured on this host yet." };
  const { value: stored, error: readError } = await readFirmColumn(supabase, firmId, "brand");
  if (readError) return { notes: ["Saved, but the brand could not be read back to check what the database kept: " + readError] };
  refresh();

  const notes = diffNotes(brand, stored, BRAND_LABELS);
  notes.push("Your public site reads the brand through a sixty-second cache, so it changes over there within a minute.");
  return { ok: true, notes };
}

// ================================================================ policies

/**
 * firms.policies, one version per document. firm_policies_published() reads
 * policies -> 'terms' ->> 'version' and policies -> 'privacy' ->> 'version'; book_appointment()
 * refuses every booking until both are set and neither starts "0-"; and the client portal
 * compares consent_records.version against these strings by EXACT equality, so a changed
 * version locks every client of this firm out of their portal until they accept again.
 *
 * validate_policies() (migration 20) keeps privacy, terms, engagement, cancellation and
 * disclaimer. The disclaimer is the one that matters here: every firm is seeded with one and it
 * is rendered on the public footer, the booking confirm step and the policy pages, so it has to
 * be resent with every write or the save would strip it off all three.
 * Anything else stored under policies — including the "disclaimer" that seed_firm_defaults()
 * writes for every new firm — is dropped by the trigger on any write to the column. The screen
 * says so before saving; the diff below proves it afterwards.
 */
export async function updatePolicies(firmId: string, input: PoliciesInput): Promise<SettingsResult> {
  if (!uuid.safeParse(firmId).success) return { error: "That firm could not be read." };

  const docSchema = z.object({
    version: plain("A version", 40),
    title: plain("A title", 200),
    text: plain("The text", 60000),
    url: z
      .string()
      .trim()
      .refine((v) => v === "" || /^https:\/\/[a-z0-9.-]+(\/[^\s<>]*)?$/.test(v), "A link must be an https:// address with no spaces. The database drops anything else."),
  });
  const schema = z.object({
    terms: docSchema,
    privacy: docSchema,
    acknowledgeReconsent: z.boolean(),
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the policies and try again." };
  const d = parsed.data;

  for (const [key, doc] of [["terms", d.terms], ["privacy", d.privacy]] as const) {
    const label = key === "terms" ? "the terms of service" : "the privacy notice";
    if (!doc.version) {
      return { error: `Give a version for ${label}. Without one this firm counts as unpublished and cannot take a booking at all.` };
    }
    if (doc.version.startsWith("0-")) {
      return {
        error: `A version that starts “0-” is Docket's mark for “not published yet”, and booking stays closed while one is in force. Give ${label} a real version, such as ${new Date().getUTCFullYear()}-01.`,
      };
    }
  }

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Docket is not configured on this host yet." };
  // Read FIRST. Everything below depends on knowing what is already stored, and guessing would
  // destroy the documents this screen does not edit.
  const { value: before, error: beforeError } = await readFirmColumn(supabase, firmId, "policies");
  if (beforeError) {
    return { error: `Nothing was saved: this firm's current policies could not be read, and writing without them would delete the documents this screen does not edit. ${beforeError}` };
  }

  const versionOf = (key: string): string => {
    const doc = before[key];
    return doc && typeof doc === "object" ? String((doc as Json).version ?? "") : "";
  };
  const wasPublished = (v: string) => v !== "" && !v.startsWith("0-");
  const changed: string[] = [];
  if (wasPublished(versionOf("terms")) && versionOf("terms") !== d.terms.version) changed.push("terms of service");
  if (wasPublished(versionOf("privacy")) && versionOf("privacy") !== d.privacy.version) changed.push("privacy notice");
  if (changed.length > 0 && !d.acknowledgeReconsent) {
    return {
      error: `Changing the version of the ${changed.join(" and the ")} locks every client of this firm out of their portal until they accept the new version. Tick the box to confirm you mean to do that.`,
    };
  }

  // Documents this screen does not edit are sent back unchanged so they survive the write. The
  // trigger replaces the whole column, so anything not resent here is gone — and the disclaimer
  // is on three client-facing screens.
  const policies: Json = {};
  for (const key of ["engagement", "cancellation", "disclaimer"]) {
    const doc = before[key];
    if (doc && typeof doc === "object") policies[key] = doc;
  }
  const buildDoc = (doc: PolicyDocInput): Json => {
    const out: Json = { version: doc.version };
    if (doc.title) out.title = doc.title;
    if (doc.text) out.text = doc.text;
    if (doc.url) out.url = doc.url;
    return out;
  };
  policies.terms = buildDoc(d.terms);
  policies.privacy = buildDoc(d.privacy);
  const topVersion = before.version;
  if (typeof topVersion === "string" && topVersion.trim() !== "") policies.version = topVersion;

  const result = await updateFirm(firmId, { policies });
  if (result.error) return result;

  const { value: stored, error: afterError } = await readFirmColumn(supabase, firmId, "policies");
  if (afterError) return { notes: ["Saved, but the policies could not be read back to check what the database kept: " + afterError] };
  refresh();

  const notes: string[] = [];
  for (const key of Object.keys(policies)) {
    if (typeof policies[key] === "object" && !(key in stored)) {
      notes.push(`The database dropped the “${key}” document entirely — firms.policies keeps only privacy, terms, engagement, cancellation and disclaimer.`);
    }
  }
  for (const key of Object.keys(before)) {
    if (typeof before[key] === "object" && !(key in policies)) {
      notes.push(`The “${key}” document that was stored before is gone: the database drops any document it does not know on every write to this column.`);
    }
  }
  const compared: Json = {};
  const storedCompared: Json = {};
  for (const key of ["terms", "privacy"]) {
    compared[key] = policies[key];
    if (key in stored) storedCompared[key] = stored[key];
  }
  notes.push(
    ...diffNotes(compared, storedCompared, {
      "terms.version": "The terms version",
      "terms.title": "The terms title",
      "terms.text": "The terms text",
      "terms.url": "The terms link",
      "privacy.version": "The privacy version",
      "privacy.title": "The privacy title",
      "privacy.text": "The privacy text",
      "privacy.url": "The privacy link",
    }),
  );
  if (changed.length > 0) {
    notes.push(`Every client of this firm must now accept the new ${changed.join(" and ")} before they can use their portal again.`);
  }
  notes.push("Your public terms and privacy pages read this through a sixty-second cache.");
  return { ok: true, notes };
}

// ================================================================ notification templates

/**
 * firms.notification_templates: the firm's own wording for the sentence a client reads, keyed
 * by event. An event with no entry keeps Docket's own copy, which is why an empty object is the
 * normal state. validate_notification_templates() (migration 20) drops any key that is not a
 * lowercase event name, any entry whose text is blank, strips < and >, and cuts a subject at
 * 200 characters and a body at 1,000.
 */
export async function updateNotificationTemplates(firmId: string, input: TemplateInput[]): Promise<SettingsResult> {
  if (!uuid.safeParse(firmId).success) return { error: "That firm could not be read." };

  const schema = z.array(
    z.object({
      event: z.string().trim().regex(/^[a-z][a-z0-9_]{2,60}$/, "That is not an event Docket sends."),
      subject: plain("A subject", 200),
      text: plain("A message", 1000),
    }),
  ).max(60, "That is more events than Docket sends.");
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the wording and try again." };

  const templates: Json = {};
  for (const row of parsed.data) {
    if (row.text.length === 0) continue; // no text means "keep Docket's sentence"
    const entry: Json = { text: row.text };
    if (row.subject) entry.subject = row.subject;
    templates[row.event] = entry;
  }

  const result = await updateFirm(firmId, { notification_templates: templates });
  if (result.error) return result;

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Docket is not configured on this host yet." };
  const { value: stored, error: afterError } = await readFirmColumn(supabase, firmId, "notification_templates");
  if (afterError) return { notes: ["Saved, but the templates could not be read back to check what the database kept: " + afterError] };
  refresh();

  const notes: string[] = [];
  for (const event of Object.keys(templates)) {
    if (!(event in stored)) notes.push(`The database dropped the wording for ${event}.`);
  }
  const labels: Record<string, string> = {};
  for (const event of Object.keys(templates)) {
    labels[`${event}.text`] = `The message for ${event}`;
    labels[`${event}.subject`] = `The subject for ${event}`;
  }
  notes.push(...diffNotes(templates, stored, labels));
  const count = Object.keys(stored).length;
  notes.push(
    count === 0
      ? "Nothing is overridden: every message goes out in Docket's own words."
      : `${count} event${count === 1 ? "" : "s"} now go out in your words. Every other event keeps Docket's.`,
  );
  return { ok: true, notes };
}

// ================================================================ domain

/**
 * A firm cannot write firms.custom_domain — guard_firm_lifecycle_columns() raises 42501 — so it
 * asks. request_firm_domain() (migration 20) validates the hostname, refuses one already in use
 * or already asked for, records who asked, and audits it. Every refusal below is the database's
 * own sentence.
 */
export async function requestDomain(firmId: string, hostname: string, note: string): Promise<SettingsResult> {
  if (!uuid.safeParse(firmId).success) return { error: "That firm could not be read." };
  const clean = (hostname ?? "").trim().toLowerCase();
  if (clean === "") return { error: "Type the hostname you want, for example chambers.example.ng." };

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Docket is not configured on this host yet." };

  const { data, error } = await supabase.rpc("request_firm_domain", {
    p_firm: firmId,
    p_hostname: clean,
    p_note: (note ?? "").trim() || null,
  });
  if (error) return { error: verbatim(error) };

  const result = (data ?? null) as { hostname?: string; status?: string } | null;
  refresh();
  return {
    ok: true,
    notes: [
      `Docket has your request for ${result?.hostname ?? clean}. Nothing changes on your site until Docket maps it.`,
      "Docket will post the DNS records to add at your registrar here when it starts verifying.",
    ],
  };
}

/** Withdraw a request that is still open. Only 'requested' and 'verifying' may be withdrawn. */
export async function withdrawDomainRequest(requestId: string): Promise<SettingsResult> {
  if (!uuid.safeParse(requestId).success) return { error: "That request could not be read." };

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Docket is not configured on this host yet." };

  const { error } = await supabase.rpc("withdraw_firm_domain_request", { p_request: requestId });
  if (error) return { error: verbatim(error) };
  refresh();
  return { ok: true, notes: ["The request is withdrawn. You can ask for another hostname whenever you are ready."] };
}
