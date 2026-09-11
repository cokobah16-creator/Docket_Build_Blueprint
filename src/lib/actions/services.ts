"use server";

// The firm's catalogue and its intake forms — the two writes that decide whether a firm can
// sell anything at all on Docket.
//
// Screens served: /firm/admin/services and /firm/admin/intake in the staff console.
//
// Rules obeyed here:
//  · THE DATABASE IS THE AUTHORIZATION LAYER. Every write below is a plain table write running
//    as the signed-in person. services_write_ins/upd/del and intake_forms_write_ins/upd/del
//    (migration 21, which split the old single "for all" policy) are `admin_w(firm_id)` —
//    owner or admin, MFA session, firm not suspended. There is no RPC for either table and none
//    is needed. Nothing in this file decides who may write.
//    A row that the USING clause of an RLS policy excludes is not an error in Postgres: the
//    statement simply changes nothing. So every update and delete asks PostgREST for the
//    affected-row count, and when it is zero it asks the DATABASE why — admin_w(), mfa_ok() and
//    firm_not_suspended() are asked directly and their answers are reported. The words are the
//    database's, not ours.
//  · Money is integer minor units. The lawyer types a fee the way they would write it on a bill
//    ("25,000", "19.99") and it is turned into kobo or cents exactly ONCE, here, with
//    Math.round(Number((n * 100).toFixed(4))) — 19.99 * 100 is 1998.9999999999998 in binary
//    floating point, and a fee of ₦1,998.99 instead of ₦1,999.00 is a real invoice.
//  · Nothing firm-specific. The firm arrives as an argument from staffContext(); no slug, name
//    or colour is written down anywhere in this file.
//  · An INSERT never uses .select(): the id is generated here with crypto.randomUUID().
//
// The intake schema is validated by hand rather than by zod because every refusal has to name
// the question it is about — "question 3 (client_type): a choice needs at least one option" is
// a sentence a firm administrator can act on; a zod path is not. The column itself has NO
// database validation of any kind, so this is the only place the shape is checked, and it runs
// on the server because a server action is a public endpoint: the browser's own parse is a
// courtesy to the person typing, this is the rule.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import type { IntakeQuestion } from "@/lib/db/types";

// ---------------------------------------------------------------- shared shapes

export interface ActionResult {
  error?: string;
  ok?: true;
  /** A true thing worth saying that is not a failure — e.g. what the fee became in kobo. */
  notice?: string;
}

export interface ServiceSaved extends ActionResult {
  serviceId?: string;
  priceMinor?: number;
}

export interface IntakeSaved extends ActionResult {
  formId?: string;
  /** The schema as it was actually stored, re-printed so the editor shows the truth. */
  storedJson?: string;
  /** Keys and fields that were dropped because the booking wizard does not read them. */
  dropped?: string[];
  questionCount?: number;
}

/** What the services editor sends. The fee is the text the lawyer typed, not a number. */
export interface ServiceInput {
  firmId: string;
  slug: string;
  name: string;
  description: string;
  /** As typed: "25,000", "₦25,000", "19.99". Converted to minor units once, below. */
  priceText: string;
  currency: string;
  durationMin: number;
  lawyerCategory: string;
  requiresPrepayment: boolean;
  virtualAvailable: boolean;
  isActive: boolean;
  sort: number;
}

/** What the intake editor sends. `schemaJson` is the raw text of the textarea. */
export interface IntakeFormInput {
  firmId: string;
  /** null on a new form. */
  formId: string | null;
  /** null means the firm-wide default, used by every service without its own form. */
  serviceId: string | null;
  name: string;
  isActive: boolean;
  schemaJson: string;
}

const uuid = z.string().uuid();

// The largest fee the editor will take. price_minor is a bigint, so the column would hold far
// more; this keeps a mistyped amount ("2500000" meant as ₦25,000.00) inside the range where a
// person still notices, and stays well inside Number.MAX_SAFE_INTEGER.
const MAX_MAJOR = 999_999_999.99;

