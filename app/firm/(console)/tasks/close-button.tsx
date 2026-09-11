"use client";

// The one action a task queue needs on the row itself. Anything more — reassigning, changing the
// date — belongs on the matter's Tasks tab, which every row links to.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { closeTask } from "@/lib/actions/matters";
import { Button } from "@/components/ui/button";

export function CloseTaskButton({ taskId }: { taskId: string }) {
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
          setBusy(true); setError(null);
          const r = await closeTask(taskId);
          setBusy(false);
          if (r?.error) { setError(r.error); return; }
          router.refresh();
        }}
      >
        {busy ? "Closing…" : "Done"}
      </Button>
      {error && <span className="text-[11px] text-[#B42318]">{error}</span>}
    </span>
  );
}
