"use client";

// Enter the code, read who is asking, answer as a firm. Every refusal is the database's sentence.

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { respondInvitation, verifyInvitation, type VerifiedInvitation } from "@/lib/actions/network";

export function JoinForm({
  token,
  firms,
  email,
  registerHref,
}: {
  token: string;
  firms: Array<{ id: string; name: string; verified: boolean; role: string }>;
  email: string | null;
  registerHref: string;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState<VerifiedInvitation | null>(null);
  const [firmId, setFirmId] = useState(firms.find((f) => f.verified)?.id ?? firms[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] = useState<{ status: string } | null>(null);

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await verifyInvitation(token, code);
    setBusy(false);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    setVerified(r.verified);
  }

  async function answer(accept: boolean) {
    if (!verified) return;
    setBusy(true);
    setError(null);
    const r = await respondInvitation(verified.invitationId, firmId, accept, accept ? undefined : reason);
    setBusy(false);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    setOutcome({ status: r.status });
  }

  if (outcome) {
    return (
      <Card>
        <CardHeader title={outcome.status === "declined" ? "Declined" : outcome.status === "review" ? "Accepted, and waiting for Docket to check it" : "Connected"} />
        <CardBody className="space-y-3 text-15 text-ink">
          {outcome.status === "declined" && <p>The inviting firm has been told. Nothing was shared.</p>}
          {outcome.status === "review" && (
            <p>
              The address they invited does not match anything your firm has told Docket about itself, so the connection waits for Docket to
              check it. Both firms will be told when it is settled.
            </p>
          )}
          {outcome.status === "active" && (
            <p>
              Your firms are connected. A connection shares nothing by itself: when there is a matter to work together, the firm that owns it
              brings the other in and chooses exactly what to hand over.
            </p>
          )}
          <Link href="/firm/network" className="inline-flex min-h-[44px] items-center rounded-lg bg-brand px-4 text-15 font-medium text-brand-on">
            Open Docket Network
          </Link>
        </CardBody>
      </Card>
    );
  }

  if (!verified) {
    return (
      <Card>
        <CardHeader title="Enter the verification code" />
        <CardBody>
          <form onSubmit={verify} className="space-y-4">
            {error && <Alert kind="error" title="That was refused">{error}</Alert>}
            <Input
              label="Code from the email"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABCD-EFGH"
              autoComplete="one-time-code"
              inputMode="text"
              maxLength={9}
              required
              hint="Eight letters and digits. Entering it proves the email reached your firm; it grants no access on its own."
            />
            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {busy ? "Checking…" : "Verify the code"}
            </Button>
            <p className="text-13 text-ink-muted">
              Signed in as {email ?? "a member"}.{" "}
              {firms.length === 0 ? (
                <>
                  You are not a member of any firm yet, so you cannot answer for one.{" "}
                  <Link href={registerHref} className="font-medium text-brand underline">Register your firm first</Link>, then come back with the code.
                </>
              ) : (
                "After the code, you choose which of your firms answers."
              )}
            </p>
          </form>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title={`${verified.fromFirmName} would like to connect`} />
      <CardBody className="space-y-4">
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-15 sm:grid-cols-2">
          <div><dt className="text-13 text-ink-muted">Firm</dt><dd className="text-ink">{verified.fromFirmName}{verified.fromCountry ? ` · ${verified.fromCountry}` : ""}</dd></div>
          <div><dt className="text-13 text-ink-muted">Representative</dt><dd className="text-ink">{verified.fromRepresentative ?? "Not named"}</dd></div>
          <div className="sm:col-span-2"><dt className="text-13 text-ink-muted">Practice areas</dt><dd className="text-ink">{verified.fromPracticeAreas.length ? verified.fromPracticeAreas.join(", ") : "Not stated"}</dd></div>
          <div className="sm:col-span-2"><dt className="text-13 text-ink-muted">Why they are asking</dt><dd className="whitespace-pre-wrap text-ink">{verified.reason}</dd></div>
          <div className="sm:col-span-2"><dt className="text-13 text-ink-muted">Sent to</dt><dd className="text-ink">{verified.toEmail}</dd></div>
        </dl>
        <Alert kind="info" title="The code is verified. Nothing is shared yet.">
          Connecting lets each firm see the other&rsquo;s network profile and propose work. It opens no matter, no document, no client and no
          invoice: those are handed over one named thing at a time, on a matter, by the firm that owns it.
        </Alert>
        {firms.length === 0 ? (
          <Alert kind="warning" title="You are not a member of a firm">
            Only a firm can answer. <Link href={registerHref} className="font-medium underline">Register your firm</Link> and come back; the code
            stays verified for you for fourteen days.
          </Alert>
        ) : (
          <>
            <Select label="Answering as" value={firmId} onChange={(e) => setFirmId(e.target.value)}>
              {firms.map((f) => (
                <option key={f.id} value={f.id} disabled={!f.verified}>
                  {f.name}{f.verified ? "" : " (not yet verified by Docket)"}
                </option>
              ))}
            </Select>
            <p className="-mt-2 text-13 text-ink-muted">
              The database refuses an answer from anybody but an owner, administrator or member who holds the invite firms permission at the firm chosen.
            </p>
            <Textarea label="If declining, a word to them (optional)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
            {error && <Alert kind="error" title="That was refused">{error}</Alert>}
            <div className="flex flex-wrap gap-2">
              <Button size="lg" disabled={busy || !firmId} onClick={() => answer(true)}>{busy ? "Working…" : "Accept and connect"}</Button>
              <Button size="lg" variant="ghost" disabled={busy || !firmId} onClick={() => answer(false)}>Decline</Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
