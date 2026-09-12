"use client";

// Reading and signing a document version (migration 40), for the client and for the firm alike.
//
// The order is the rule, not a courtesy: the read is recorded first (open_document_version —
// the same record the storage policy needs before it mints a URL), the bytes are shown, and only
// then is a name typed. record_signature() refuses a signature from someone who has not opened
// this version in the last thirty minutes, and a name that is not the signer's own as it is on
// their profile. What is recorded is the version's checksum, so the signature is over bytes the
// database can name — not over "the document" in general.

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { recordDocumentOpen } from "@/lib/document-open";
import { signDocument } from "@/lib/actions/templates";
import { isNetworkFailure } from "@/lib/drafts";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

export function SignDialog({ open, name, versionId, storagePath, matterId, profileName, onClose, onSigned }: {
  open: boolean;
  name: string;
  versionId: string;
  storagePath: string;
  matterId: string | null;
  /** The signer's name as the profile has it, shown so they know what the database will compare. */
  profileName: string | null;
  onClose: () => void;
  onSigned: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    if (!open) { setUrl(null); setTyped(""); setAgreed(false); setError(null); return; }
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      const supabase = supabaseBrowser();
      if (!supabase) { setError("Not configured."); setLoading(false); return; }
      const refused = await recordDocumentOpen(supabase, versionId);
      if (refused) { if (!cancelled) { setError(refused); setLoading(false); } return; }
      const { data, error: sErr } = await supabase.storage.from("documents").createSignedUrl(storagePath, 600);
      if (cancelled) return;
      if (sErr || !data?.signedUrl) { setError(sErr?.message ?? "The document could not be opened."); setLoading(false); return; }
      setUrl(data.signedUrl); setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, storagePath, versionId]);

  async function sign() {
    setBusy(true); setError(null);
    try {
      const r = await signDocument(versionId, typed, matterId);
      if ("error" in r) { setError(r.error); return; }
      onSigned();
    } catch (e) {
      setError(isNetworkFailure(e) ? "Not signed — the connection dropped before the reply. Nothing was recorded; try again." : (e instanceof Error ? e.message : "Not signed."));
    } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Sign: ${name}`}>
      <div className="space-y-3">
        {error && <Alert kind="error" title="Not signed">{error}</Alert>}
        {loading ? (
          <p className="text-sm text-gray-600">Recording that you opened it, and preparing a secure link…</p>
        ) : url ? (
          <>
            <iframe src={url} title={name} className="h-[55vh] w-full rounded-lg border border-gray-200" />
            <a href={url} target="_blank" rel="noreferrer" className="text-sm text-brand underline">Open in a new tab</a>
          </>
        ) : null}
        {url && (
          <div className="space-y-2 rounded-lg bg-gray-50 p-3">
            <label className="flex items-start gap-2 text-sm text-gray-800">
              <input type="checkbox" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              <span>I have read this document and I sign it as it is shown here.</span>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-gray-800">Type your name{profileName ? ` exactly as it is on your profile: ${profileName}` : ""}</span>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" maxLength={200} autoComplete="off" />
            </label>
            <p className="text-xs text-gray-600">What is recorded: who you are, the name you typed, this version and its checksum, that you opened it, and when. Once signed, no further version can be added to this document.</p>
            <div className="flex gap-2">
              <Button onClick={sign} disabled={busy || !agreed || typed.trim().length < 2}>{busy ? "Signing…" : "Sign"}</Button>
              <Button variant="ghost" onClick={onClose} disabled={busy}>Not now</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
