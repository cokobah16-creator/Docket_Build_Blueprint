"use client";

// Reading and signing a document version (migration 40), for the client and for the firm alike.
//
// The order is the rule, not a courtesy: the read is recorded first (open_document_version —
// the same record the storage policy needs before it mints a URL), the bytes are shown, and only
// then is a name typed. record_signature() refuses a signature from someone who has not opened
// this version in the last thirty minutes, and a name that is not the signer's own as it is on
// their profile. What is recorded is the version's checksum, so the signature is over bytes the
// database can name — not over "the document" in general.
//
// A client is told what signing records and what it changes BEFORE the button, in plain words
// (docs/VOICE.md, rule 16), and never reads the database's own refusal. The console renders this
// with no `audience` and keeps its wording, which is why the default is "staff".

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { recordDocumentOpen } from "@/lib/document-open";
import { signDocument } from "@/lib/actions/templates";
import { isNetworkFailure } from "@/lib/drafts";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

const CHECKBOX =
  "mt-0.5 size-5 shrink-0 cursor-pointer accent-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

/**
 * record_signature() refuses in its own words, lower case and written for whoever reads the logs
 * (migration 40). The console shows them as they are. A client reads what was not done and what
 * to do next instead. The meaning of each refusal is kept; only the words are the client's.
 */
function clientRefusal(raw: string, profileName: string | null): string {
  const m = raw.toLowerCase();
  if (m.includes("open the document first")) return "Docket could not confirm that you opened this version in the last 30 minutes. Close this, choose Read and sign again, and sign once the document has loaded.";
  if (m.includes("profile has no name")) return "Your profile has no name to sign with yet. Add your full name on your profile, then sign.";
  if (m.includes("type your name")) return `The name you typed does not match your profile. Type it exactly as it is there${profileName ? `: ${profileName}` : ""}.`;
  if (m.includes("has not asked for a signature")) return "Your firm has not asked you to sign this document, so it cannot be signed here.";
  if (m.includes("executed on another version")) return "Another version of this document has already been signed, so this one cannot be. Message your lawyer if you expected to sign it.";
  if (m.includes("on paper")) return "This document is signed on paper, not here. Message your lawyer to arrange it.";
  if (m.includes("no checksum")) return "This version cannot be signed here. Message your lawyer.";
  if (m.includes("not authenticated")) return "You are signed out. Sign in again, then sign.";
  if (m.includes("not permitted")) return "This account cannot sign this document. If you think it should, message your lawyer.";
  if (m.includes("not found")) return "This document could not be found. It may have been removed. Refresh the page and try again.";
  return "Please try again. If it keeps happening, message your lawyer.";
}

