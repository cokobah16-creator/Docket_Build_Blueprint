"use client";

// First-login consent capture (NDPA): the client accepts the firm's current
// terms and privacy notice. The recordConsent server action records it through
// record_consent(), which writes both rows for the signed-in person at the
// versions the firm has published. The versions posted from here are only
// compared with those, so a change the client has not seen is not recorded.

import { useActionState } from "react";
import { recordConsent, type ConsentState } from "./actions";
import { Alert } from "@/components/ui/alert";
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
  const [state, action, pending] = useActionState<ConsentState, FormData>(recordConsent, {});

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <Card>
        <CardHeader title={`Before you continue with ${firmName}`} />
        <CardBody>
          <form action={action} className="space-y-4">
            <input type="hidden" name="firmId" value={firmId} />
            <input type="hidden" name="shownTermsVersion" value={termsVersion} />
            <input type="hidden" name="shownPrivacyVersion" value={privacyVersion} />

            {state.error && (
              <Alert kind="error">{state.error}</Alert>
            )}

            <label htmlFor="consent-accept-terms" className="flex items-start gap-3 text-15 text-ink">
              <input id="consent-accept-terms" name="acceptTerms" type="checkbox" required className="mt-1 h-4 w-4" />
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

            <label htmlFor="consent-accept-privacy" className="flex items-start gap-3 text-15 text-ink">
              <input id="consent-accept-privacy" name="acceptPrivacy" type="checkbox" required className="mt-1 h-4 w-4" />
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

            <Button type="submit" size="lg" className="w-full" disabled={pending}>
              {pending ? "Saving…" : "Agree and continue"}
            </Button>
          </form>
        </CardBody>
      </Card>
    </main>
  );
}
