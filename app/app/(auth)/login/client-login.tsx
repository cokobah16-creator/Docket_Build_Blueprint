"use client";

// The interactive half of the client sign-in screen. It exists as its own file because the page
// above it has to read ?next= on the server, and a page that reads search params cannot be the
// same component as the one holding the router.

import { useRouter } from "next/navigation";
import { DraftSweeper } from "@/components/ui/connection";
import { SignInForms } from "@/components/auth/sign-in-forms";
import { Card, CardBody } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";

export function ClientLoginPanel({
  next,
  problem,
}: {
  next: string | null;
  /** Why the sign-in link they just followed did not work, if that is how they got here. */
  problem?: string | null;
}) {
  const router = useRouter();
  // Where they were going before the gate stopped them, or the portal home if they simply
  // opened the sign-in page. Both sign-in methods return here: the phone code lands on the
  // callback below, the email link on /auth/callback, which honours the same value.
  const destination = next ?? "/app";

  return (
    <>
      <DraftSweeper />
      <h1 className="font-heading text-2xl font-semibold text-brand">Sign in</h1>
      <p className="mt-1 text-sm text-ink-muted">Use the phone number or email your firm has for you.</p>
      {/* Above the form rather than inside it: this is about the attempt that brought them here,
          not about anything they have typed yet, and SignInForms clears its own slots as soon as
          a tab is tapped. kind="warning" because nothing has gone wrong with their account —
          there is a link that did not work and a form right below that will. */}
      {problem && (
        <Alert kind="warning" title="That link did not sign you in" className="mt-4">
          {problem}
        </Alert>
      )}
      <Card className="mt-4">
        <CardBody>
          <SignInForms
            redirectNext={destination}
            onSignedIn={() => {
              router.replace(destination);
              router.refresh();
            }}
          />
        </CardBody>
      </Card>
      <p className="mt-6 text-center text-sm text-ink-muted">
        Staff? <a href="/firm/login" className="font-medium text-brand underline">Sign in to the console</a>
      </p>
    </>
  );
}
