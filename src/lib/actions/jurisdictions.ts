"use server";

// The jurisdiction registry (migration 61): every write the platform console makes to it.
//
// Every rule is the database's. set_jurisdiction_status() and upsert_jurisdiction() each ask
// is_platform_admin() and mfa_ok() for themselves, refuse a jump from designed to active, refuse a
// validation with no note, refuse a timezone the server does not know and a currency the invoices
// table cannot hold. The zod schemas below stop a malformed value reaching Postgres as a type error
// instead of as a sentence, and the database's own words come back unchanged.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";

export interface JurisdictionWriteState {
  error?: string;
  done?: string;
  fieldErrors?: Record<string, string>;
}

const NOT_CONFIGURED = "Supabase is not configured on this deployment, so nothing can be saved.";
const CODE = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "A jurisdiction code is the two letter ISO 3166 country code.");

function firstIssue(error: z.ZodError): JurisdictionWriteState {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return { error: "Please check the highlighted fields.", fieldErrors };
}

function refresh(): void {
  revalidatePath("/admin/jurisdictions");
  revalidatePath("/firm/start");
}

/** designed -> validated (with a note), validated -> active, active -> suspended, and back. */
export async function setJurisdictionStatus(_prev: JurisdictionWriteState, formData: FormData): Promise<JurisdictionWriteState> {
  const parsed = z
    .object({
      code: CODE,
      status: z.enum(["designed", "validated", "active", "suspended"], { errorMap: () => ({ message: "Choose a status." }) }),
      note: z.string().trim().max(4000).optional(),
    })
    .safeParse({
      code: formData.get("code"),
      status: formData.get("status"),
      note: String(formData.get("note") ?? "").trim() || undefined,
    });
  if (!parsed.success) return firstIssue(parsed.error);

  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };
  const { error } = await supabase.rpc("set_jurisdiction_status", {
    p_code: parsed.data.code,
    p_status: parsed.data.status,
    p_note: parsed.data.note ?? null,
  });
  if (error) return { error: error.message };
  refresh();
  const said: Record<string, string> = {
    validated: "recorded as validated. It can be activated now.",
    active: "active. Firms can register under it from this moment.",
    suspended: "suspended. Firms already under it keep working; nobody new can register.",
    designed: "back to designed, with its validation cleared.",
  };
  return { done: `${parsed.data.code} is ${said[parsed.data.status]}` };
}

/** Register a country as designed, or correct how one is described. Never touches its status. */
export async function registerJurisdiction(_prev: JurisdictionWriteState, formData: FormData): Promise<JurisdictionWriteState> {
  const parsed = z
    .object({
      code: CODE,
      name: z.string().trim().min(2, "Name the country.").max(120),
      legalSystem: z.enum(["common_law", "civil_law", "mixed", "religious_mixed"], { errorMap: () => ({ message: "Choose a legal system." }) }),
      currencyCode: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "A currency is its three letter ISO 4217 code."),
      timezone: z.string().trim().min(3, "Give an IANA timezone, such as Europe/London.").max(64),
      locale: z.string().trim().regex(/^[a-z]{2}(-[A-Z]{2})?$/, "A locale is en or en-GB.").default("en"),
      language: z.string().trim().min(2).max(60).default("English"),
      dateFormat: z.enum(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]).default("DD/MM/YYYY"),
      validationScope: z.string().trim().max(2000).optional(),
      sort: z.coerce.number().int().min(1).max(1000).default(100),
    })
    .safeParse({
      code: formData.get("code"),
      name: formData.get("name"),
      legalSystem: formData.get("legalSystem"),
      currencyCode: formData.get("currencyCode"),
      timezone: formData.get("timezone"),
      locale: String(formData.get("locale") ?? "").trim() || "en",
      language: String(formData.get("language") ?? "").trim() || "English",
      dateFormat: String(formData.get("dateFormat") ?? "").trim() || "DD/MM/YYYY",
      validationScope: String(formData.get("validationScope") ?? "").trim() || undefined,
      sort: String(formData.get("sort") ?? "").trim() || "100",
    });
  if (!parsed.success) return firstIssue(parsed.error);
  const d = parsed.data;

  const supabase = await supabaseServer();
  if (!supabase) return { error: NOT_CONFIGURED };
  const { data, error } = await supabase.rpc("upsert_jurisdiction", {
    p_code: d.code,
    p_name: d.name,
    p_legal_system: d.legalSystem,
    p_currency_code: d.currencyCode,
    p_timezone: d.timezone,
    p_locale: d.locale,
    p_language: d.language,
    p_date_format: d.dateFormat,
    p_config: d.validationScope ? { validation_scope: d.validationScope } : {},
    p_sort: d.sort,
  });
  if (error) return { error: error.message };
  refresh();
  const created = (data as { created?: boolean } | null)?.created;
  return {
    done: created
      ? `${d.name} is registered as designed. Nobody can register a firm under it until it is validated and activated.`
      : `${d.name} is described again. Its status is unchanged.`,
  };
}
