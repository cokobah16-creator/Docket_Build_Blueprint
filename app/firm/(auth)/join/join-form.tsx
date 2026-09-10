"use client";

// Step 1 (if needed): the invitee creates a staff account or signs in with the invited
// email. Step 2: accept — the server action calls accept_staff_invite(token).

import { useActionState, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { acceptInvite, type JoinState } from "./actions";

export function JoinForm({ token, signedIn, email, invitedEmail }: { token: string; signedIn: boolean; email: string | null; invitedEmail: string | null }) {
  const router = useRouter();
  const supabase = supabaseBrowser();
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [fullName, setFullName] = useState("");
  const [addr, setAddr] = useState(invitedEmail ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [state, action, pending] = useActionState<JoinState, FormData>(acceptInvite, {});

  if (!supabase) {
    return <Alert kind="warning" title="Not configured">Supabase environment variables are not set.</Alert>;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const next = `/firm/join?token=${encodeURIComponent(token)}`;
    if (mode === "signup") {
      const { data, error: err } = await supabase!.auth.signUp({
        email: addr.trim(),
        password,
        options: { data: { full_name: fullName.trim() }, emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
      });
      setBusy(false);
      if (err) return setError(err.message);
      if (data.session) router.refresh();
      else setSent(true);
    } else {
      const { error: err } = await supabase!.auth.signInWithPassword({ email: addr.trim(), password });
      setBusy(false);
      if (err) return setError(err.message);
      router.refresh();
    }
  }

  if (signedIn) {
    return (
      <form action={action} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        {state.error && <Alert kind="error">{state.error}</Alert>}
        <p className="text-sm text-gray-700">Signed in as {email}. Accepting joins you to the firm in the invited role; you then set up two-factor authentication.</p>
        <Button type="submit" size="lg" className="w-full" disabled={pending}>{pending ? "Joining…" : "Accept and join the firm"}</Button>
      </form>
    );
  }

  if (sent) {
    return <Alert kind="success" title="Confirm your email">We sent a confirmation link to {addr}. Open it on this device and you will land back here to accept.</Alert>;
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex gap-2" role="tablist" aria-label="Account">
        <Button role="tab" aria-selected={mode === "signup"} variant={mode === "signup" ? "primary" : "ghost"} size="sm" onClick={() => setMode("signup")}>Create account</Button>
        <Button role="tab" aria-selected={mode === "signin"} variant={mode === "signin" ? "primary" : "ghost"} size="sm" onClick={() => setMode("signin")}>Sign in</Button>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {mode === "signup" && <Input label="Your full name" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />}
      <Input label="Email (as invited)" type="email" autoComplete="email" value={addr} onChange={(e) => setAddr(e.target.value)} required />
      <Input label="Password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} required />
      <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}</Button>
    </form>
  );
}
