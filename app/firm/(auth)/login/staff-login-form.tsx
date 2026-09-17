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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardBody } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";

export function StaffLoginForm({
  next,
  problem,
}: {
  next: string | null;
  /** Why the link that brought them here did not work, if that is how they arrived. */
  problem?: string | null;
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
        <Alert kind="warning" title="That link did not sign you in" className="mt-4">
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
            <Button type="submit" size="lg" className="w-full" pending={busy}>
              Sign in
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
