"use client";

// Approve or end a connection in review. review_connection() checks the platform role and the
// second factor itself; this file repeats its words.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { reviewConnection } from "@/lib/actions/network";

export function ReviewControls({ connectionId }: { connectionId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function settle(approve: boolean) {
    setBusy(true);
    setError(null);
    const r = await reviewConnection(connectionId, approve, note);
    setBusy(false);
    if (r?.error) {
      setError(r.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-3 border-t border-hairline pt-3">
      <Textarea
        label="What you checked"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={1000}
        hint="For example the bar or law society register, or the firm's published contact page. Kept on the connection."
      />
      {error && <Alert kind="error" title="That was refused">{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || note.trim().length < 5} onClick={() => settle(true)}>Approve the connection</Button>
        <Button variant="danger" disabled={busy || note.trim().length < 5} onClick={() => settle(false)}>End it</Button>
      </div>
    </div>
  );
}
