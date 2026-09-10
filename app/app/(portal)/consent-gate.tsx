"use client";

// First-login consent capture (NDPA): the client accepts the firm's current
// terms and privacy notice; versions are recorded in consent_records by the
// recordConsent server action.

import { useState } from "react";
import { recordConsent } from "./actions";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

export function ConsentGate({
  firmId,
  firmName,
  termsVersion,
  privacyVersion,
  termsUrl,
  privacyUrl,
}: {
  firmId: string;
  firmName: string;
  termsVersion: string;
  privacyVersion: string;
  termsUrl: string | null;
  privacyUrl: string | null;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <Card>
        <CardHeader title={`Before you continue with ${firmName}`} />
        <CardBody>
          <form
            action={recordConsent}
            onSubmit={() => setBusy(true)}
            className="space-y-4"
          >
            <input type="hidden" name="firmId" value={firmId} />
            <input type="hidden" name="termsVersion" value={termsVersion} />
            <input type="hidden" name="privacyVersion" value={privacyVersion} />

            <label className="flex items-start gap-3 text-sm text-gray-700">
              <input type="checkbox" required className="mt-1 h-4 w-4" />
              <span>
                I accept the{" "}
                {termsUrl ? (
                  <a href={termsUrl} target="_blank" rel="noreferrer" className="font-medium text-brand underline">
                    terms of service
                  </a>
                ) : (
                  "terms of service"
                )}{" "}
                (version {termsVersion}).
              </span>
            </label>

            <label className="flex items-start gap-3 text-sm text-gray-700">
              <input type="checkbox" required className="mt-1 h-4 w-4" />
              <span>
                I have read the{" "}
                {privacyUrl ? (
                  <a href={privacyUrl} target="_blank" rel="noreferrer" className="font-medium text-brand underline">
                    privacy notice
                  </a>
                ) : (
                  "privacy notice"
                )}{" "}
                (version {privacyVersion}).
              </span>
            </label>

            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {busy ? "Saving…" : "Agree and continue"}
            </Button>
          </form>
        </CardBody>
      </Card>
    </main>
  );
}
