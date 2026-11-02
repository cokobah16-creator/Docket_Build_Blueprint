"use client";

// The token goes to accept_representation() and the database answers. Nothing is decided here.
// What comes back is the database's own wording, so each known refusal is said again in the
// client's words, with what to do next (docs/VOICE.md, rule 12). The meaning of each is the
// database's; only the tone is this file's.

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { acceptRepresentation } from "@/lib/actions/delegation";

function refusal(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("not valid, or has already been used")) {
    return "This invitation is not valid, or it has already been used. If you took it up already, it is in your matters. If not, ask the firm for a new link.";
  }
  if (m.includes("sent to somebody else")) {
    return "This invitation was sent to somebody else. Sign in as the person the firm named, then open the link again.";
  }
  if (m.includes("client on these files already")) {
    return "You are the client on these files, so you cannot take up an authority to act for yourself.";
  }
  if (m.includes("member of the firm")) return "A member of the firm cannot also act for its client.";
  if (m.includes("not authenticated")) return "You are not signed in. Sign in, then open the link again.";
  // The format check in acceptRepresentation(), before the database is asked.
  if (m.includes("not a valid invitation")) {
    return "This code is not a valid invitation. Check that you copied the whole link the firm sent you.";
  }
  return "Try again. If it keeps happening, tell the firm.";
}

export function AcceptAuthorityForm({ token }: { token: string }) {
  const router = useRouter();
  const [value, setValue] = useState(token);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const empty = value.trim().length === 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || empty) return;
    setBusy(true); setError(null);
    try {
      const r = await acceptRepresentation(value.trim());
      if ("error" in r) { setError(refusal(r.error)); return; }
      router.push(r.matterId ? `/app/matters/${r.matterId}` : "/app/matters");
    } catch {
      // The request may have arrived even though the answer did not.
      setError("The connection dropped before Docket could confirm this. Check your matters to see whether it went through, and try again if it did not.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3.5">
      {error && <Alert kind="error" title="This authority was not taken up">{error}</Alert>}
      <Input
        id="authority-code"
        label="The code from your link"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        required
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        className="font-mono"
        hint="If you opened the link the firm sent, this is already filled in."
      />
      <div className="space-y-1.5">
        <Button type="submit" pending={busy} disabled={empty}>{busy ? "Taking it up…" : "Take up this authority"}</Button>
        {empty && <p className="text-13 text-ink-muted">Paste the code from your link to continue.</p>}
      </div>
    </form>
  );
}
