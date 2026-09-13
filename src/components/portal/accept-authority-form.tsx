"use client";

// The token goes to accept_representation() and the database answers. Nothing is decided here.

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { acceptRepresentation } from "@/lib/actions/delegation";

export function AcceptAuthorityForm({ token }: { token: string }) {
  const router = useRouter();
  const [value, setValue] = useState(token);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await acceptRepresentation(value.trim());
      if ("error" in r) { setError(r.error); return; }
      router.push(r.matterId ? `/app/matters/${r.matterId}` : "/app/matters");
    } catch { setError("Nothing happened — the connection may have dropped. Try again."); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && <Alert kind="error" title="That was refused">{error}</Alert>}
      <label className="block text-sm text-gray-800">
        The code from your link
        <input
          value={value} onChange={(e) => setValue(e.target.value)} required
          className="mt-1 block w-full min-h-11 rounded-lg border border-gray-300 px-3 font-mono text-[13px] text-gray-900 focus:border-brand focus:outline-none"
        />
      </label>
      <Button type="submit" disabled={busy || value.trim().length === 0}>{busy ? "Taking it up…" : "Take up this authority"}</Button>
    </form>
  );
}
