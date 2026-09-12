"use server";

// The platform's reference data: court vacations, public holidays and the shared court
// directory. Screen served: /admin/reference.
//
// WHY THIS FILE EXISTS AT ALL. is_non_sitting_day() (migration 12) is the check that warns a
// lawyer before a court date is fixed on a day the court does not sit, and post_court_update()
// refuses such a date unless the lawyer deliberately overrides it. It reads three things: the
// weekend, public_holidays and court_vacations. court_vacations is EMPTY in every environment,
// so today that check only ever refuses weekends and holidays. Typing a vacation in here is
// literally what switches the rest of it on. Nothing is seeded and nothing is guessed: a
// vacation window comes from a court's own practice direction, and a movable feast comes from
// the Federal Government's gazette.
//
// Rules obeyed here:
//  · THE DATABASE IS THE AUTHORIZATION LAYER. Every write below is a plain table write running
//    as the signed-in person. courts_platform_write_ins/upd/del,
//    court_vacations_platform_write_ins/upd/del and public_holidays_platform_write_ins/upd/del
//    (migration 21, which split the old single "for all" policies) all read
//    is_platform_admin() and mfa_ok(). There is no RPC for these three tables and none is
//    needed. Nothing in this file decides who may write, and the service role is never used.
//    A row the USING clause of an RLS policy excludes is not an error in Postgres: the
//    statement simply changes nothing. So every update and delete asks PostgREST for the
//    affected-row count and, when it is zero, asks the DATABASE why — is_platform_admin() and
//    mfa_ok() are both callable by the caller, and their answers are repeated unedited.
//  · An INSERT never uses .select(): courts_select reads the same table, which would refuse the
//    returning clause. Ids are generated here with crypto.randomUUID().
//  · A DATE column is a calendar day. starts_on, ends_on, on_date and observed_on are sent as
//    plain YYYY-MM-DD strings and never converted through a Date, so nothing can shift by a day.
//  · Nothing here is specific to one tenant. Platform reference data has firm_id null by
//    definition — a firm's own private court is written by the staff console under staff_w().
//
// The zod schemas below check SHAPE, never permission: they exist so a malformed value reaches
// Postgres as a sentence a person can act on rather than as a type error.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { COURT_LEVEL_LABELS, NG_STATES } from "@/lib/nigeria";

/** What every write on this screen returns: a refusal, or a success with something true to say. */
export interface ReferenceResult {
  error?: string;
  ok?: true;
  /** A true thing worth saying that is not a failure — what the saved row now does. */
  notice?: string;
}

export interface CourtVacationInput {
  /** Present when an existing window is being corrected. */
  id?: string | null;
  /** A court_level value, or "" for every court. */
  level: string;
  /** An ISO 3166-2:NG code, or "" for every state. */
  stateCode: string;
  name: string;
  startsOn: string;
  endsOn: string;
  timeRuns: boolean;
  note: string;
}

export interface PublicHolidayInput {
  country: string;
  onDate: string;
  name: string;
  /** An ISO 3166-2:NG code, or "" for a national holiday. */
  stateCode: string;
  /** The day it was actually kept, when the Federal Government shifted it. "" for none. */
  observedOn: string;
  /** True for Eid and Easter — the same feast falls on a different date next year. */
  isMovable: boolean;
}

export interface PlatformCourtInput {
  id?: string | null;
  name: string;
  level: string;
  stateCode: string;
  division: string;
  city: string;
  shortName: string;
  isActive: boolean;
}

type Sb = NonNullable<Awaited<ReturnType<typeof supabaseServer>>>;

const COURT_LEVELS = Object.keys(COURT_LEVEL_LABELS);
const STATE_CODES = Object.keys(NG_STATES);

const uuid = z.string().uuid({ message: "That row could not be identified. Reload the page and try again." });

const day = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "A date is written 2026-07-20 — year, month, day." });

const levelField = z
  .string()
  .trim()
  .refine((v) => v === "" || COURT_LEVELS.includes(v), { message: "That is not a court level Docket knows." });

const stateField = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => v === "" || STATE_CODES.includes(v), { message: "That is not a Nigerian state code." });

const vacationSchema = z.object({
  id: uuid.nullish(),
  level: levelField,
  stateCode: stateField,
  name: z
    .string()
    .trim()
    .min(3, { message: "Name the window as the practice direction names it — Annual Vacation, Christmas Vacation." })
    .max(120, { message: "Keep the name to 120 characters or less." }),
  startsOn: day,
  endsOn: day,
  timeRuns: z.boolean(),
  note: z.string().trim().max(1000, { message: "Keep the note to 1,000 characters or less." }),
});

