// /admin/reference — the reference data every firm on Docket relies on, and the honest answer
// to "is the non-sitting-day check actually on?".
//
// WHY THIS SCREEN MATTERS. is_non_sitting_day() (migration 12) is what warns a lawyer before a
// court date is fixed on a day the court does not sit, and what post_court_update() consults
// before it accepts a next date. It reads exactly three things:
//
//   the weekend        always true, needs no data
//   public_holidays    seeded with the fixed federal dates for 2026 and 2027 only
//   court_vacations    EMPTY in every environment until somebody types a window in here
//
// So today that check refuses weekends and public holidays and nothing else: a date in the
// middle of the Long Vacation is treated as an ordinary sitting day. reference_data_coverage is
// the view that says how far the data reaches, and it is shown at the top of this page rather
// than buried, because "how far does this reach" is the only question an operator can act on.
//
// Nothing here is seeded, guessed or filled in from memory. A vacation window comes from a
// court's own practice direction; a movable feast comes from the Federal Government's gazette
// once it is declared. The forms are in reference-forms.tsx and every write goes through
// src/lib/actions/reference.ts, where RLS — is_platform_admin() and mfa_ok() — decides.
//
// A DATE column here is a calendar day. Everything is read and rendered as a plain YYYY-MM-DD
// string in UTC, never shifted into anybody's zone.

import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { platformContext } from "@/lib/admin-data";
import { zonedDayRange } from "@/lib/time";
import {
  CourtVacationEditor,
  PlatformCourtEditor,
  PublicHolidayEditor,
  type CourtView,
  type HolidayView,
  type VacationView,
} from "./reference-forms";

export const metadata = { title: "Reference data" };

const VACATION_LIMIT = 200;
const HOLIDAY_LIMIT = 200;
const COURT_LIMIT = 25;

/** Row of reference_data_coverage (migration 12). One row, always. */
interface CoverageRow {
  holidays_through_year: number | null;
  upcoming_vacations: number;
  vacations_through: string | null;
  platform_courts: number;
}

interface VacationRow {
  id: string;
  level: string | null;
  state_code: string | null;
  name: string;
  starts_on: string;
  ends_on: string;
  time_runs: boolean;
  note: string | null;
}

interface HolidayRow {
  id: string;
  country: string;
  on_date: string;
  name: string;
  state_code: string | null;
  observed_on: string | null;
  is_movable: boolean;
}

interface CourtRow {
  id: string;
  name: string;
  level: string;
  state_code: string | null;
  division: string | null;
  city: string | null;
  short_name: string | null;
  suit_number_hint: string | null;
  is_active: boolean;
}

