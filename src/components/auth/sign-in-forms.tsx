"use client";

// Client sign-in (phone OTP or email magic link). Shared by /app/login and
// the booking wizard's inline sign-in step.

import { useState, type FormEvent } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

type Mode = "phone" | "email";

export function SignInForms({
  redirectNext,
  onSignedIn,
}: {
  /** Path the email magic link returns to. */
  redirectNext: string;
  /** Called after a phone OTP verifies (email flows return via the link). */
  onSignedIn?: () => void;
}) {
  const supabase = supabaseBrowser();
  const [mode, setMode] = useState<Mode>("phone");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"start" | "verify" | "email_sent">("start");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!supabase) {
    return (
      <Alert kind="warning" title="Not configured">
        Supabase environment variables are not set, so sign-in is not available yet.
      </Alert>
    );
  }

  async function startPhone(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase!.auth.signInWithOtp({ phone: phone.trim() });
    setBusy(false);
    if (err) setError(err.message);
    else setStage("verify");
  }

  async function verifyPhone(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase!.auth.verifyOtp({
      phone: phone.trim(),
      token: code.trim(),
      type: "sms",
    });
    setBusy(false);
    if (err) setError(err.message);
    else onSignedIn?.();
  }

  async function sendEmailLink(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase!.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirectNext)}`,
      },
    });
    setBusy(false);
    if (err) setError(err.message);
    else setStage("email_sent");
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2" role="tablist" aria-label="Sign-in method">
        <Button
          role="tab"
          aria-selected={mode === "phone"}
          variant={mode === "phone" ? "primary" : "ghost"}
          size="sm"
          onClick={() => { setMode("phone"); setStage("start"); setError(null); }}
        >
          Phone
        </Button>
        <Button
          role="tab"
          aria-selected={mode === "email"}
          variant={mode === "email" ? "primary" : "ghost"}
          size="sm"
          onClick={() => { setMode("email"); setStage("start"); setError(null); }}
        >
          Email
        </Button>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {mode === "phone" && stage === "start" && (
        <form onSubmit={startPhone} className="space-y-4">
          <Input
            label="Phone number"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+2348012345678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            hint="International format, e.g. +234…"
            required
          />
          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy ? "Sending code…" : "Send code"}
          </Button>
        </form>
      )}

      {mode === "phone" && stage === "verify" && (
        <form onSubmit={verifyPhone} className="space-y-4">
          <Input
            label={`Code sent to ${phone}`}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy ? "Verifying…" : "Verify and continue"}
          </Button>
          <Button variant="ghost" size="sm" className="w-full" onClick={() => setStage("start")}>
            Use a different number
          </Button>
        </form>
      )}

      {mode === "email" && stage !== "email_sent" && (
        <form onSubmit={sendEmailLink} className="space-y-4">
          <Input
            label="Email address"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy ? "Sending link…" : "Email me a sign-in link"}
          </Button>
        </form>
      )}

      {mode === "email" && stage === "email_sent" && (
        <Alert kind="success" title="Check your email">
          We sent a sign-in link to {email}. Open it on this device to continue.
        </Alert>
      )}
    </div>
  );
}
