"use client";

// The three things a registry does to a notice, each one a call to a database function that
// decides for itself: publish (registrar), discard a draft (any member), withdraw with a reason
// (registrar). The refusal, when there is one, is shown in the database's words.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { discardRegistryDraft, publishRegistryBatch, publishRegistryNotice, withdrawRegistryNotice } from "@/lib/actions/registry";

export function BatchControls({ batchId, count }: { batchId: string; count: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function publish() {
    if (!window.confirm(`Publish ${count} ${count === 1 ? "listing" : "listings"}? Every firm holding one of these suits at this court will see it.`)) return;
    setBusy(true); setError(null);
    try {
      const r = await publishRegistryBatch(batchId);
      if ("error" in r) setError(r.error); else router.refresh();
    } catch { setError("Nothing was published — the connection may have dropped. Try again."); }
    finally { setBusy(false); }
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" pending={busy} onClick={() => void publish()}>{`Publish ${count}`}</Button>
      {error && <Alert kind="error">{error}</Alert>}
    </div>
  );
}

export function NoticeControls({ noticeId, status, isRegistrar }: { noticeId: string; status: "draft" | "published"; isRegistrar: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<{ error: string } | undefined>) {
    setBusy(true); setError(null);
    try {
      const r = await fn();
      if (r?.error) setError(r.error); else router.refresh();
    } catch { setError("Nothing changed — the connection may have dropped. Try again."); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className="flex gap-1.5">
        {status === "draft" && isRegistrar && (
          <Button size="sm" variant="ghost" pending={busy} onClick={() => void run(() => publishRegistryNotice(noticeId))}>Publish</Button>
        )}
        {status === "draft" && (
          <Button size="sm" variant="ghost" pending={busy} onClick={() => void run(() => discardRegistryDraft(noticeId))}>Discard</Button>
        )}
        {status === "published" && isRegistrar && (
          <Button size="sm" variant="ghost" pending={busy} onClick={() => {
            const reason = window.prompt("Why is this notice withdrawn? The firms that confirmed it read this.") ?? "";
            if (reason.trim().length < 3) return;
            void run(() => withdrawRegistryNotice(noticeId, reason));
          }}>Withdraw</Button>
        )}
      </div>
      {error && <p className="max-w-[16rem] text-right text-11 text-[#B42318]">{error}</p>}
    </div>
  );
}
