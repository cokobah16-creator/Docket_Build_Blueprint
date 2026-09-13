"use client";

// Asking for a password link. The whole screen is one field and one refusal to answer a question.
//
// THE ANSWER IS THE SAME EITHER WAY. A firm's staff list is the firm's business, and "no account
// with that email" would confirm, to anyone who can load this page, which addresses belong to
// which firm's lawyers. So the success panel is shown whatever resetPasswordForEmail returned —
// GoTrue answers a reset for an unknown address the same way it answers one for a real account,
// and this screen is written so it cannot accidentally be more forthcoming than the server.
// The only failures that are ever surfaced are the ones that are about this browser rather than
// about the address: no connection, and the frequency limit.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { isNetworkFailure } from "@/lib/drafts";
import {
  DEFAULT_RESEND_SECONDS,
  RESET_REQUESTED,
  SIGN_IN_NOT_SENT,
  SIGN_IN_TROUBLE,
  TOO_MANY_TRIES,
  cooldownFrom,
  failureShape,
} from "@/lib/auth-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardBody } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";

export function ForgotPasswordForm() {
  const [supabase] = useState(() => supabaseBrowser());
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useRef(false);

  // Same deadline-and-interval shape as the sign-in form: derived from a deadline so a late or
  // coalesced tick cannot make the countdown wrong, and torn down with the cooldown it belongs to.
  useEffect(() => {
    if (!until) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const done = setTimeout(() => setUntil(0), Math.max(0, until - Date.now()) + 250);
    return () => {
      clearInterval(tick);
      clearTimeout(done);
    };
  }, [until]);

  const wait = until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;

  if (!supabase) {
    return (
      <Alert kind="warning" title="Not configured">
        Supabase environment variables are not set. See <code>.env.example</code>.
      </Alert>
    );
  }
  const client = supabase;

  async function sendReset(address: string) {
    if (!address || inFlight.current || wait > 0) {
      setSent(true);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await client.auth.resetPasswordForEmail(address, {
        // Lands on the shared callback, which spends the code for a session and then continues to
        // the page below. scripts/configure-providers.sh allow-lists ${APP_URL}/** so this shape
        // is already permitted; app/auth/callback/route.ts reads ?next= back through safeNext().
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/firm/security/password")}`,
      });
      // A frequency limit is about this browser and worth saying; everything else is about the
      // address, and this screen does not discuss the address.
      const shape = failureShape(err);
      if (shape.status === 429 || /only request this after/i.test(shape.message ?? "")) {
        setError(TOO_MANY_TRIES);
        setUntil(Date.now() + cooldownFrom(shape.message) * 1000);
        setSent(true);
        return;
      }
      setUntil(Date.now() + DEFAULT_RESEND_SECONDS * 1000);
      setSent(true);
    } catch (caught) {
      setError(isNetworkFailure(caught) ? SIGN_IN_NOT_SENT : SIGN_IN_TROUBLE);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void sendReset(email.trim());
  }

  if (sent) {
    return (
      <div className="space-y-3">
        {error && <Alert kind="warning">{error}</Alert>}
        <Alert kind="success" title="Check your email">
          {RESET_REQUESTED}
        </Alert>
        <Card>
          <CardBody className="space-y-3">
            <p className="text-sm text-gray-700">
              Two-factor authentication is unchanged. Setting a new password does not switch it off, and
              you will still be asked for your authenticator code before the console opens.
            </p>
            <Button
              variant="ghost"
              size="md"
              className="w-full"
              disabled={busy || wait > 0}
              onClick={() => void sendReset(email.trim())}
            >
              {wait > 0 ? `Send it again in ${wait}s` : "Send it again"}
            </Button>
            <a href="/firm/login" className="block text-center text-sm font-medium text-brand underline">
              Back to sign-in
            </a>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <Card>
      <CardBody>
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert kind="error">{error}</Alert>}
          <Input
            label="Your firm email"
            type="email"
            inputMode="email"
            autoComplete="email"
            enterKeyHint="send"
            placeholder="you@firm.example"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            hint="The address you sign in to the console with."
            required
          />
          <Button type="submit" size="lg" className="w-full" disabled={busy} aria-busy={busy}>
            {busy ? "Sending…" : "Email me a password link"}
          </Button>
          <a href="/firm/login" className="block text-center text-sm font-medium text-brand underline">
            Back to sign-in
          </a>
        </form>
      </CardBody>
    </Card>
  );
}
