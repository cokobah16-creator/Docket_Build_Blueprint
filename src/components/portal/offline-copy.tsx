"use client";

// The profile's offline-copy control. Saving is explicit and reversible, and
// the row says plainly what is in the copy and what is not.

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { SettingRow } from "@/components/ui/switch";
import { forgetCopy, saveCopy, savedAt, savedCopyUrls } from "@/lib/offline";

export function OfflineCopy({ matterIds }: { matterIds: string[] }) {
  const [saved, setSaved] = useState<Date | null>(null);
  const [ready, setReady] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    void savedAt().then((at) => {
      setSaved(at);
      setReady(true);
    });
  }, []);

  const when = saved
    ? new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      }).format(saved)
    : null;

  return (
    <SettingRow
      title="Offline copy"
      hint={
        when
          ? `Saved ${when} — matters, court dates and the last ten timeline entries.`
          : "Keep your matters and court dates readable with no network."
      }
    >
      <Button
        variant="ghost"
        size="sm"
        disabled={!ready || pending}
        onClick={() =>
          start(async () => {
            if (saved) {
              await forgetCopy();
              setSaved(null);
            } else {
              setSaved(await saveCopy(savedCopyUrls(matterIds)));
            }
          })
        }
      >
        {pending ? "Working…" : saved ? "Go online" : "Save now"}
      </Button>
    </SettingRow>
  );
}