const holidaySchema = z.object({
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, { message: "A country is its two-letter code — NG for Nigeria." }),
  onDate: day,
  name: z
    .string()
    .trim()
    .min(3, { message: "Name the holiday as the gazette names it." })
    .max(120, { message: "Keep the name to 120 characters or less." }),
  stateCode: stateField,
  observedOn: z.union([day, z.literal("")]),
  isMovable: z.boolean(),
});

const courtSchema = z.object({
  id: uuid.nullish(),
  name: z
    .string()
    .trim()
    .min(4, { message: "Give the court its full name, as the registry writes it." })
    .max(200, { message: "Keep the name to 200 characters or less." }),
  level: z.string().trim().refine((v) => COURT_LEVELS.includes(v), {
    message: "Choose where this court sits in the hierarchy.",
  }),
  stateCode: stateField,
  division: z.string().trim().max(120, { message: "Keep the division to 120 characters or less." }),
  city: z.string().trim().max(120, { message: "Keep the city to 120 characters or less." }),
  shortName: z.string().trim().max(60, { message: "Keep the short name to 60 characters or less." }),
  /** Shown to a lawyer opening a matter: "Suit numbers at this court read like …". */
  suitNumberHint: z.string().trim().max(80, { message: "Keep the suit-number example to 80 characters or less." }),
  isActive: z.boolean(),
});

function refresh(): void {
  revalidatePath("/admin/reference");
}

/** "" becomes null: a blank state means every state, not a state whose code is empty. */
function orNull(value: string): string | null {
  return value === "" ? null : value;
}

/**
 * Why a write changed nothing — asked of the database, not decided here.
 *
 * Under RLS an UPDATE or DELETE whose USING clause excludes the row affects zero rows and
 * raises nothing at all. That silence is the refusal, and on these three tables it has exactly
 * two possible reasons: not a platform admin, or a session that has not done its second step.
 * Both are functions the caller may ask directly, so both are asked and both answers repeated.
 */
async function whyNothingChanged(supabase: Sb, what: string): Promise<string> {
  const [admin, mfa] = await Promise.all([supabase.rpc("is_platform_admin"), supabase.rpc("mfa_ok")]);
  if (admin.error) {
    return `Nothing was changed, and the database could not say why: ${admin.error.message}. Reload the page and try again.`;
  }
  if (admin.data !== true) {
    return (
      "Nothing was changed: this account is not a Docket platform administrator, so the shared " +
      "reference data is not yours to write. Platform admins are added directly in the database."
    );
  }
  if (mfa.data !== true) {
    return (
      "Nothing was changed: this session has not completed its second step, and the write policy " +
      "on this table reads mfa_ok(). Finish it at /firm/security/mfa and try again."
    );
  }
  return `Nothing was changed. That ${what} may already have been removed by somebody else — reload the page.`;
}

/** "the Federal High Court in Lagos", "every court in every state" — what a window actually covers. */
function coverageLabel(level: string | null, stateCode: string | null): string {
  const court = level ? (COURT_LEVEL_LABELS[level] ?? level) : "every court";
  const where = stateCode ? `in ${NG_STATES[stateCode] ?? stateCode}` : "in every state";
  return `${court} ${where}`;
}

/** A plain calendar day, written out. Never converted through a local zone. */
function dayLabel(ymd: string): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));
}

// ---------------------------------------------------------------- court vacations

/**
 * Add or correct one vacation window. Every field except the name is optional in the database's
 * sense: a blank level means every court, a blank state means every state, and that breadth is
 * spelled out in the notice so nobody widens a Lagos vacation to the whole federation by accident.
 */
export async function saveCourtVacation(input: CourtVacationInput): Promise<ReferenceResult> {
  const parsed = vacationSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const d = parsed.data;
  if (d.endsOn < d.startsOn) {
    return { error: "A vacation ends on or after the day it starts. Check the two dates." };
  }

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  const level = orNull(d.level);
  const stateCode = orNull(d.stateCode);
  const row = {
    level,
    state_code: stateCode,
    name: d.name,
    starts_on: d.startsOn,
    ends_on: d.endsOn,
    time_runs: d.timeRuns,
    note: orNull(d.note),
  };

  if (d.id) {
    const { error, count } = await supabase
      .from("court_vacations")
      .update(row, { count: "exact" })
      .eq("id", d.id);
    if (error) return { error: error.message };
    if (count === 0) return { error: await whyNothingChanged(supabase, "vacation window") };
  } else {
    const { error } = await supabase.from("court_vacations").insert({ id: crypto.randomUUID(), ...row });
    if (error) return { error: error.message };
  }

  refresh();
  return {
    ok: true,
    notice:
      `Saved. Every day from ${dayLabel(d.startsOn)} to ${dayLabel(d.endsOn)} is now a non-sitting day for ` +
      `${coverageLabel(level, stateCode)} — that is the answer a lawyer gets when they try to fix a date inside it.`,
  };
}