const serviceSchema = z.object({
  firmId: uuid,
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, { message: "The web address needs at least two characters." })
    .max(60, { message: "Keep the web address to 60 characters or less." })
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
      message:
        "A web address is lowercase letters, digits and single hyphens — for example company-registration. No spaces, no capitals, no punctuation.",
    }),
  name: z
    .string()
    .trim()
    .min(2, { message: "Give the service a name a client would recognise." })
    .max(120, { message: "Keep the name to 120 characters or less." }),
  description: z.string().trim().max(1000, { message: "Keep the description to 1,000 characters or less." }),
  currency: z.enum(["NGN", "USD"], {
    errorMap: () => ({ message: "Docket settles in naira or dollars, so a service is priced in one of the two." }),
  }),
  durationMin: z
    .number()
    .int({ message: "A length is a whole number of minutes." })
    .min(5, { message: "A consultation shorter than five minutes is not a consultation." })
    .max(480, { message: "Eight hours is the longest single consultation the diary will hold." }),
  lawyerCategory: z.string().trim().max(60, { message: "Keep the category to 60 characters or less." }),
  requiresPrepayment: z.boolean(),
  virtualAvailable: z.boolean(),
  isActive: z.boolean(),
  sort: z
    .number()
    .int({ message: "The order is a whole number." })
    .min(0, { message: "The order cannot be negative." })
    .max(999, { message: "Keep the order between 0 and 999." }),
});

/**
 * The fee, as typed, in minor units — kobo or cents.
 *
 * Multiplying by 100 in binary floating point is where money goes wrong (19.99 * 100 is
 * 1998.9999999999998), so the product is fixed to four decimal places before rounding. This
 * happens exactly once, here: nothing in SQL and nothing in the browser multiplies a fee.
 */
function minorFromTyped(raw: string, currency: string): { minor: number } | { error: string } {
  const cleaned = raw
    .trim()
    .replace(/^(NGN|USD)\s*/i, "")
    .replace(/[₦$,\s]/g, "");
  if (cleaned === "") return { error: "Type the fee. A service that is free is priced 0, and says so on the booking page." };
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return {
      error:
        currency === "NGN"
          ? `"${raw.trim()}" is not an amount. Write the fee in naira — 25000, or 25,000, or 25000.50 for kobo.`
          : `"${raw.trim()}" is not an amount. Write the fee in dollars — 250, or 250.99.`,
    };
  }
  const major = Number(cleaned);
  if (!Number.isFinite(major)) return { error: `"${raw.trim()}" is not an amount.` };
  if (major > MAX_MAJOR) {
    return { error: `That fee is larger than ${MAX_MAJOR.toLocaleString("en-NG")}. Check the figure — a fee is per consultation, not per matter.` };
  }
  return { minor: Math.round(Number((major * 100).toFixed(4))) };
}

/** "2,500,000 kobo" / "1,999 cents" — the figure the database will actually hold. */
function minorLabel(minor: number, currency: string): string {
  return `${minor.toLocaleString("en-NG")} ${currency === "NGN" ? "kobo" : "cents"}`;
}

function refresh(): void {
  revalidatePath("/firm/admin/services");
  revalidatePath("/firm/admin/intake");
  // The availability screen previews what a client would be offered, and it can only preview a
  // service that is active.
  revalidatePath("/firm/availability");
  revalidatePath("/firm");
}

/**
 * Why a write changed nothing — asked of the database, not decided here.
 *
 * Under RLS an UPDATE or DELETE whose USING clause excludes the row affects zero rows and
 * raises nothing at all. That silence is the refusal, and it has three possible reasons inside
 * admin_w(): role, MFA, suspension. Each is a function the caller may ask directly, so this
 * asks all three and repeats the answers.
 */
