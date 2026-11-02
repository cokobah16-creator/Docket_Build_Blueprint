"use client";

// The profile's offline-copy control. Saving is explicit and reversible, and
// the row says plainly what is in the copy and what is not.

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { SettingRow } from "@/components/ui/switch";
import { forgetCopy, saveCopy, savedAt, savedCopyUrls } from "@/lib/offline";
import { savedWords } from "@/components/portal/offline-banner";

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

  const when = saved ? savedWords(saved) : null;

  // What the copy holds is what savedCopyUrls() lists: the home screen, the matters list, each
  // matter's page and the court dates. The hint says no more than that.
  return (
    <SettingRow
      title="Offline copy"
      hint={
        when
          ? `Saved on ${when}. It has your home screen, your matters and your court dates.`
          : "Save a copy of your matters and court dates on this device, to read with no connection."
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
        {/* Named for what it does: the saved button deletes the copy, it does not connect. */}
        {pending ? (saved ? "Deleting…" : "Saving…") : saved ? "Delete the saved copy" : "Save a copy"}
      </Button>
    </SettingRow>
  );
}
