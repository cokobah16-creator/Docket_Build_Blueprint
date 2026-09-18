"use client";

// Staff sign-in: email + password. The console layout then enforces an MFA-verified (aal2)
// session — the database refuses staff writes below it.
//
// The destination is handed on rather than used directly: signing in leaves the session at
// aal1, so the console gate will bounce straight to /firm/security/mfa. It carries ?next=
// onward from there (src/lib/auth-redirect.ts), which is how a lawyer sent a link to one
// sitting arrives at that sitting rather than at the console's front door.

import { useState, type FormEvent } from "react";
import { DraftSweeper } from "@/components/ui/connection";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { stitchSignedInVisitor } from "@/lib/actions/analytics";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardBody } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";

export function StaffLoginForm({
  next,
  problem,
  problemTitle,
}: {
  next: string | null;
  /** Why the link that brought them here did not work, if that is how they arrived. */
  problem?: string | null;
  /** The heading for it, decided with the sentence in src/lib/auth-errors.ts. */
  problemTitle?: string | null;
}) {
  const router = useRouter();
  const supabase = supabaseBrowser();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!supabase) {
    return (
      <Alert kind="warning" title="Not configured">
        Supabase environment variables are not set. See <code>.env.example</code>.
      </Alert>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase!.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (err) setError(err.message);
    else {
      // THE ONLY STAFF SIGN-IN THAT MINTS A SESSION IN THE BROWSER, which is why it is the only
      // one that needs this. The two-factor screen verifies a factor against a session this call
      // already created, and the password-recovery screen inherits one from /auth/callback, which
      // stitches on its own — so neither needs a second join.
      //
      // WHAT THIS BUYS TODAY, STATED HONESTLY: nothing in the funnel yet. Every funnel event names
      // a client — site_viewed and booking_started carry the anonymous cookie, and matter_opened
      // carries the CLIENT's id even though a lawyer is the one who opened the matter
      // (src/lib/actions/matters.ts). No event has ever been attributed to a staff account, so
      // this joins a visitor to an identity that has no events of its own. It is a join waiting
      // for an event rather than one repairing a broken funnel, and it is here so that the day a
      // staff-side event is added — a firm registering, a console first used — the join is already
      // being made instead of being discovered missing a second time.
      //
      // The one thing it does change now: a lawyer who browsed their own firm's public site before
      // signing in had those site_viewed events under the anonymous cookie, and they now belong to
      // her account. That is staff traffic acquiring a name rather than staying anonymous in the
      // client funnel's top step — worth knowing when reading that step, and the reason this is
      // written down rather than left for somebody to find in the data.
      void stitchSignedInVisitor().catch(() => undefined);

      router.replace(next ?? "/firm");
      router.refresh();
    }
  }

  return (
    <>
      <DraftSweeper />
      <h1 className="font-heading text-26 font-semibold text-brand">Staff console</h1>
      <p className="mt-1 text-15 text-ink-muted">
        Sign in with your firm email. Two-factor authentication is required.
      </p>
      {problem && (
        <Alert kind="warning" title={problemTitle ?? "That link did not sign you in"} className="mt-4">
          {problem}
        </Alert>
      )}
      <Card className="mt-4">
        <CardBody>
          <form onSubmit={submit} className="space-y-4">
            {error && <Alert kind="error">{error}</Alert>}
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              label="Password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
            {/* The only way out of a forgotten password that does not involve ringing somebody.
                Below the button rather than beside the field: it is the escape hatch, not a
                competing action. */}
            <a href="/firm/forgot" className="block text-center text-15 font-medium text-brand underline">
              Forgotten your password?
            </a>
          </form>
        </CardBody>
      </Card>
    </>
  );
}