async function whyNothingChanged(
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
  firmId: string,
  what: string,
): Promise<string> {
  if (!supabase) return "Not configured.";
  const [allowed, mfa, notSuspended] = await Promise.all([
    supabase.rpc("admin_w", { f: firmId }),
    supabase.rpc("mfa_ok"),
    supabase.rpc("firm_not_suspended", { f: firmId }),
  ]);
  if (allowed.error) {
    return `Nothing was changed, and the database could not say why: ${allowed.error.message}. Reload the page and try again.`;
  }
  if (allowed.data === true) {
    return `The database allows you to write here — admin_w() is true — but no ${what} matched. It was probably deleted or changed by a colleague since this page loaded. Reload and try again.`;
  }
  const reasons: string[] = [];
  if (mfa.data === false) {
    reasons.push("this session is not MFA-verified — mfa_ok() is false, so sign in again with your authenticator");
  }
  if (notSuspended.data === false) {
    reasons.push("this firm is suspended, and every write on a suspended firm is refused until Docket lifts it");
  }
  if (mfa.data === true && notSuspended.data === true) {
    reasons.push("this account is not an owner or admin of this firm");
  }
  if (reasons.length === 0) {
    // Neither of the two questions came back with an answer, so the third — role — cannot be
    // pinned down either. Say that rather than name a reason that may not be the reason.
    reasons.push("the database did not say which of role, MFA or suspension it was");
  }
  return `The database refused it: admin_w() is false for this firm — ${reasons.join("; ")}. Nothing was changed.`;
}

/** A PostgREST error, word for word, with the detail line the database attached to it. */
function verbatim(error: { message: string; details?: string | null; hint?: string | null }): string {
  return [error.message, error.details ?? "", error.hint ?? ""].map((s) => (s ?? "").trim()).filter(Boolean).join(" — ");
}

// ================================================================ services

/**
 * Add a service to the catalogue.
 *
 * A new service is what makes a firm sellable: seed_firm_defaults() leaves exactly one row,
 * inactive and unpriced, and until an owner or admin prices and activates something the booking
 * wizard has nothing to offer at all.
 */
export async function createService(input: ServiceInput): Promise<ServiceSaved> {
  const parsed = serviceSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the service and try again." };
  const d = parsed.data;

  const price = minorFromTyped(input.priceText, d.currency);
  if ("error" in price) return { error: price.error };

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  // No RETURNING: the id is ours to make, and an insert that reads back through the select
  // policy is the one pattern this codebase does not use.
  const id = crypto.randomUUID();
  const { error } = await supabase.from("services").insert({
    id,
    firm_id: d.firmId,
    slug: d.slug,
    name: d.name,
    description: d.description || null,
    price_minor: price.minor,
    currency: d.currency,
    duration_min: d.durationMin,
    lawyer_category: d.lawyerCategory || null,
    requires_prepayment: d.requiresPrepayment,
    virtual_available: d.virtualAvailable,
    is_active: d.isActive,
    sort: d.sort,
  });

  if (error) {
    if (error.code === "23505") {
      const { data: clash } = await supabase
        .from("services")
        .select("name, is_active")
        .eq("firm_id", d.firmId)
        .eq("slug", d.slug)
        .maybeSingle();
      const existing = clash as { name: string; is_active: boolean } | null;
      const which = existing
        ? ` That web address already belongs to "${existing.name}"${existing.is_active ? "" : ", which is switched off"} — open it below and edit it instead of adding a second one.`
        : "";
      return { error: `${verbatim(error)}.${which}` };
    }
    return { error: verbatim(error) };
  }

  refresh();
  return {
    ok: true,
    serviceId: id,
    priceMinor: price.minor,
    notice: `Saved. The fee is stored as ${minorLabel(price.minor, d.currency)}.`,
  };
}

