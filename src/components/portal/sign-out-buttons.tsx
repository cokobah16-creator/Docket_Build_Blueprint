"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { forgetCopy } from "@/lib/offline";

export function SignOutButtons({ local, everywhere }: {
  local: () => Promise<void>;
  everywhere: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  async function leave(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await forgetCopy();
    } finally {
      await action();
    }
  }
  return (
    <div className="flex gap-2.5">
      <Button type="button" variant="ghost" size="lg" className="flex-1" disabled={busy} onClick={() => void leave(local)}>Sign out</Button>
      <Button type="button" variant="ghost" size="lg" className="flex-1" disabled={busy} onClick={() => void leave(everywhere)}>Sign out everywhere</Button>
    </div>
  );
}
