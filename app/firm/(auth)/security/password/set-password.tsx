"use client";

// Setting the new password, in the session the recovery link left behind.
//
// WHAT THIS SCREEN MUST NOT BECOME. A password reset is the classic way round two-factor
// authentication: take the mailbox, take the password, walk in. It does not work here, and the
// reason is worth stating so nobody "simplifies" it away. The recovery link produces an aal1
// session. app/firm/(console)/layout.tsx refuses to render any console screen below aal2, and the
// database refuses staff writes below it as well (staff_w = member + mfa_ok + firm not suspended).
// So whoever follows this link still meets the authenticator challenge before a single client row
// is visible. This screen changes a password and nothing else; it does not enrol, unenrol or
// otherwise touch a factor, and it must never be moved behind the console's gate — a person who
// has lost their password cannot pass that gate, which is the whole reason they are here.
//
// THE NONCE PATH IS NOT SPECULATIVE. The project sets
// security_update_password_require_reauthentication, and whether the session a recovery link
// creates counts as "recently logged in" is the server's call, not ours — the documentation says a
// session under 24 hours old qualifies, and there are reports of updateUser answering "Password
// update requires reauthentication" immediately after a reset link anyway. Rather than leave a
// locked-out lawyer at a dead end on the strength of a guess, the refusal is caught: GoTrue emails
// a six-digit nonce, this screen asks for it, and the same password is submitted again with it.
// On a project where the recovery session suffices, that branch simply never runs.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { isNetworkFailure } from "@/lib/drafts";
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_MISMATCH,
  PASSWORD_TOO_WEAK,
  RESET_LINK_DEAD,
  SIGN_IN_NOT_SENT,
  SIGN_IN_TROUBLE,
  failureShape,
  passwordProblem,
} from "@/lib/auth-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardBody } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";

type Stage = "checking" | "ready" | "nonce" | "dead" | "done";

export function SetPassword() {
  const router = useRouter();
  const [supabase] = useState(() => supabaseBrowser());

  const [stage, setStage] = useState<Stage>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [nonce, setNonce] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inFlight = useRef(false);

  // The recovery link has already been through /auth/callback by the time this renders, so the
  // session either exists or the link was spent, expired, or opened in another browser. getUser()
  // and not getSession(): the question is whether the auth server still recognises this session,
  // which is exactly the thing a locally cached one cannot answer.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (cancelled) return;
        setStage(data?.user ? "ready" : "dead");
      })
      .catch(() => {
        if (!cancelled) setStage("dead");
      });
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  if (!supabase) {
    return (
      <Alert kind="warning" title="Not configured">
        Supabase environment variables are not set. See <code>.env.example</code>.
      </Alert>
    );
  }
  const client = supabase;

  /** The form's own checks, before anything is sent. Both are said in the field, not as a banner. */
  function localProblem(): string | null {
    if (password.length < MIN_PASSWORD_LENGTH) return PASSWORD_TOO_WEAK;
    if (password !== confirm) return PASSWORD_MISMATCH;
    return null;
  }

  async function save(withNonce: string | null) {
    if (inFlight.current) return;
    const wrong = localProblem();
    if (wrong) {
      setError(wrong);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await client.auth.updateUser(
        withNonce ? { password, nonce: withNonce } : { password },
      );
      if (err) {
        const problem = passwordProblem(failureShape(err));
        if (problem.needsNonce) {
          // GoTrue wants a fresh proof before it will take the password. reauthenticate() emails a
          // six-digit nonce to the address this session already belongs to, so nothing new is
          // disclosed and nobody else can intercept a step they could not already intercept.
          const { error: reauthErr } = await client.auth.reauthenticate();
          if (reauthErr) {
            setError(passwordProblem(failureShape(reauthErr)).text);
            return;
          }
          setStage("nonce");
          setNotice(problem.text);
          return;
        }
        setError(problem.text);
        return;
      }
      setStage("done");
      // To the console, which will send them straight to the authenticator challenge. Deliberately
      // not to /firm/login: the recovery session is a real session and making them type the
      // password they have just chosen would be theatre.
      router.replace("/firm");
      router.refresh();
    } catch (caught) {
      setError(isNetworkFailure(caught) ? SIGN_IN_NOT_SENT : SIGN_IN_TROUBLE);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void save(stage === "nonce" ? nonce.trim() : null);
  }

  if (stage === "checking") {
    return <p className="text-15 text-ink-muted">Checking your link…</p>;
  }

  if (stage === "dead") {
    return (
      <div className="space-y-3">
        <Alert kind="error" title="This link cannot set a password">
          {RESET_LINK_DEAD}
        </Alert>
        <a
          href="/firm/forgot"
          className="block rounded-lg bg-brand px-4 py-2.5 text-center text-15 font-medium text-brand-on"
        >
          Ask for a new link
        </a>
      </div>
    );
  }

  if (stage === "done") {
    return (
      <Alert kind="success" title="Password changed">
        Taking you to the console. You will be asked for your authenticator code, as usual.
      </Alert>
    );
  }

  return (
    <Card>
      <CardBody>
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert kind="error">{error}</Alert>}
          {notice && <Alert kind="info">{notice}</Alert>}

          <Input
            label="New password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); if (error) setError(null); }}
            hint={`At least ${MIN_PASSWORD_LENGTH} characters. A phrase you have not used elsewhere beats a short jumble.`}
            required
          />
          <Input
            label="New password again"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => { setConfirm(e.target.value); if (error) setError(null); }}
            required
          />

          {stage === "nonce" && (
            <Input
              label="Code from your email"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              placeholder="123456"
              className="text-center font-mono tracking-[0.3em] indent-[0.3em]"
              value={nonce}
              onChange={(e) => setNonce(e.target.value.replace(/\D/g, "").slice(0, 6))}
              required
            />
          )}

          <Button type="submit" size="lg" className="w-full" disabled={busy} aria-busy={busy}>
            {busy ? "Saving…" : "Set the new password"}
          </Button>
          <p className="text-11 leading-relaxed text-ink-muted">
            Your authenticator app is not affected. The console will still ask for its code.
          </p>
        </form>
      </CardBody>
    </Card>
  );
}