/** Change a service that is already in the catalogue. */
export async function updateService(serviceId: string, input: ServiceInput): Promise<ServiceSaved> {
  if (!uuid.safeParse(serviceId).success) return { error: "That service could not be read." };
  const parsed = serviceSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the service and try again." };
  const d = parsed.data;

  const price = minorFromTyped(input.priceText, d.currency);
  if ("error" in price) return { error: price.error };

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  const { error, count } = await supabase
    .from("services")
    .update(
      {
        slug: d.slug,
        name: d.name,
        description: d.description || null,
        price_minor: price.minor,
        currency: d.currency,
        duration_min: d.durationMin,
        lawyer_category: d.lawyerCategory || null,
        requires_prepayment: d.requiresPrepayment,
        virtual_available: d.virtualAvailable,
        is_active: d.isActive,
        sort: d.sort,
      },
      { count: "exact" },
    )
    .eq("id", serviceId)
    .eq("firm_id", d.firmId);

  if (error) {
    if (error.code === "23505") {
      return { error: `${verbatim(error)}. Another service in this firm already uses the web address "${d.slug}".` };
    }
    return { error: verbatim(error) };
  }
  if (count === 0) return { error: await whyNothingChanged(supabase, d.firmId, "service") };

  refresh();
  return {
    ok: true,
    serviceId,
    priceMinor: price.minor,
    notice: `Saved. The fee is stored as ${minorLabel(price.minor, d.currency)}.`,
  };
}

/**
 * Switch a service on or off. Off is not a soft delete: an inactive service is invisible to the
 * booking wizard (services_select is `is_active or is_firm_member`) and book_appointment refuses
 * it outright with "service unavailable", while every consultation already booked on it stands.
 */
export async function setServiceActive(firmId: string, serviceId: string, isActive: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(firmId).success || !uuid.safeParse(serviceId).success) {
    return { error: "That service could not be read." };
  }
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  const { error, count } = await supabase
    .from("services")
    .update({ is_active: isActive }, { count: "exact" })
    .eq("id", serviceId)
    .eq("firm_id", firmId);

  if (error) return { error: verbatim(error) };
  if (count === 0) return { error: await whyNothingChanged(supabase, firmId, "service") };

  refresh();
  return {
    ok: true,
    notice: isActive
      ? "Switched on. It is now offered on the booking page."
      : "Switched off. Clients can no longer book it; consultations already in the diary are unaffected.",
  };
}

/**
 * Remove a service from the catalogue for good.
 *
 * appointments.service_id references services with no ON DELETE clause, so the database refuses
 * to delete a service that anybody has ever booked. That refusal is shown word for word.
 *
 * intake_forms.service_id is ON DELETE SET NULL, which is a quieter trap: deleting a service
 * would turn its intake form into the firm-wide default and start asking every client of the
 * firm those questions. That is not something to discover afterwards, so it is stopped here and
 * the form is named. This is not an authorization rule — the database would allow it — it is a
 * consequence the person deleting has to see first.
 */
export async function deleteService(firmId: string, serviceId: string): Promise<ActionResult> {
  if (!uuid.safeParse(firmId).success || !uuid.safeParse(serviceId).success) {
    return { error: "That service could not be read." };
  }
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  const { data: formRows } = await supabase
    .from("intake_forms")
    .select("id, name")
    .eq("firm_id", firmId)
    .eq("service_id", serviceId);
  const forms = (formRows ?? []) as Array<{ id: string; name: string | null }>;
  if (forms.length > 0) {
    const names = forms.map((f) => `"${f.name?.trim() || "Untitled form"}"`).join(", ");
    return {
      error:
        `${names} ${forms.length === 1 ? "is" : "are"} attached to this service. Deleting the service would leave ` +
        `${forms.length === 1 ? "that form" : "those forms"} attached to nothing, which makes ${forms.length === 1 ? "it" : "them"} ` +
        `the firm-wide form asked of every client. Change or delete the form on the intake screen first.`,
    };
  }

  const { error, count } = await supabase
    .from("services")
    .delete({ count: "exact" })
    .eq("id", serviceId)
    .eq("firm_id", firmId);

  if (error) {
    if (error.code === "23503") {
      return {
        error: `${verbatim(error)}. Consultations have been booked on this service, so it cannot be deleted. Switch it off instead — it stops being bookable and the diary keeps its history.`,
      };
    }
    return { error: verbatim(error) };
  }
  if (count === 0) return { error: await whyNothingChanged(supabase, firmId, "service") };

  refresh();
  return { ok: true, notice: "Deleted." };
}

