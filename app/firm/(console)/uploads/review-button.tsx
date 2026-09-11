"use client";

// The same write the matter's document list makes when staff mark an upload as looked at —
// documents_staff_modify lets a member update their firm's rows — so the queue clears from the
// queue. The client sees the result as "Seen by your firm" with the date.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";

export function ReviewButton({ documentId, userId }: { documentId: string; userId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex shrink-0 flex-col items-end gap-1">
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={async () => {
          const supabase = supabaseBrowser();
          if (!supabase) { setError("Not configured."); return; }
          setBusy(true); setError(null);
          const { error: e } = await supabase
            .from("documents")
            .update({ reviewed_at: new Date().toISOString(), reviewed_by: userId })
            .eq("id", documentId);
          setBusy(false);
          if (e) { setError(e.message); return; }
          router.refresh();
        }}
      >
        {busy ? "Marking…" : "Mark as reviewed"}
      </Button>
      {error && <span className="text-[11px] text-[#B42318]">{error}</span>}
    </span>
  );
}
