// Intake — the questions a client answers between choosing a time and paying.
//
// The booking wizard already knows how to ask them (app/(public)/[firm]/book/booking-wizard.tsx).
// What has never existed is a way for a firm to write them. intake_forms.schema is a jsonb column
// with NO database validation at all, so the shape has to be right when it is saved or the
// wizard shows a client an empty list, or a question that can never appear.
//
// Rules obeyed here:
//  · The database is the authorization layer. intake_forms_write_ins/upd/del is admin_w(firm_id)
//    — owner or admin, MFA session, firm not suspended. The editor is offered only to somebody
//    the database would let write; everybody else reads the forms. Refusals are the database's
//    own words, shown by the action.
//  · The service picker is built from THIS firm's services. intake_forms.service_id is not
//    covered by check_row_firm(), so the database would accept another firm's service id — the
//    picker cannot offer one, and saveIntakeForm() looks the service up inside the firm again
//    before writing.
//  · A form with service_id null is the firm-wide default; one with a service_id overrides it
//    for that service. The wizard takes the override first and falls back to the default, so
//    two live forms aimed at the same thing means one is never asked — that is named on screen.
//  · Nothing firm-specific: the firm and its services arrive from context.

import { requestedFirmId, staffContext } from "@/lib/firm-data";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { IntakeQuestion } from "@/lib/db/types";
import { IntakeEditor, type FormView, type ServiceOption } from "./intake-editor";

export const metadata = { title: "Intake questions" };

interface FormRecord {
  id: string;
  firm_id: string;
  service_id: string | null;
  name: string | null;
  schema: unknown;
  is_active: boolean;
}

interface ServiceRecord {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
}

/** How many questions a stored schema really holds — a legacy or hand-edited row may hold none. */
function questionsOf(schema: unknown): IntakeQuestion[] {
  if (typeof schema !== "object" || schema === null) return [];
  const q = (schema as { questions?: unknown }).questions;
  return Array.isArray(q) ? (q as IntakeQuestion[]) : [];
}

