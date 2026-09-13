"use client";

// The interactive half of the client sign-in screen. It exists as its own file because the page
// above it has to read ?next= on the server, and a page that reads search params cannot be the
// same component as the one holding the router.

import { useRouter } from "next/navigation";
import { DraftSweeper } from "@/components/ui/connection";
import { SignInForms } from "@/components/auth/sign-in-forms";
import { Card, CardBody } from "@/components/ui/card";

export function ClientLoginPanel({ next }: { next: string | null }) {
  const router = useRouter();
  // Where they were going before the gate stopped them, or the portal home if they simply
  // opened the sign-in page. Both sign-in methods return here: the phone code lands on the
  // callback below, the email link on /auth/callback, which honours the same value.
  const destination = next ?? "/app";

  return (
    <>
      <DraftSweeper />
      <h1 className="font-heading text-2xl font-semibold text-brand">Sign in</h1>
      <p className="mt-1 text-sm text-gray-600">Use the phone number or email your firm has for you.</p>
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
      <p className="mt-6 text-center text-sm text-gray-500">
        Staff? <a href="/firm/login" className="font-medium text-brand underline">Sign in to the console</a>
      </p>
    </>
  );
}