// ================================================================ intake forms

const KEY_RE = /^[a-z][a-z0-9_]*$/;
const TYPES = ["text", "longtext", "choice", "file"] as const;
const MAX_QUESTIONS = 40;
const MAX_OPTIONS = 30;

/** Fields the booking wizard reads. Anything else in a question is dropped, and said out loud. */
const KNOWN_FIELDS = [
  "key",
  "type",
  "label",
  "options",
  "required",
  "multiple",
  "max_files",
  "max_length",
  "help",
  "show_if",
];

interface SchemaCheck {
  questions: IntakeQuestion[];
  dropped: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Check and normalise a schema against the contract the booking wizard already assumes
 * (src/lib/db/types.ts and app/(public)/[firm]/book/booking-wizard.tsx).
 *
 * Returns the questions exactly as they will be stored, plus a list of everything that was
 * dropped, or a message naming the question that is wrong. Every message says which question.
 */
function checkSchema(parsed: unknown): SchemaCheck | { error: string } {
  if (!isRecord(parsed)) {
    return { error: 'The schema is an object with a questions list: {"questions": []}.' };
  }
  const dropped: string[] = [];
  for (const key of Object.keys(parsed)) {
    if (key !== "questions") dropped.push(`the top-level "${key}"`);
  }
  const raw = parsed.questions;
  if (!Array.isArray(raw)) {
    return { error: '"questions" has to be a list, even an empty one: {"questions": []}.' };
  }
  if (raw.length > MAX_QUESTIONS) {
    return { error: `${raw.length} questions is more than a client will answer. Keep it to ${MAX_QUESTIONS} or fewer.` };
  }

  const questions: IntakeQuestion[] = [];
  const seen = new Map<string, number>();

  for (let i = 0; i < raw.length; i += 1) {
    const at = `Question ${i + 1}`;
    const q = raw[i];
    if (!isRecord(q)) return { error: `${at} is not an object. Each question is {"key": …, "type": …, "label": …}.` };

    const key = typeof q.key === "string" ? q.key.trim() : "";
    const where = key ? `${at} (${key})` : at;
    if (!key) return { error: `${at} has no key. A key is the short name your colleagues see above the answer, such as client_type.` };
    if (!KEY_RE.test(key)) {
      return {
        error: `${where}: a key starts with a lowercase letter and holds only lowercase letters, digits and underscores. "${key}" does not.`,
      };
    }
    if (key.length > 40) return { error: `${where}: that key is longer than 40 characters.` };
    if (seen.has(key)) {
      return { error: `${where}: question ${(seen.get(key) ?? 0) + 1} already uses the key "${key}". An answer is stored under its key, so two questions with one key overwrite each other.` };
    }

    const type = typeof q.type === "string" ? q.type.trim() : "";
    if (!(TYPES as readonly string[]).includes(type)) {
      return { error: `${where}: the type is one of text, longtext, choice or file. "${type || "nothing"}" is not.` };
    }

    const label = typeof q.label === "string" ? q.label.trim() : "";
    if (!label) return { error: `${where}: give it a label — the question the client actually reads.` };
    if (label.length > 300) return { error: `${where}: that label is longer than 300 characters. Put the detail in "help".` };

    const out: IntakeQuestion = { key, type: type as IntakeQuestion["type"], label };

    if (typeof q.help === "string" && q.help.trim()) out.help = q.help.trim().slice(0, 300);
    if (q.required === true) out.required = true;

    if (type === "choice") {
      const options = Array.isArray(q.options) ? q.options.map((o) => (typeof o === "string" ? o.trim() : "")) : null;
      if (!options || options.length === 0) {
        return { error: `${where}: a choice needs at least one option, or the client is shown an empty list.` };
      }
      if (options.some((o) => !o)) return { error: `${where}: one of the options is blank.` };
      if (options.length > MAX_OPTIONS) return { error: `${where}: ${options.length} options is more than a phone screen can hold. Keep it to ${MAX_OPTIONS}.` };
      if (new Set(options).size !== options.length) return { error: `${where}: two options are the same word.` };
      out.options = options;
      if (q.multiple === true) out.multiple = true;
    } else if (Array.isArray(q.options)) {
      dropped.push(`"options" on ${key} (only a choice uses options)`);
    }

    if (type === "file") {
      const max = typeof q.max_files === "number" ? Math.floor(q.max_files) : 1;
      if (!Number.isFinite(max) || max < 1 || max > 10) {
        return { error: `${where}: max_files is between 1 and 10. The wizard uploads that many and no more.` };
      }
      out.max_files = max;
      if (q.required === true) {
        // The wizard's own "can I go on" check skips file questions entirely, so a required file
        // question does not in fact stop anybody. Saying so beats a promise the screen breaks.
        dropped.push(`"required" on ${key} (the booking wizard never blocks on a file, so it would promise something it does not do)`);
        delete out.required;
      }
    } else if (typeof q.max_files === "number") {
      dropped.push(`"max_files" on ${key} (only a file question uploads anything)`);
    }

    if (type === "longtext") {
      if (typeof q.max_length === "number") {
        const max = Math.floor(q.max_length);
        if (!Number.isFinite(max) || max < 20 || max > 10_000) {
          return { error: `${where}: max_length is between 20 and 10,000 characters.` };
        }
        out.max_length = max;
      }
    } else if (typeof q.max_length === "number") {
      dropped.push(`"max_length" on ${key} (only a long answer box is capped)`);
    }

    if (q.show_if !== undefined) {
      if (!isRecord(q.show_if)) {
        return { error: `${where}: show_if is an object — {"question": "an_earlier_key", "equals": "an option"}.` };
      }
      const on = typeof q.show_if.question === "string" ? q.show_if.question.trim() : "";
      const equals = typeof q.show_if.equals === "string" ? q.show_if.equals.trim() : "";
      if (!on || !equals) return { error: `${where}: show_if needs both "question" and "equals".` };
      if (on === key) return { error: `${where}: show_if points at itself, so it could never appear.` };
      if (!seen.has(on)) {
        return {
          error: `${where}: show_if points at "${on}", which is not asked before it. A question can only depend on one above it — the client answers in order, so a later or missing key means it never appears.`,
        };
      }
      const parent = questions[seen.get(on) ?? -1];
      if (parent && parent.type === "file") {
        return { error: `${where}: show_if points at "${on}", which is a file question. A file has no answer to compare, so this question would never appear.` };
      }
      if (parent && parent.type === "choice" && parent.options && !parent.options.includes(equals)) {
        return {
          error: `${where}: show_if waits for "${on}" to equal "${equals}", but "${on}" only offers ${parent.options.map((o) => `"${o}"`).join(", ")}. It would never appear.`,
        };
      }
      out.show_if = { question: on, equals };
    }

    for (const field of Object.keys(q)) {
      if (!KNOWN_FIELDS.includes(field)) dropped.push(`"${field}" on ${key}`);
    }

    seen.set(key, i);
    questions.push(out);
  }

  return { questions, dropped };
}

/**
 * Save one intake form — the questions asked between picking a slot and paying.
 *
 * A form with service_id null is the firm-wide default; one with a service_id overrides it for
 * that service. The booking wizard picks the override first and falls back to the default
 * (booking-wizard.tsx), so two ACTIVE forms aimed at the same thing means one of them is
 * silently ignored — the wizard takes whichever row the database returns first. That is refused
 * here with the name of the form already in the way.
 *
 * intake_forms.service_id is not covered by check_row_firm(), so the database would happily
 * store another firm's service id. The service is looked up inside this firm before saving.
 */
export async function saveIntakeForm(input: IntakeFormInput): Promise<IntakeSaved> {
  if (!uuid.safeParse(input.firmId).success) return { error: "That firm could not be read." };
  if (input.formId !== null && !uuid.safeParse(input.formId).success) return { error: "That form could not be read." };
  if (input.serviceId !== null && !uuid.safeParse(input.serviceId).success) return { error: "That service could not be read." };

  const name = input.name.trim();
  if (name.length > 120) return { error: "Keep the form's name to 120 characters or less." };

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(input.schemaJson);
  } catch (err) {
    return { error: `The questions are not valid JSON: ${err instanceof Error ? err.message : "unreadable"}.` };
  }
  const checked = checkSchema(parsedJson);
  if ("error" in checked) return { error: checked.error };

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  if (input.serviceId) {
    const { data: svc } = await supabase
      .from("services")
      .select("id, name")
      .eq("id", input.serviceId)
      .eq("firm_id", input.firmId)
      .maybeSingle();
    if (!svc) {
      return { error: "That service does not belong to this firm, so a form cannot be attached to it." };
    }
  }

