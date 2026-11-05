"use client";

// The platform's two acts on the jurisdiction registry: move a country through its lifecycle, and
// register or describe one. Each is one database function that checks is_platform_admin() and
// mfa_ok() for itself; this file chooses which box comes first and repeats the database's words.

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { registerJurisdiction, setJurisdictionStatus, type JurisdictionWriteState } from "@/lib/actions/jurisdictions";

/** What each status may move to, and what the move needs. The database refuses the rest. */
const MOVES: Record<string, Array<{ to: string; label: string; needsNote: boolean; tone: "primary" | "ghost" | "danger" }>> = {
  designed: [{ to: "validated", label: "Record the validation", needsNote: true, tone: "primary" }],
  validated: [
    { to: "active", label: "Activate: open to firms", needsNote: false, tone: "primary" },
    { to: "designed", label: "Back to designed", needsNote: false, tone: "ghost" },
  ],
  active: [{ to: "suspended", label: "Suspend registration", needsNote: false, tone: "danger" }],
  suspended: [
    { to: "active", label: "Reopen", needsNote: false, tone: "primary" },
    { to: "designed", label: "Back to designed", needsNote: false, tone: "ghost" },
  ],
};

export function JurisdictionStatusForm({ code, name, status }: { code: string; name: string; status: string }) {
  const [state, action, pending] = useActionState<JurisdictionWriteState, FormData>(setJurisdictionStatus, {});
  const moves = MOVES[status] ?? [];
  const needsNote = moves.some((m) => m.needsNote);
  return (
    <form action={action} className="space-y-3 border-t border-hairline pt-3">
      <input type="hidden" name="code" value={code} />
      {state.error && <Alert kind="error">{state.error}</Alert>}
      {state.done && <Alert kind="success">{state.done}</Alert>}
      {needsNote && (
        <Textarea
          label="What was reviewed, and by whom"
          name="note"
          required
          minLength={10}
          maxLength={4000}
          hint={`A validation is a record: the court directory, the procedural rules, the professional body's rules, the client money rules and the data protection law for ${name}, and the person who checked each. It is kept in the audit trail.`}
        />
      )}
      <div className="flex flex-wrap gap-2">
        {moves.map((m) => (
          <Button key={m.to} type="submit" name="status" value={m.to} variant={m.tone} disabled={pending}>
            {pending ? "Saving…" : m.label}
          </Button>
        ))}
      </div>
      {status === "active" && (
        <p className="text-13 text-ink-muted">
          Suspending closes registration for new firms only. Firms already under {name} keep working.
        </p>
      )}
    </form>
  );
}

export function RegisterJurisdictionForm() {
  const [state, action, pending] = useActionState<JurisdictionWriteState, FormData>(registerJurisdiction, {});
  return (
    <form action={action} className="space-y-3">
      {state.error && <Alert kind="error">{state.error}</Alert>}
      {state.done && <Alert kind="success">{state.done}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Country code" name="code" required maxLength={2} placeholder="IE" autoCapitalize="characters" error={state.fieldErrors?.code} hint="ISO 3166, two letters" />
        <Input label="Country" name="name" required maxLength={120} placeholder="Ireland" error={state.fieldErrors?.name} />
        <Select label="Legal system" name="legalSystem" required defaultValue="common_law" error={state.fieldErrors?.legalSystem}>
          <option value="common_law">Common law</option>
          <option value="civil_law">Civil law</option>
          <option value="mixed">Mixed</option>
          <option value="religious_mixed">Religious and mixed</option>
        </Select>
        <Input label="Currency" name="currencyCode" required maxLength={3} placeholder="EUR" autoCapitalize="characters" error={state.fieldErrors?.currencyCode} hint="Must already be one the invoices table can hold" />
        <Input label="Timezone" name="timezone" required maxLength={64} placeholder="Europe/Dublin" error={state.fieldErrors?.timezone} hint="An IANA name the database knows" />
        <Input label="Locale" name="locale" maxLength={5} placeholder="en-IE" error={state.fieldErrors?.locale} />
        <Input label="Language" name="language" maxLength={60} placeholder="English" error={state.fieldErrors?.language} />
        <Select label="Date format" name="dateFormat" defaultValue="DD/MM/YYYY" error={state.fieldErrors?.dateFormat}>
          <option value="DD/MM/YYYY">DD/MM/YYYY</option>
          <option value="MM/DD/YYYY">MM/DD/YYYY</option>
          <option value="YYYY-MM-DD">YYYY-MM-DD</option>
        </Select>
      </div>
      <Textarea
        label="What a validation must cover"
        name="validationScope"
        maxLength={2000}
        hint="Notes for the people who will review this jurisdiction: courts, rules, professional body, client money, data protection. Not a claim that any of it has been reviewed."
      />
      <Input label="Sort order" name="sort" type="number" min={1} max={1000} defaultValue={100} error={state.fieldErrors?.sort} />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Register as designed"}</Button>
    </form>
  );
}
