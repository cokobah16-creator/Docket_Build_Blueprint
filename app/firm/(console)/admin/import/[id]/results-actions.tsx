"use client";

// Two small actions on the result page: continue a filing that stopped, and download the
// reconciliation as CSV. The download carries outcomes and references, never a token.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { processImportBatch } from "@/lib/actions/onboarding";
import { toCsv } from "@/lib/csv";
import { Button } from "@/components/ui/button";

export function ContinueImport({ batchId }: { batchId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true); setError(null);
    for (let guard = 0; guard < 1000; guard += 1) {
      const r = await processImportBatch(batchId, 50);
      if ("error" in r) { setError(r.error); break; }
      if (r.remaining === 0 || r.processed === 0) break;
    }
    setBusy(false);
    router.refresh();
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" disabled={busy} onClick={() => void go()}>{busy ? "Filing…" : "Continue filing"}</Button>
      {error && <span className="text-sm text-red-700">{error}</span>}
    </span>
  );
}

export function ResultsDownload({ name, rows }: { name: string; rows: Array<Array<string | number>> }) {
  function download() {
    const csv = toCsv(["row", "title", "your_file_number", "outcome", "docket_reference", "note"], rows);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <Button type="button" size="sm" variant="ghost" onClick={download}>Download the results</Button>;
}