  // Only one ACTIVE form may aim at the same target, because the wizard reads the first one it
  // finds and the other would never be asked.
  if (input.isActive) {
    let q = supabase.from("intake_forms").select("id, name").eq("firm_id", input.firmId).eq("is_active", true);
    q = input.serviceId ? q.eq("service_id", input.serviceId) : q.is("service_id", null);
    const { data: rivals } = await q;
    const clash = ((rivals ?? []) as Array<{ id: string; name: string | null }>).find((r) => r.id !== input.formId);
    if (clash) {
      return {
        error:
          `"${clash.name?.trim() || "Untitled form"}" is already the live form for ${input.serviceId ? "this service" : "every service without its own form"}. ` +
          `The booking wizard uses the first one it finds, so a second live form would never be asked. Switch that one off, or edit it instead.`,
      };
    }
  }

  const schema = { questions: checked.questions };
  const storedJson = JSON.stringify(schema, null, 2);
  const row = {
    firm_id: input.firmId,
    service_id: input.serviceId,
    name: name || null,
    schema,
    is_active: input.isActive,
  };

  if (input.formId === null) {
    const id = crypto.randomUUID();
    const { error } = await supabase.from("intake_forms").insert({ id, ...row });
    if (error) return { error: verbatim(error) };
    refresh();
    return {
      ok: true,
      formId: id,
      storedJson,
      dropped: checked.dropped,
      questionCount: checked.questions.length,
      notice: `Saved ${checked.questions.length} question${checked.questions.length === 1 ? "" : "s"}.`,
    };
  }

