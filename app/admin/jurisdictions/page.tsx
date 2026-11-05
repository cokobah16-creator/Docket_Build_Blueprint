// /admin/jurisdictions: every country Docket describes, how far each description has been taken,
// and the two acts the platform may perform on one.
//
// A jurisdiction is designed (described), validated (a recorded legal and regulatory review),
// active (firms may register under it) or suspended. The database refuses a jump from designed to
// active and a validation with no note, so the order on this screen is the order in
// set_jurisdiction_status(). Nigeria is active because the migrations before 61 are its
// configuration; the others are designed, with notes saying what a validation must cover.
//
// Counts come from jurisdiction_coverage(), which names no firm.

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { jurisdictionCoverage, platformContext } from "@/lib/admin-data";
import { formatWhen } from "@/lib/time";
import type { Jurisdiction } from "@/lib/db/types";
import { JurisdictionStatusForm, RegisterJurisdictionForm } from "./jurisdiction-controls";

export const metadata = { title: "Jurisdictions" };

const STATUS_TONE: Record<string, "settled" | "informing" | "waiting" | "wrong"> = {
  active: "settled",
  validated: "informing",
  designed: "waiting",
  suspended: "wrong",
};

const LEGAL_SYSTEM: Record<string, string> = {
  common_law: "Common law",
  civil_law: "Civil law",
  mixed: "Mixed",
  religious_mixed: "Religious and mixed",
};

export default async function JurisdictionsPage() {
  const ctx = await platformContext();
  if (!ctx) {
    return <Alert kind="error" title="Platform admins only">This account is not a Docket platform administrator.</Alert>;
  }
  const { supabase, timezone } = ctx;

  const [{ data: rows, error }, coverage] = await Promise.all([
    supabase.from("jurisdictions").select("*").order("sort").order("code").limit(300),
    jurisdictionCoverage(supabase),
  ]);
  const jurisdictions = (rows ?? []) as Jurisdiction[];
  const firmsByCode = new Map(coverage.rows.map((r) => [r.code, r.firms]));
  const active = jurisdictions.filter((j) => j.status === "active").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-26 font-semibold text-docket-hunter">Jurisdictions</h1>
        <p className="mt-1 text-15 text-ink-muted">
          {jurisdictions.length} described, {active} open to firms. A country opens only after a recorded validation; the
          registration form shows the rest as coming after validation.
        </p>
      </div>

      {error && <Alert kind="error" title="The registry did not load">Nothing is shown because nothing could be read. Try again.</Alert>}
      {coverage.error && (
        <Alert kind="error" title="The counts did not load">
          The jurisdictions below are real; how many firms are under each is not shown, because nothing could be counted.
        </Alert>
      )}

      {jurisdictions.length === 0 ? (
        <Card><EmptyState title="No jurisdiction is described" hint="Migration 61 seeds eight. If this is empty, the migration has not been applied to this database." /></Card>
      ) : (
        jurisdictions.map((j) => {
          const config = (j.config ?? {}) as Record<string, string>;
          const firms = firmsByCode.get(j.code);
          return (
            <Card key={j.code}>
              <CardHeader
                title={`${j.name} (${j.code})`}
                action={<Badge tone={STATUS_TONE[j.status] ?? "quiet"} icon="dot">{j.status}</Badge>}
              />
              <CardBody className="space-y-3">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-15 sm:grid-cols-3">
                  <div><dt className="text-13 text-ink-muted">Legal system</dt><dd className="text-ink">{LEGAL_SYSTEM[j.legal_system] ?? j.legal_system}</dd></div>
                  <div><dt className="text-13 text-ink-muted">Currency</dt><dd className="text-ink">{j.currency_code}</dd></div>
                  <div><dt className="text-13 text-ink-muted">Timezone</dt><dd className="text-ink">{j.timezone}</dd></div>
                  <div><dt className="text-13 text-ink-muted">Locale</dt><dd className="text-ink">{j.locale} · {j.language} · {j.date_format}</dd></div>
                  <div><dt className="text-13 text-ink-muted">Firms under it</dt><dd className="font-semibold tabular-nums text-docket-hunter">{typeof firms === "number" ? firms : "not counted"}</dd></div>
                  <div>
                    <dt className="text-13 text-ink-muted">Validated</dt>
                    <dd className="text-ink">{j.validated_at ? formatWhen(j.validated_at, timezone) : "not yet"}</dd>
                  </div>
                </dl>

                {j.validation_note && (
                  <div>
                    <p className="text-13 font-semibold uppercase tracking-wide text-ink-muted">What the validation covered</p>
                    <p className="mt-1 text-15 text-ink">{j.validation_note}</p>
                  </div>
                )}
                {config.validation_scope && (
                  <div>
                    <p className="text-13 font-semibold uppercase tracking-wide text-ink-muted">What a validation must cover</p>
                    <p className="mt-1 text-15 text-ink">{config.validation_scope}</p>
                  </div>
                )}
                {(config.courts || config.professional_body || config.data_protection) && (
                  <ul className="space-y-1 text-13 text-ink-muted">
                    {config.legal_system_note && <li>{config.legal_system_note}</li>}
                    {config.courts && <li>Courts: {config.courts}</li>}
                    {config.professional_body && <li>Professional body: {config.professional_body}</li>}
                    {config.data_protection && <li>Data protection: {config.data_protection}</li>}
                    {config.client_money && <li>Client money: {config.client_money}</li>}
                  </ul>
                )}

                <JurisdictionStatusForm code={j.code} name={j.name} status={j.status} />
              </CardBody>
            </Card>
          );
        })
      )}

      <Card>
        <CardHeader title="Register a country" />
        <CardBody>
          <p className="mb-3 text-15 text-ink-muted">
            A new country is always designed. Its reference data, its rules and its review come after, and only then does it
            open to firms.
          </p>
          <RegisterJurisdictionForm />
        </CardBody>
      </Card>
    </div>
  );
}