function dayLabel(ymd: string): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${ymd}T00:00:00Z`),
  );
}

export default async function AdminReferencePage({
  searchParams,
}: {
  searchParams: Promise<{ court?: string }>;
}) {
  const sp = await searchParams;
  // Trimmed and length-capped before it reaches an ilike pattern; PostgREST escapes the value
  // itself, and % and _ in a search term are the user's own wildcards, which is fine here.
  const courtSearch = (sp.court ?? "").trim().slice(0, 80);
  const ctx = await platformContext();
  if (!ctx) {
    // The layout has already said which of the four things went wrong; this only stops the page
    // rendering half-authenticated if it is ever reached another way.
    return (
      <Alert kind="error" title="Not available">
        This screen is for Docket platform administrators.
      </Alert>
    );
  }

  const { supabase } = ctx;
  // The year boundary in the operator's own zone, so "this year" means their year.
  const thisYear = Number(zonedDayRange(ctx.timezone).ymd.slice(0, 4));

  const [coverageRes, vacationRes, holidayRes, courtRes] = await Promise.all([
    supabase.from("reference_data_coverage").select("*").maybeSingle(),
    supabase
      .from("court_vacations")
      .select("id, level, state_code, name, starts_on, ends_on, time_runs, note")
      .order("starts_on", { ascending: false })
      .limit(VACATION_LIMIT),
    supabase
      .from("public_holidays")
      .select("id, country, on_date, name, state_code, observed_on, is_movable")
      .gte("on_date", `${thisYear}-01-01`)
      .order("on_date", { ascending: true })
      .limit(HOLIDAY_LIMIT),
    // Migrations 10 and 12 seed roughly 180 platform courts in two transactions, so created_at is
    // identical across most of them and "most recent" is an arbitrary slice. Since marking a court
    // closed is only possible from here — courts_update requires firm_id to be non-null, so no firm
    // can touch a platform row — the whole directory has to be reachable. A name search does that.
    (courtSearch
      ? supabase
          .from("courts")
          .select("id, name, level, state_code, division, city, short_name, suit_number_hint, is_active", { count: "exact" })
          .is("firm_id", null)
          .or(`name.ilike.%${courtSearch}%,short_name.ilike.%${courtSearch}%,division.ilike.%${courtSearch}%,city.ilike.%${courtSearch}%`)
          .order("name", { ascending: true })
          .limit(COURT_LIMIT)
      : supabase
          .from("courts")
          .select("id, name, level, state_code, division, city, short_name, suit_number_hint, is_active", { count: "exact" })
          .is("firm_id", null)
          .order("name", { ascending: true })
          .limit(COURT_LIMIT)),
  ]);

  const coverage = (coverageRes.data ?? null) as CoverageRow | null;
  const vacationRows = (vacationRes.data ?? []) as VacationRow[];
  const holidayRows = (holidayRes.data ?? []) as HolidayRow[];
  const courtRows = (courtRes.data ?? []) as CourtRow[];
  const totalPlatformCourts = Number(courtRes.count ?? courtRows.length);

  const vacations: VacationView[] = vacationRows.map((v) => ({
    id: v.id,
    level: v.level,
    stateCode: v.state_code,
    name: v.name,
    startsOn: v.starts_on,
    endsOn: v.ends_on,
    timeRuns: v.time_runs,
    note: v.note,
  }));

  const holidays: HolidayView[] = holidayRows.map((h) => ({
    id: h.id,
    country: h.country,
    onDate: h.on_date,
    name: h.name,
    stateCode: h.state_code,
    observedOn: h.observed_on,
    isMovable: h.is_movable,
  }));

  const courts: CourtView[] = courtRows.map((c) => ({
    id: c.id,
    name: c.name,
    level: c.level,
    stateCode: c.state_code,
    division: c.division,
    city: c.city,
    shortName: c.short_name,
    suitNumberHint: c.suit_number_hint,
    isActive: c.is_active,
  }));

  const holidaysThrough = coverage?.holidays_through_year ?? null;
  const upcomingVacations = Number(coverage?.upcoming_vacations ?? 0);
  const vacationsThrough = coverage?.vacations_through ?? null;
  const activeCourts = Number(coverage?.platform_courts ?? 0);

  const holidaysReachEnough = holidaysThrough !== null && holidaysThrough >= thisYear;
  const vacationsOn = upcomingVacations > 0;

  const readError = coverageRes.error ?? vacationRes.error ?? holidayRes.error ?? courtRes.error;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold text-brand">Reference data</h1>
        <p className="text-sm text-gray-600">
          The court calendar and the court directory, maintained by the platform for every firm on
          Docket.
        </p>
      </header>

      {readError && (
        <Alert kind="error" title="Some of this could not be read">
          {readError.message}
        </Alert>
      )}

      {/* ============================================================ coverage */}
      <section className="space-y-4">
        <Card>
          <CardHeader title="Is the non-sitting-day check on?" />
          <CardBody className="space-y-4">
            <p className="text-sm text-gray-600">
              <code>is_non_sitting_day()</code> is what warns a lawyer before a court date is fixed on
              a day the court does not sit, and what the database consults before it accepts the next
              date on a matter. It reads three things, and only one of them needs no data.
            </p>

            <ul className="space-y-3">
              <li className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-sm font-medium text-emerald-900">Weekends — on</p>
                <p className="text-sm text-emerald-900">
                  Saturday and Sunday are refused everywhere, with no data behind them.
                </p>
              </li>

              <li
                className={`rounded-lg border p-3 ${
                  holidaysReachEnough ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
                }`}
              >
                <p className={`text-sm font-medium ${holidaysReachEnough ? "text-emerald-900" : "text-amber-900"}`}>
                  Public holidays —{" "}
                  {holidaysThrough === null
                    ? "nothing recorded"
                    : holidaysReachEnough
                      ? `recorded through ${holidaysThrough}`
                      : `only recorded to the end of ${holidaysThrough}`}
                </p>
                <p className={`text-sm ${holidaysReachEnough ? "text-emerald-900" : "text-amber-900"}`}>
                  {holidaysReachEnough
                    ? `Any day after ${holidaysThrough} is treated as an ordinary sitting day until the next year's dates are entered. Eid and Easter are declared each year and are only here once gazetted.`
                    : `It is ${thisYear}. A day this year that is a public holiday will be treated as an ordinary sitting day until it is entered below.`}
                </p>
              </li>

              <li
                className={`rounded-lg border p-3 ${
                  vacationsOn ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"
                }`}
              >
                <p className={`text-sm font-medium ${vacationsOn ? "text-emerald-900" : "text-red-900"}`}>
                  Court vacations —{" "}
                  {vacationsOn
                    ? `${upcomingVacations} window${upcomingVacations === 1 ? "" : "s"} still to come${
                        vacationsThrough ? `, the last ending ${dayLabel(vacationsThrough)}` : ""
                      }`
                    : vacationsThrough
                      ? `off, because every window entered has already ended — the last on ${dayLabel(vacationsThrough)}`
                      : "off, because nothing has been entered"}
                </p>
                <p className={`text-sm ${vacationsOn ? "text-emerald-900" : "text-red-900"}`}>
                  {vacationsOn
                    ? "A date inside one of these windows is refused for the courts and states the window covers."
                    : vacationsThrough
                      ? "Every vacation window on record is in the past, so a date in the middle of this year's Long Vacation is treated as an ordinary sitting day. Enter the current windows below."
                      : "court_vacations is empty, so a date in the middle of the Long Vacation is treated as an ordinary sitting day. Entering the first window below is what turns this part of the check on."}
                </p>
              </li>
            </ul>

            <p className="text-sm text-gray-600">
              The directory itself holds <strong>{activeCourts}</strong> open platform court
              {activeCourts === 1 ? "" : "s"}
              {totalPlatformCourts !== activeCourts ? ` (${totalPlatformCourts} rows including closed ones)` : ""}. A
              firm&apos;s own private courts are not counted here and are not editable from this
              screen.
            </p>
          </CardBody>
        </Card>
      </section>

      {/* ============================================================ vacations */}
      <section id="vacations" className="space-y-4">
        <CourtVacationEditor vacations={vacations} />
        {vacations.length === VACATION_LIMIT && (
          <p className="text-xs text-gray-500">
            Showing the {VACATION_LIMIT} most recent windows by start date. Older ones are not on this
            page.
          </p>
        )}
      </section>

      {/* ============================================================ holidays */}
      <section id="holidays" className="space-y-4">
        <PublicHolidayEditor holidays={holidays} />
        <p className="text-xs text-gray-500">
          Showing holidays from 1 January {thisYear} onwards
          {holidays.length === HOLIDAY_LIMIT ? `, capped at the first ${HOLIDAY_LIMIT}` : ""}. Earlier
          years are kept in the database and still answer for dates in the past.
        </p>
      </section>

      {/* ============================================================ courts */}
      <section id="courts" className="space-y-4">
        <PlatformCourtEditor courts={courts} totalCourts={totalPlatformCourts} search={courtSearch} />
        <p className="text-xs text-gray-500">
          {courtSearch
            ? `${courts.length} of ${totalPlatformCourts} platform courts match “${courtSearch}”.`
            : `Showing ${courts.length} platform courts of ${totalPlatformCourts}, by name. Search above to reach any of the others — this screen is the only place a platform court can be corrected or closed.`}
        </p>
      </section>

      <p className="text-sm text-gray-600">
        Failures across the platform — settlement, the notification queue and webhooks — are on{" "}
        <Link href="/admin/health" className="font-medium text-brand underline">
          the health screen
        </Link>
        .
      </p>
    </div>
  );
}
