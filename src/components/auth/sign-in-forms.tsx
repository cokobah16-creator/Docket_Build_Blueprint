"use client";

// Client sign-in (phone OTP or email magic link). Shared by /app/login and
// the booking wizard's inline sign-in step.
//
// Two things about it are not cosmetic.
//
// The method switch said `role="tablist"` and `role="tab"` over two buttons
// with no `tabpanel` beneath them and no `aria-controls` between the two, so it
// announced a pattern it did not implement: a screen reader was told to expect
// arrow-key movement through tabs and a panel to land in, and got neither. They
// are two buttons that turn one of two forms on, so they say so —
// `aria-pressed`, inside a named group — and the forms below stay where they
// are. The controls were also `size="sm"`, which is 30px tall; every control
// here is now at least 44px, this being a form whose whole point is that it is
// filled in on a phone.
//
// And it is the one phone-kit component that is also rendered outside a shell:
// the booking wizard is on the firm's public site, where the --dk-app-* tokens
// the kit's classes read are not defined. So the form declares the ones it uses
// on its own root. Inside /app this changes nothing — the client shell resolves
// them to exactly these values — and in the wizard it keeps the form in the
// firm's colours instead of an undefined variable, which paints a primary
// button transparent. The neutrals are .dk-shell's, in app/globals.css.

import { useState, type CSSProperties, type FormEvent } from "react";
import { cn } from "@/lib/cn";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { AppButton } from "@/components/app";
import { Alert } from "@/components/ui/alert";

type Mode = "phone" | "email";

const shellTokens = {
  "--dk-app-pri": "var(--dk-primary)",
  "--dk-app-on-pri": "var(--dk-on-primary)",
  "--dk-app-field": "#d1d5db",
  "--dk-app-strong": "#111827",
  "--dk-app-body": "#374151",
  "--dk-app-muted": "#6b7280",
} as CSSProperties;

const labelClass = "block text-[12.5px] font-semibold text-dk-body";
const fieldClass =
  "mt-1.5 min-h-[44px] w-full rounded-[9px] border border-dk-field bg-white px-3 py-[11px] text-[14px] text-dk-strong placeholder:text-dk-muted focus:border-dk-pri focus:outline-none";

/** The method chips, on the matter screen's pattern: 44px, filled when chosen. */
function methodClass(selected: boolean): string {
  return cn(
    "inline-flex min-h-[44px] flex-1 items-center justify-center rounded-full border px-[14px] text-[12.5px] font-medium",
    selected ? "border-dk-pri bg-dk-pri text-dk-on-pri" : "border-dk-field bg-white text-dk-body",
  );
}

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
    <div style={shellTokens} className="flex flex-col gap-3.5">
      <div role="group" aria-label="Sign-in method" className="flex gap-2">
        <button
          type="button"
          aria-pressed={mode === "phone"}
          className={methodClass(mode === "phone")}
          onClick={() => { setMode("phone"); setStage("start"); setError(null); }}
        >
          Phone
        </button>
        <button
          type="button"
          aria-pressed={mode === "email"}
          className={methodClass(mode === "email")}
          onClick={() => { setMode("email"); setStage("start"); setError(null); }}
        >
          Email
        </button>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {mode === "phone" && stage === "start" && (
        <form onSubmit={startPhone} className="flex flex-col gap-3.5">
          <div>
            <label htmlFor="signin-phone" className={labelClass}>
              Phone number
            </label>
            <input
              id="signin-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+2348012345678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              aria-describedby="signin-phone-hint"
              required
              className={fieldClass}
            />
            <p id="signin-phone-hint" className="mt-1.5 text-[11.5px] leading-relaxed text-dk-muted">
              International format, e.g. +234…
            </p>
          </div>
          <AppButton type="submit" disabled={busy}>
            {busy ? "Sending code…" : "Send code"}
          </AppButton>
        </form>
      )}

      {mode === "phone" && stage === "verify" && (
        <form onSubmit={verifyPhone} className="flex flex-col gap-3.5">
          <div>
            <label htmlFor="signin-code" className={labelClass}>
              Code sent to {phone}
            </label>
            <input
              id="signin-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              className={cn(fieldClass, "font-mono tracking-[0.18em]")}
            />
          </div>
          <AppButton type="submit" disabled={busy}>
            {busy ? "Verifying…" : "Verify and continue"}
          </AppButton>
          <AppButton variant="ghost" className="w-full" onClick={() => setStage("start")}>
            Use a different number
          </AppButton>
        </form>
      )}

      {mode === "email" && stage !== "email_sent" && (
        <form onSubmit={sendEmailLink} className="flex flex-col gap-3.5">
          <div>
            <label htmlFor="signin-email" className={labelClass}>
              Email address
            </label>
            <input
              id="signin-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className={fieldClass}
            />
          </div>
          <AppButton type="submit" disabled={busy}>
            {busy ? "Sending link…" : "Email me a sign-in link"}
          </AppButton>
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
