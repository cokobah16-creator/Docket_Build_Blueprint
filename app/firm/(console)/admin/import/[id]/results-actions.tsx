"use client";

// Three small actions on the result page: continue a filing that stopped, discard a batch whose
// staging never finished (it filed nothing), and download the reconciliation as CSV. The
// download carries outcomes and references, never a token.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { discardImportBatch, processImportBatch } from "@/lib/actions/onboarding";
import { toCsv } from "@/lib/csv";
import { Button } from "@/components/ui/button";

export function ContinueImport({ batchId }: { batchId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true); setError(null);
    try {
      for (let guard = 0; guard < 1000; guard += 1) {
        const r = await processImportBatch(batchId, 50);
        if ("error" in r) { setError(r.error); break; }
        if (r.remaining === 0 || r.processed === 0) break;
      }
    } catch {
      setError("The connection dropped. Rows already filed stay filed; continue again.");
    } finally {
      setBusy(false);
      router.refresh();
    }
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" disabled={busy} onClick={() => void go()}>{busy ? "Filing…" : "Continue filing"}</Button>
      {error && <span className="text-sm text-red-700">{error}</span>}
    </span>
  );
}

export function DiscardImport({ batchId }: { batchId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true); setError(null);
    try {
      const r = await discardImportBatch(batchId);
      if (r?.error) { setError(r.error); return; }
      router.push("/firm/admin/import");
      router.refresh();
    } catch {
      setError("The connection dropped. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void go()}>{busy ? "Discarding…" : "Discard this batch"}</Button>
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
