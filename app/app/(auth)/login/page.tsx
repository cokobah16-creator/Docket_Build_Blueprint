"use client";

// Client sign-in: phone OTP (primary for Nigerian clients) or email magic
// link. No passwords for clients; Supabase Auth issues the session and RLS
// does the rest.

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardBody } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";

type Mode = "phone" | "email";

export default function ClientLoginPage() {
  const router = useRouter();
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
      <main className="mx-auto max-w-md px-4 py-16">
        <Alert kind="warning" title="Not configured">
          Supabase environment variables are not set, so sign-in is not
          available yet. See <code>.env.example</code>.
        </Alert>
      </main>
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
    else router.replace("/app");
  }

  async function sendEmailLink(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase!.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/app` },
    });
    setBusy(false);
    if (err) setError(err.message);
    else setStage("email_sent");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <h1 className="font-heading text-2xl font-semibold text-brand">Sign in</h1>
      <p className="mt-1 text-sm text-gray-600">
        Use the phone number or email your firm has for you.
      </p>

      <div className="mt-6 flex gap-2" role="tablist" aria-label="Sign-in method">
        <Button
          role="tab"
          aria-selected={mode === "phone"}
          variant={mode === "phone" ? "primary" : "ghost"}
          size="sm"
          onClick={() => {
            setMode("phone");
            setStage("start");
            setError(null);
          }}
        >
          Phone
        </Button>
        <Button
          role="tab"
          aria-selected={mode === "email"}
          variant={mode === "email" ? "primary" : "ghost"}
          size="sm"
          onClick={() => {
            setMode("email");
            setStage("start");
            setError(null);
          }}
        >
          Email
        </Button>
      </div>

      <Card className="mt-4">
        <CardBody className="space-y-4">
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
                {busy ? "Verifying…" : "Verify and sign in"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => setStage("start")}
              >
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
              We sent a sign-in link to {email}. Open it on this device.
            </Alert>
          )}
        </CardBody>
      </Card>

      <p className="mt-6 text-center text-sm text-gray-500">
        Staff? <a href="/firm/login" className="font-medium text-brand underline">Sign in to the console</a>
      </p>
    </main>
  );
}