  const { error, count } = await supabase
    .from("intake_forms")
    .update(row, { count: "exact" })
    .eq("id", input.formId)
    .eq("firm_id", input.firmId);
  if (error) return { error: verbatim(error) };
  if (count === 0) return { error: await whyNothingChanged(supabase, input.firmId, "form") };

  refresh();
  return {
    ok: true,
    formId: input.formId,
    storedJson,
    dropped: checked.dropped,
    questionCount: checked.questions.length,
    notice: `Saved ${checked.questions.length} question${checked.questions.length === 1 ? "" : "s"}.`,
  };
}

/**
 * Delete an intake form.
 *
 * intake_responses.form_id is ON DELETE SET NULL, so the answers clients have already given
 * stay exactly where they are, on their consultations. Only the questions go.
 */
export async function deleteIntakeForm(firmId: string, formId: string): Promise<ActionResult> {
  if (!uuid.safeParse(firmId).success || !uuid.safeParse(formId).success) {
    return { error: "That form could not be read." };
  }
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  const { error, count } = await supabase
    .from("intake_forms")
    .delete({ count: "exact" })
    .eq("id", formId)
    .eq("firm_id", firmId);

  if (error) return { error: verbatim(error) };
  if (count === 0) return { error: await whyNothingChanged(supabase, firmId, "form") };

  refresh();
  return { ok: true, notice: "Deleted. Answers clients have already given stay on their consultations." };
}
