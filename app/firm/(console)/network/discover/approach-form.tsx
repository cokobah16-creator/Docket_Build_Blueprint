"use client";

// One firm's approach button on the directory: an introduction or a referral request, with a
// short brief. request_introduction() decides whether the firm can be reached and whether it
// takes this kind of approach; the words below are its own.

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/input";
import { requestIntroduction } from "@/lib/actions/network";
import { APPROACH_KINDS } from "@/lib/network-copy";

export function ApproachForm({
  firmId, toFirmId, toFirmName, acceptsIntroductions, acceptsReferrals, disabled,
}: {
  firmId: string;
  toFirmId: string;
  toFirmName: string;
  acceptsIntroductions: boolean;
  acceptsReferrals: boolean;
  disabled: boolean;
}) {
  const router = useRouter();
  const kinds = APPROACH_KINDS.filter((k) => (k.value === "introduction" ? acceptsIntroductions : acceptsReferrals));
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<string>(kinds[0]?.value ?? "introduction");
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (kinds.length === 0) return null;
  if (sent) {
    return <Alert kind="success" title="Sent">{toFirmName} has been told. Their answer appears in Docket Network.</Alert>;
  }
  if (!open) {
    return (
      <Button variant="secondary" size="sm" disabled={disabled} onClick={() => setOpen(true)}>
        Approach {toFirmName}
      </Button>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await requestIntroduction(firmId, { toFirmId, kind, brief });
    setBusy(false);
    if (r?.error) {
      setError(r.error);
      return;
    }
    setSent(true);
    router.refresh();
  }

  const hint = kinds.find((k) => k.value === kind)?.hint;
  return (
    <form onSubmit={submit} className="space-y-3 border-t border-hairline pt-3">
      <Select label="What you are asking" value={kind} onChange={(e) => setKind(e.target.value)}>
        {kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
      </Select>
      {hint && <p className="-mt-2 text-13 text-ink-muted">{hint}</p>}
      <Textarea
        label="Brief"
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        minLength={20}
        maxLength={2000}
        required
        hint="At least twenty characters. No client names or confidential facts."
      />
      {error && <Alert kind="error" title="That was refused">{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy ? "Sending…" : "Send"}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}