/** Remove a window that was entered in error. The dates stop being non-sitting days immediately. */
export async function deleteCourtVacation(id: string): Promise<ReferenceResult> {
  const parsed = uuid.safeParse(id);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "That window could not be identified." };

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  const { error, count } = await supabase.from("court_vacations").delete({ count: "exact" }).eq("id", parsed.data);
  if (error) return { error: error.message };
  if (count === 0) return { error: await whyNothingChanged(supabase, "vacation window") };

  refresh();
  return { ok: true, notice: "Removed. Those days are ordinary sitting days again unless a holiday or a weekend falls in them." };
}

// ---------------------------------------------------------------- public holidays

/**
 * Add a holiday, or correct one already entered.
 *
 * public_holidays is NOT keyed by its id. Its uniqueness is the index on
 * (country, on_date, coalesce(state_code, '')) — migration 12 — so "the same holiday" means the
 * same day in the same country for the same state, and correcting this year's date is a save
 * against that key. PostgREST's on_conflict= can only name plain columns and this index is on
 * an expression, so the key is looked up first and the row is then updated or inserted. The
 * index is still the authority: if two operators race, the second gets Postgres's own duplicate
 * refusal rather than a quietly duplicated holiday.
 *
 * A movable feast is a NEW ROW each year. Eid-el-Fitr 2027 is not a correction of Eid-el-Fitr
 * 2026; it is a different day, gazetted separately.
 */
export async function savePublicHoliday(input: PublicHolidayInput): Promise<ReferenceResult> {
  const parsed = holidaySchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const d = parsed.data;

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  const stateCode = orNull(d.stateCode);
  const row = {
    country: d.country,
    on_date: d.onDate,
    name: d.name,
    state_code: stateCode,
    observed_on: orNull(d.observedOn),
    is_movable: d.isMovable,
  };

  // The key, exactly as the unique index defines it. A null state is "national", which is a
  // different key from any single state's own holiday.
  let lookup = supabase
    .from("public_holidays")
    .select("id, name")
    .eq("country", d.country)
    .eq("on_date", d.onDate);
  lookup = stateCode ? lookup.eq("state_code", stateCode) : lookup.is("state_code", null);
  const { data: existing, error: lookupError } = await lookup.maybeSingle();
  if (lookupError) return { error: lookupError.message };

  const current = existing as { id: string; name: string } | null;
  if (current) {
    const { error, count } = await supabase
      .from("public_holidays")
      .update(row, { count: "exact" })
      .eq("id", current.id);
    if (error) return { error: error.message };
    if (count === 0) return { error: await whyNothingChanged(supabase, "holiday") };
  } else {
    const { error } = await supabase.from("public_holidays").insert({ id: crypto.randomUUID(), ...row });
    if (error) return { error: error.message };
  }

  const where = stateCode ? `in ${NG_STATES[stateCode] ?? stateCode} only` : "everywhere in the country";
  const observed = row.observed_on ? ` It is kept on ${dayLabel(row.observed_on)}, and both days count.` : "";
  const movable = d.isMovable
    ? " It is movable, so next year's date is a new entry rather than a change to this one."
    : "";
  refresh();
  return {
    ok: true,
    notice: current
      ? `${dayLabel(d.onDate)} was already recorded as “${current.name}” and now reads “${d.name}”, ${where}.${observed}${movable}`
      : `Saved. ${dayLabel(d.onDate)} is now a public holiday ${where}, and no court sits on it.${observed}${movable}`,
  };
}

/** Remove a holiday that was entered in error, or that the gazette withdrew. */
export async function deletePublicHoliday(id: string): Promise<ReferenceResult> {
  const parsed = uuid.safeParse(id);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "That holiday could not be identified." };

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  const { error, count } = await supabase.from("public_holidays").delete({ count: "exact" }).eq("id", parsed.data);
  if (error) return { error: error.message };
  if (count === 0) return { error: await whyNothingChanged(supabase, "holiday") };

  refresh();
  return { ok: true, notice: "Removed. That day is an ordinary sitting day again unless it falls on a weekend." };
}

