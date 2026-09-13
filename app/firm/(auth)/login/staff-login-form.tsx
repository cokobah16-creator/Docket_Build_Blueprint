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

export function StaffLoginForm({ next }: { next: string | null }) {
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
      <h1 className="font-heading text-2xl font-semibold text-brand">Staff console</h1>
      <p className="mt-1 text-sm text-gray-600">
        Sign in with your firm email. Two-factor authentication is required.
      </p>
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
          </form>
        </CardBody>
      </Card>
    </>
  );
}
