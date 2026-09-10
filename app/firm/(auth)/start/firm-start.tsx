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

export function FirmStart({ signedIn, email }: { signedIn: boolean; email: string | null }) {
  const supabase = supabaseBrowser();
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
              <p className="text-center text-sm text-gray-500">
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
        {email && <p className="mb-4 text-sm text-gray-600">Signed in as {email}.</p>}
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
          <Input label="Registered name (optional)" name="legalName" hint="As registered with the CAC" error={state.fieldErrors?.legalName} />
          <Input label="RC / BN number (optional)" name="rcNumber" error={state.fieldErrors?.rcNumber} />
          <Select label="State of principal office" name="stateCode" defaultValue="" error={state.fieldErrors?.stateCode}>
            <option value="">Choose a state</option>
            {NG_STATE_OPTIONS.map((s) => (
              <option key={s.code} value={s.code}>{s.name}</option>
            ))}
          </Select>
          <Input
            label="Your Supreme Court enrolment number (optional)"
            name="ownerScn"
            placeholder="SCN123456"
            hint="Recorded on your practitioner record and shown on your firm's public profile, and carried on the proof of service for processes you serve. Docket does not check it against the Roll. You can add it later on your profile."
            error={state.fieldErrors?.ownerScn}
          />
          <Input label="Primary colour (optional)" name="primaryColour" type="color" defaultValue="#1c2b3a" hint="You can refine the brand later in firm settings." />
          <Button type="submit" size="lg" className="w-full" disabled={pending}>
            {pending ? "Creating your firm…" : "Create firm and set up two-factor"}
          </Button>
          <p className="text-sm text-gray-500">
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
