"use client";

// Step 1: create the owner's account (email + password — staff accounts).
// Step 2: the firm. The slug becomes {slug}.docket.app and the public path.

import { useActionState, useState, type FormEvent } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { NG_STATE_OPTIONS } from "@/lib/nigeria";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import type { JurisdictionOption } from "@/lib/db/types";
import { createFirm, type CreateFirmState } from "./actions";

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 63);
}

export function FirmStart({ signedIn, email, jurisdictions }: { signedIn: boolean; email: string | null; jurisdictions: JurisdictionOption[] }) {
  const supabase = supabaseBrowser();
  // Only an active jurisdiction can be chosen; the others are listed so a firm elsewhere knows
  // Docket is coming, and disabled so it cannot be picked. create_firm() refuses them anyway.
  const activeJurisdictions = jurisdictions.filter((j) => j.status === "active");
  const [jurisdiction, setJurisdiction] = useState(activeJurisdictions.some((j) => j.code === "NG") ? "NG" : (activeJurisdictions[0]?.code ?? "NG"));
  const isNigeria = jurisdiction === "NG";
  const [accountDone, setAccountDone] = useState(signedIn);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [fullName, setFullName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [state, formAction, pending] = useActionState<CreateFirmState, FormData>(createFirm, {});

  if (!supabase) {
    return (
      <Alert kind="warning" title="Not configured">
        Supabase environment variables are not set, so registration is not available yet.
      </Alert>
    );
  }

  async function signUp(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase!.auth.signUp({
      email: signupEmail.trim(),
      password,
      options: {
        data: { full_name: fullName.trim() },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/firm/start")}`,
      },
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    if (data.session) setAccountDone(true);
    else setNeedsConfirmation(true);
  }

  if (!accountDone) {
    return (
      <Card>
        <CardHeader title="Step 1 — your account" />
        <CardBody>
          {needsConfirmation ? (
            <Alert kind="success" title="Confirm your email">
              We sent a confirmation link to {signupEmail}. Open it on this device and you
              will land back here to set up the firm.
            </Alert>
          ) : (
            <form onSubmit={signUp} className="space-y-4">
              {error && <Alert kind="error">{error}</Alert>}
              <Input label="Your full name" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              <Input label="Work email" type="email" autoComplete="email" value={signupEmail} onChange={(e) => setSignupEmail(e.target.value)} required />
              <Input
                label="Password"
                type="password"
                autoComplete="new-password"
                minLength={10}
                hint="At least 10 characters. You will also set up an authenticator app."
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <Button type="submit" size="lg" className="w-full" disabled={busy}>
                {busy ? "Creating account…" : "Create account"}
              </Button>
              <p className="text-center text-15 text-ink-muted">
                Already have an account?{" "}
                <a href="/firm/login" className="font-medium text-brand underline">Sign in</a>
              </p>
            </form>
          )}
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Step 2 — your firm" />
      <CardBody>
        {email && <p className="mb-4 text-15 text-ink-muted">Signed in as {email}.</p>}
        <form action={formAction} className="space-y-4">
          {state.error && <Alert kind="error">{state.error}</Alert>}
          <Input
            label="Firm name"
            name="name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
            error={state.fieldErrors?.name}
            required
          />
          <Input
            label="Web address"
            name="slug"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value.toLowerCase());
            }}
            hint={slug ? `${slug}.docket.app — you can map your own domain later` : "Lowercase letters, numbers and hyphens"}
            error={state.fieldErrors?.slug}
            required
          />
          <Select
            label="Jurisdiction"
            name="jurisdiction"
            value={jurisdiction}
            onChange={(e) => setJurisdiction(e.target.value)}
            error={state.fieldErrors?.jurisdiction}
          >
            {jurisdictions.length === 0 && <option value="NG">Nigeria</option>}
            {jurisdictions.map((j) => (
              <option key={j.code} value={j.code} disabled={j.status !== "active"}>
                {j.name}{j.status !== "active" ? " (coming after validation)" : ""}
              </option>
            ))}
          </Select>
          <p className="-mt-2 text-13 text-ink-muted">
            A country opens to firms only after Docket has validated its courts, rules and professional requirements. Nothing assumes one country&rsquo;s law applies in another.
          </p>
          <Input label="Registered name (optional)" name="legalName" hint={isNigeria ? "As registered with the CAC" : "As registered with the companies or partnerships register"} error={state.fieldErrors?.legalName} />
          <Input label={isNigeria ? "RC / BN number (optional)" : "Registration number (optional)"} name="rcNumber" hint={isNigeria ? "With its letters, as on the CAC certificate: RC 1234567 or BN 1234567." : "As the register writes it."} error={state.fieldErrors?.rcNumber} />
          {isNigeria ? (
            <Select label="State of principal office" name="stateCode" defaultValue="" error={state.fieldErrors?.stateCode}>
              <option value="">Choose a state</option>
              {NG_STATE_OPTIONS.map((s) => (
                <option key={s.code} value={s.code}>{s.name}</option>
              ))}
            </Select>
          ) : (
            <Input label="State, province or region (optional)" name="region" maxLength={80} error={state.fieldErrors?.region} />
          )}
          <Input
            label={isNigeria ? "Your Supreme Court enrolment number (optional)" : "Your practising number (optional)"}
            name="ownerScn"
            placeholder={isNigeria ? "SCN123456" : ""}
            hint={isNigeria
              ? "Recorded on your practitioner record and shown on your firm's public profile, and carried on the proof of service for processes you serve. Docket does not check it against the Roll. You can add it later on your profile."
              : "Recorded on your practitioner record. Docket does not check it against any register yet."}
            error={state.fieldErrors?.ownerScn}
          />
          <Input label="Primary colour (optional)" name="primaryColour" type="color" defaultValue="#1c2b3a" hint="You can refine the brand later in firm settings." />
          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending ? "Creating your firm…" : "Create firm and set up two-factor"}
          </Button>
          <p className="text-15 text-ink-muted">
            No card at sign-up, and every firm is on the free plan while Docket is in
            build. By continuing you accept the Docket firm terms and act as the data
            controller for your clients’ information. Fees you charge settle to your
            own Paystack subaccount, which has to be set before a client can pay you
            online.
          </p>
        </form>
      </CardBody>
    </Card>
  );
}
