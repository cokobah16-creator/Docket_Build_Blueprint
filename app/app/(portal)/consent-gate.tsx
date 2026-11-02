"use client";

// First-login consent capture (NDPA): the client accepts the firm's current
// terms and privacy notice. The recordConsent server action records it through
// record_consent(), which is given the versions shown here. It writes both rows
// for the signed-in person only when those are the versions the firm has
// published, so a change the client has not seen is refused, not recorded.

import { useActionState } from "react";
import { recordConsent, type ConsentState } from "./actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

const CHECKBOX =
  "mt-0.5 size-5 shrink-0 cursor-pointer accent-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
const DOC_LINK =
  "font-medium text-brand underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

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
  // Said only when there is something to open: a firm that has linked neither document still
  // gets the two boxes, and a sentence about tabs that never open would be untrue.
  const opens = termsUrl && privacyUrl ? "Each one opens in a new tab, so you can read it first." : "";

  // A <div>, not a <main>: the layout already puts the gate inside the page's one <main>.
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <Card>
        <CardHeader title={`Before you continue with ${firmName}`} />
        <CardBody>
          <p className="mb-4 text-15 leading-relaxed text-ink-muted">
            {firmName} asks you to accept its terms of service and to read its privacy notice
            before you go on. {opens}
          </p>
          <form action={action} className="space-y-4">
            <input type="hidden" name="firmId" value={firmId} />
            <input type="hidden" name="shownTermsVersion" value={termsVersion} />
            <input type="hidden" name="shownPrivacyVersion" value={privacyVersion} />

            {state.error && (
              <Alert kind="error">{state.error}</Alert>
            )}

            {/* The whole row is the target, at least 44px tall, so the small box is never the
                only thing a thumb can hit. */}
            <label htmlFor="consent-accept-terms" className="flex min-h-11 cursor-pointer items-start gap-3 py-1 text-15 text-ink">
              <input id="consent-accept-terms" name="acceptTerms" type="checkbox" required className={CHECKBOX} />
              <span>
                I accept the{" "}
                {termsUrl ? (
                  <a href={termsUrl} target="_blank" rel="noreferrer" className={DOC_LINK}>
                    terms of service
                  </a>
                ) : (
                  "terms of service"
                )}{" "}
                (version {termsVersion}).
              </span>
            </label>

            <label htmlFor="consent-accept-privacy" className="flex min-h-11 cursor-pointer items-start gap-3 py-1 text-15 text-ink">
              <input id="consent-accept-privacy" name="acceptPrivacy" type="checkbox" required className={CHECKBOX} />
              <span>
                I have read the{" "}
                {privacyUrl ? (
                  <a href={privacyUrl} target="_blank" rel="noreferrer" className={DOC_LINK}>
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
    </div>
  );
}