export function SignDialog({ open, name, versionId, storagePath, matterId, profileName, onClose, onSigned, audience = "staff" }: {
  open: boolean;
  name: string;
  versionId: string;
  storagePath: string;
  matterId: string | null;
  /** The signer's name as the profile has it, shown so they know what the database will compare. */
  profileName: string | null;
  onClose: () => void;
  onSigned: () => void;
  /** Who is signing. The client's documents list passes "client"; the console passes nothing. */
  audience?: "client" | "staff";
}) {
  const client = audience === "client";
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The alert's title for a client: what happened, which is not always "not signed". A reply lost
  // to the network may have been recorded, and saying otherwise could make someone sign twice.
  const [errorTitle, setErrorTitle] = useState("Not signed");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    if (!open) { setUrl(null); setTyped(""); setAgreed(false); setError(null); return; }
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      setErrorTitle(client ? "Nothing has been signed" : "Not signed");
      const supabase = supabaseBrowser();
      if (!supabase) { setError(client ? "The document cannot be loaded right now. Try again later." : "Not configured."); setLoading(false); return; }
      const refused = await recordDocumentOpen(supabase, versionId);
      if (refused) { if (!cancelled) { setError(client ? "The document did not load. Close this and try again. If it keeps happening, message your lawyer." : refused); setLoading(false); } return; }
      const { data, error: sErr } = await supabase.storage.from("documents").createSignedUrl(storagePath, 600);
      if (cancelled) return;
      if (sErr || !data?.signedUrl) { setError(client ? "The document did not load. Close this and try again." : "The document could not be opened. Close this and try again."); setLoading(false); return; }
      setUrl(data.signedUrl); setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [client, open, storagePath, versionId]);

  async function sign() {
    setBusy(true); setError(null);
    try {
      const r = await signDocument(versionId, typed, matterId);
      if ("error" in r) {
        setErrorTitle(client ? "Your signature was not recorded" : "Not signed");
        setError(client ? clientRefusal(r.error, profileName) : r.error);
        return;
      }
      onSigned();
    } catch (e) {
      if (client) {
        const lost = isNetworkFailure(e);
        setErrorTitle(lost ? "Docket could not confirm your signature" : "Your signature was not recorded");
        setError(lost
          ? "The connection dropped before Docket replied. Close this and look at the document. If it now says Signed by you, your signature was recorded. If not, sign again."
          : "Please try again. If it keeps happening, message your lawyer.");
      } else {
        setError(isNetworkFailure(e) ? "Not signed — the connection dropped before the reply. Nothing was recorded; try again." : (e instanceof Error ? e.message : "Not signed."));
      }
    } finally { setBusy(false); }
  }

  if (!client) {
    return (
      <Modal open={open} onClose={onClose} title={`Sign: ${name}`}>
        <div className="space-y-3">
          {error && <Alert kind="error" title="Not signed">{error}</Alert>}
          {loading ? (
            <p className="text-15 text-ink-muted">Recording that you opened it, and preparing a secure link…</p>
          ) : url ? (
            <>
              <iframe src={url} title={name} className="h-[55vh] w-full rounded-lg border border-hairline" />
              <a href={url} target="_blank" rel="noreferrer" className="text-15 text-brand underline">Open in a new tab</a>
            </>
          ) : null}
          {url && (
            <div className="space-y-2 rounded-lg bg-sunken p-3">
              <label className="flex items-start gap-2 text-15 text-ink">
                <input type="checkbox" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                <span>I have read this document and I sign it as it is shown here.</span>
              </label>
              <label className="block text-15">
                <span className="font-medium text-ink">Type your name{profileName ? ` exactly as it is on your profile: ${profileName}` : ""}</span>
                <input value={typed} onChange={(e) => setTyped(e.target.value)} className="mt-1 w-full rounded-lg border border-edge px-3 py-2 text-base" maxLength={200} autoComplete="off" />
              </label>
              <p className="text-13 text-ink-muted">What is recorded: who you are, the name you typed, this version and its checksum, that you opened it, and when. Once signed, no further version can be added to this document.</p>
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

  // record_signature() refuses a profile with no name, so a client without one is told before
  // they type, and the button says what is missing right under it (docs/VOICE.md, rule 14).
  const nameReady = typed.trim().length >= 2;
  const missing = !profileName
    ? null
    : !agreed && !nameReady ? "Tick the box and type your name to sign."
      : !agreed ? "Tick the box to sign."
        : !nameReady ? "Type your name to sign."
          : null;

  return (
    <Modal open={open} onClose={onClose} title={`Read and sign ${name}`}>
      <div className="space-y-3">
        {error && <Alert kind="error" title={errorTitle}>{error}</Alert>}
        {loading ? (
          <p className="text-15 text-ink-muted">Recording that you opened it, then loading the document…</p>
        ) : url ? (
          <>
            <iframe src={url} title={name} className="h-[55vh] w-full rounded-card border border-hairline" />
            <a href={url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-15 text-brand underline">Open in a new tab</a>
          </>
        ) : null}
        {url && (
          <div className="space-y-3 rounded-card bg-sunken p-3">
            {/* What signing does, before the box and the button. The facts are the ones the
                console states as "What is recorded"; none of them is a statement of the law. */}
            <div className="space-y-1.5 text-15 text-ink">
              <p className="font-semibold">Before you sign</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Read the whole document. If anything in it is unclear, message your lawyer before you sign.</li>
                <li>Docket records who you are, the name you type, this exact version and its digital fingerprint, that you opened it, and when.</li>
                <li>Once you sign, this version is final. No further version can be added to this document.</li>
                {matterId && <li>Your lawyer is told that you have signed.</li>}
              </ul>
            </div>
            {!profileName && (
              <Alert kind="warning" title="Your profile has no name yet">
                Signing asks for your full name as it is on your profile.{" "}
                <Link href="/app/profile" className="font-medium underline underline-offset-2">Add your name on your profile</Link>, then come back to sign.
              </Alert>
            )}
            {/* The whole row is the target, at least 44px tall, so the small box is never the only
                thing a thumb can hit. */}
            <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1 text-15 text-ink">
              <input type="checkbox" className={CHECKBOX} checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              <span>I have read this document and I sign it as it is shown here.</span>
            </label>
            <Input
              id="sign-typed-name"
              label="Type your full name"
              hint={profileName ? `Exactly as it is on your profile: ${profileName}` : undefined}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              maxLength={200}
              autoComplete="off"
            />
            <div className="flex flex-wrap gap-2">
              <Button onClick={sign} pending={busy} disabled={!profileName || !agreed || !nameReady}>Sign this document</Button>
              <Button variant="ghost" onClick={onClose} disabled={busy}>Close without signing</Button>
            </div>
            {missing && <p className="text-13 text-ink-muted">{missing}</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}