// ---------------------------------------------------------------- the shared court directory

/**
 * Add or correct a court in the directory every firm sees.
 *
 * firm_id must be NULL: courts_platform_write requires it, and a row with a firm_id is that
 * firm's own private court, written from its own console. The name is the natural key
 * (courts_platform_key is unique on name where firm_id is null), so a court entered twice is
 * refused by the database in its own words.
 *
 * There is no delete here on purpose. A matter can point at a court, and court_events carry a
 * court_id; removing the row would silently unhook them. Retiring a court is what `isActive` is
 * for — it drops out of the pickers and stays attached to everything that already used it.
 */
/**
 * Where each level sits in the court picker, matching the ranks migrations 10 and 12 seeded.
 * courtsFor() orders by sort and then by name, so a court with no rank would outrank all of them.
 */
const SORT_BY_LEVEL: Record<string, number> = {
  supreme: 10,
  court_of_appeal: 20,
  federal_high: 30,
  fct_high: 40,
  state_high: 41,
  national_industrial: 50,
  sharia_appeal: 60,
  customary_appeal: 61,
  magistrate: 70,
  district: 71,
  customary: 72,
  area: 73,
  tribunal: 80,
  other: 90,
};

export async function savePlatformCourt(input: PlatformCourtInput): Promise<ReferenceResult> {
  const parsed = courtSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const d = parsed.data;

  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };

  const stateCode = orNull(d.stateCode);
  const row = {
    level: d.level,
    name: d.name,
    short_name: orNull(d.shortName),
    state_code: stateCode,
    division: orNull(d.division),
    city: orNull(d.city),
    suit_number_hint: orNull(d.suitNumberHint),
    is_active: d.isActive,
    // Without this, `sort` defaults to 0 and courtsFor() orders by sort then name — so every
    // court an operator adds would sit at the very top of the picker for EVERY firm on Docket,
    // above the Supreme Court. The seeded directory ranks by level in tens; a court added here
    // takes the rank of its own level, so it lands among its peers.
    sort: SORT_BY_LEVEL[d.level] ?? 90,
  };

  if (d.id) {
    // .is("firm_id", null) is not the rule — courts_platform_write_upd already carries it — but
    // it keeps a mistyped id from reaching a firm's private court and being refused obscurely.
    const { error, count } = await supabase
      .from("courts")
      .update(row, { count: "exact" })
      .eq("id", d.id)
      .is("firm_id", null);
    if (error) return { error: error.message };
    if (count === 0) return { error: await whyNothingChanged(supabase, "court") };
  } else {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("courts").insert({
      id: crypto.randomUUID(),
      firm_id: null,
      created_by: user?.id ?? null,
      ...row,
    });
    if (error) return { error: error.message };
  }

  refresh();
  const level = COURT_LEVEL_LABELS[d.level] ?? d.level;
  return {
    ok: true,
    notice: d.isActive
      ? `Saved. Every firm on Docket can now pick “${d.name}” (${level}) when it opens a matter or posts a sitting.`
      : `Saved, and marked closed. “${d.name}” no longer appears when a firm picks a court, and every matter already pointing at it keeps it.`,
  };
}

// ---------------------------------------------------------------- the rules of court (migration 38)
//
// A rule is what the platform entered from the Rules of Court, with its citation and version and
// the day it came into force; a provision is one period under it — how many days, counted how,
// from which event. Nothing is seeded. The write policies on court_rules and rule_provisions read
// is_platform_admin() and mfa_ok(), exactly as the vacations above; a deadline computed from a
// provision keeps a snapshot of the rule as it read, so correcting a rule here never rewrites a
// deadline already counted.

export interface CourtRuleInput {
  id?: string | null;
  level: string;
  stateCode: string;
  name: string;
  citation: string;
  version: string;
  effectiveFrom: string;
  note: string;
}

export interface RuleProvisionInput {
  id?: string | null;
  ruleId: string;
  key: string;
  label: string;
  citation: string;
  triggerKind: string;
  period: number;
  unit: "days" | "months";
  countMode: "calendar" | "clear" | "working";
  excludesVacation: boolean;
  rollsForward: boolean;
  note: string;
}

const ruleSchema = z.object({
  id: uuid.nullish(),
  level: z.string().max(40),
  stateCode: z.string().max(2),
  name: z.string().trim().min(2, "Give the rules their name.").max(200),
  citation: z.string().trim().max(300),
  version: z.string().trim().min(1, "Give the version — the year, usually.").max(60),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "The day the rules came into force is YYYY-MM-DD."),
  note: z.string().trim().max(1000),
});