export default async function IntakePage({
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

  const [{ data: firmRow }, { data: formRows }, { data: serviceRows }] = await Promise.all([
    // A pending firm is missing from firm_public and is exactly the firm setting this up.
    supabase.from("firms").select("status").eq("id", firmId).maybeSingle(),
    supabase.from("intake_forms").select("id, firm_id, service_id, name, schema, is_active").eq("firm_id", firmId).limit(100),
    supabase.from("services").select("id, name, slug, is_active").eq("firm_id", firmId).order("sort", { ascending: true }).limit(200),
  ]);

  const firmStatus = (firmRow as { status: string } | null)?.status ?? "pending";
  const suspended = firmStatus === "suspended";
  const canWrite = isAdmin && !suspended;
  const records = (formRows ?? []) as unknown as FormRecord[];
  const services = (serviceRows ?? []) as unknown as ServiceRecord[];

  // How many clients have already answered each form. Renaming a key does not rewrite an answer
  // that has been given, so this number is what says whether an edit is a small matter or not.
  const counts = await Promise.all(
    records.map(async (f) => {
      const { count } = await supabase
        .from("intake_responses")
        .select("id", { count: "exact", head: true })
        .eq("firm_id", firmId)
        .eq("form_id", f.id);
      return { id: f.id, count: count ?? 0 };
    }),
  );
  const countById = new Map(counts.map((c) => [c.id, c.count]));

  const serviceById = new Map(services.map((s) => [s.id, s]));

  const views: FormView[] = records
    .map((f) => {
      const service = f.service_id ? serviceById.get(f.service_id) ?? null : null;
      return {
        id: f.id,
        name: f.name?.trim() || "Untitled form",
        serviceId: f.service_id,
        // A service_id pointing outside this firm's catalogue is possible in the column and has
        // to be visible rather than silently rendered as the firm-wide default.
        serviceName: f.service_id ? service?.name ?? "a service that is not in this firm's catalogue" : null,
        isActive: f.is_active,
        schemaJson: JSON.stringify(f.schema ?? { questions: [] }, null, 2),
        questionCount: questionsOf(f.schema).length,
        responseCount: countById.get(f.id) ?? 0,
      };
    })
    .sort((a, b) => (a.serviceId === null ? -1 : b.serviceId === null ? 1 : a.name.localeCompare(b.name)));

  const options: ServiceOption[] = services.map((s) => ({ id: s.id, name: s.name, isActive: s.is_active }));

  // Two live forms aimed at the same thing: the wizard reads the first row the database returns,
  // so the other is never asked. This is the state to name loudly.
  const clashes: string[] = [];
  const liveDefaults = views.filter((f) => f.isActive && f.serviceId === null);
  if (liveDefaults.length > 1) {
    clashes.push(
      `${liveDefaults.map((f) => `“${f.name}”`).join(" and ")} are all switched on as the firm-wide form. Only one of them is ever asked — the booking wizard uses whichever the database hands it first. Switch the others off.`,
    );
  }
  for (const s of services) {
    const live = views.filter((f) => f.isActive && f.serviceId === s.id);
    if (live.length > 1) {
      clashes.push(
        `${live.map((f) => `“${f.name}”`).join(" and ")} are all switched on for ${s.name}. Only one is ever asked. Switch the others off.`,
      );
    }
  }

  const hasLiveDefault = liveDefaults.length > 0;
  const activeServicesWithoutForm = services.filter(
    (s) => s.is_active && !views.some((f) => f.isActive && f.serviceId === s.id),
  );

  return (
    <div className="space-y-5">
      <header className="min-w-0">
        <h2 className="font-heading text-2xl font-semibold text-brand">Intake questions</h2>
        <p className="text-sm text-gray-600">
          {firmName} · what a client is asked before the consultation is booked
        </p>
      </header>

      {suspended && (
        <Alert kind="error" title="This firm is suspended">
          The forms are readable, and every change to them is refused by the database until Docket lifts the
          suspension.
        </Alert>
      )}

      {!isAdmin && !suspended && (
        <Alert kind="info" title="You can read this, not change it">
          Writing an intake form is an owner's or an admin's act — intake_forms_write is admin_w(), and the database
          refuses everybody else.
        </Alert>
      )}

      {records.length >= 100 && (
        <Alert kind="warning" title="Only the first 100 forms are shown">
          This firm has at least 100 intake forms and this screen reads 100 of them. Anything beyond that is not listed
          here.
        </Alert>
      )}

      {clashes.map((c) => (
        <Alert key={c} kind="warning" title="Two forms are competing">
          {c}
        </Alert>
      ))}

      <Card>
        <CardHeader title="How a client meets these questions" />
        <CardBody className="space-y-2 text-sm text-gray-600">
          <p>
            After the client has picked a time and before they sign in, the wizard asks the form that belongs to the
            service they chose. If that service has none, it asks the firm-wide form. If there is neither, it asks
            nothing and goes straight on — which is a fine way to run a firm, not a fault.
          </p>
          <p>
            {hasLiveDefault
              ? "There is a firm-wide form switched on, so every service without its own form uses it."
              : "There is no firm-wide form switched on. A service without its own form asks the client nothing."}
            {activeServicesWithoutForm.length > 0 && !hasLiveDefault
              ? ` That is the case for ${activeServicesWithoutForm.map((s) => s.name).join(", ")}.`
              : ""}
          </p>
          <p>
            The answers land on the consultation, where your colleagues read them{" "}
            <span className="font-medium text-gray-900">by key</span> — a question keyed{" "}
            <code>property_location</code> is headed “property location”. Write keys that read well, and remember that
            answers already given keep the key they were given: renaming a key does not go back and change them.
          </p>
          <p>
            A file question uploads to the firm's private store after the client signs in. The wizard never blocks on
            one, so a file cannot be made compulsory.
          </p>
        </CardBody>
      </Card>

      <IntakeEditor firmId={firmId} canWrite={canWrite} forms={views} services={options} />
    </div>
  );
}