const provisionSchema = z.object({
  id: uuid.nullish(),
  ruleId: uuid,
  key: z.string().trim().regex(/^[a-z0-9_]{2,60}$/, "A key is lower-case letters, digits and underscores."),
  label: z.string().trim().min(2, "Say what the period is for.").max(200),
  citation: z.string().trim().max(300),
  triggerKind: z.enum(["judgment_delivered", "ruling_delivered", "order_made", "service_effected", "hearing_held", "filing", "other"]),
  period: z.number().int().min(1).max(3660),
  unit: z.enum(["days", "months"]),
  countMode: z.enum(["calendar", "clear", "working"]),
  excludesVacation: z.boolean(),
  rollsForward: z.boolean(),
  note: z.string().trim().max(1000),
});

export async function saveCourtRule(input: CourtRuleInput): Promise<ReferenceResult> {
  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const d = parsed.data;
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const row = { level: orNull(d.level), state_code: orNull(d.stateCode), name: d.name, citation: orNull(d.citation), version: d.version, effective_from: d.effectiveFrom, note: orNull(d.note) };
  if (d.id) {
    const { error, count } = await supabase.from("court_rules").update(row, { count: "exact" }).eq("id", d.id);
    if (error) return { error: error.message };
    if (count === 0) return { error: await whyNothingChanged(supabase, "rule") };
  } else {
    const { error } = await supabase.from("court_rules").insert({ id: crypto.randomUUID(), ...row });
    if (error) return { error: error.message };
  }
  refresh();
  return { ok: true, notice: `Saved. "${d.name}" (${d.version}) is offered for ${coverageLabel(orNull(d.level), orNull(d.stateCode))} on any event from ${dayLabel(d.effectiveFrom)}; a deadline counted from it keeps this version's wording.` };
}

/** Retire a set of rules from a day: a deadline whose event falls on or after it will not be counted under them. */
export async function retireCourtRule(id: string, retiredOn: string): Promise<ReferenceResult> {
  if (!uuid.safeParse(id).success) return { error: "Unknown rule." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(retiredOn)) return { error: "The day the rules were retired is YYYY-MM-DD." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error, count } = await supabase.from("court_rules").update({ retired_on: retiredOn }, { count: "exact" }).eq("id", id);
  if (error) return { error: error.message };
  if (count === 0) return { error: await whyNothingChanged(supabase, "rule") };
  refresh();
  return { ok: true, notice: `Retired from ${dayLabel(retiredOn)}. Deadlines already counted under it are unchanged.` };
}

export async function saveRuleProvision(input: RuleProvisionInput): Promise<ReferenceResult> {
  const parsed = provisionSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const d = parsed.data;
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const row = {
    rule_id: d.ruleId, key: d.key, label: d.label, citation: orNull(d.citation), trigger_kind: d.triggerKind, period: d.period, unit: d.unit,
    count_mode: d.countMode, excludes_vacation: d.excludesVacation, rolls_forward: d.rollsForward, note: orNull(d.note),
  };
  if (d.id) {
    const { error, count } = await supabase.from("rule_provisions").update(row, { count: "exact" }).eq("id", d.id);
    if (error) return { error: error.message };
    if (count === 0) return { error: await whyNothingChanged(supabase, "provision") };
  } else {
    const { error } = await supabase.from("rule_provisions").insert({ id: crypto.randomUUID(), ...row });
    if (error) return { error: error.message };
  }
  refresh();
  return {
    ok: true,
    notice: `Saved. "${d.label}": ${d.period} ${d.unit === "months" ? "calendar months" : `${d.countMode} days`} from ${d.triggerKind.replace(/_/g, " ")}${d.excludesVacation ? ", time stopped during a vacation" : ""}${d.rollsForward ? ", rolling past a day the court does not sit" : ""}.`,
  };
}

export async function deleteRuleProvision(id: string): Promise<ReferenceResult> {
  if (!uuid.safeParse(id).success) return { error: "Unknown provision." };
  const supabase = await supabaseServer();
  if (!supabase) return { error: "Not configured." };
  const { error, count } = await supabase.from("rule_provisions").delete({ count: "exact" }).eq("id", id);
  if (error) return { error: error.message };
  if (count === 0) return { error: await whyNothingChanged(supabase, "provision") };
  refresh();
  return { ok: true, notice: "Removed. Deadlines already counted under it keep their snapshot of the rule." };
}
