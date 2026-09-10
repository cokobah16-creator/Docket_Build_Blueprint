"use client";

// The client's side of a matter invitation. Two states, and only two:
//
//  1. Not signed in — sign in the way every other client does, by phone OTP or an
//     email link. There is no password here and no account to create up front: the
//     firm invited a phone number or an email address, and signing in with it is
//     what proves the person holding the link is the person invited. The sign-in
//     returns to this same page with the token still on it.
//  2. Signed in — accept. The server action calls accept_invite(), which is what
//     decides whether the token is good, and lands them on the matter itself.
//
// The invitation is deliberately not described before acceptance: invites is not
// readable by a client (that is the RLS, and it is right), so this screen would
// have to guess at the firm and the file. It says what accepting does instead.

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { SignInForms } from "@/components/auth/sign-in-forms";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { acceptMatterInvite, type JoinState } from "./actions";

export function JoinMatterForm({
  token,
  signedIn,
  identity,
}: {
  token: string;
  signedIn: boolean;
  /** How the signed-in person is identified — their phone, or failing that their email. */
  identity: string | null;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<JoinState, FormData>(acceptMatterInvite, {});

  if (!signedIn) {
    const next = `/app/join?token=${encodeURIComponent(token)}`;
    return (
      <div className="space-y-4">
        <p className="text-sm text-gray-700">
          Sign in with the phone number or email address your firm has for you. You will come straight back here.
        </p>
        <SignInForms redirectNext={next} onSignedIn={() => router.refresh()} />
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {state.error && (
        <Alert kind="error" title="That invitation could not be accepted">
          {state.error} Ask the firm to send you a fresh link.
        </Alert>
      )}
      <p className="text-sm text-gray-700">
        {identity ? `Signed in as ${identity}. ` : ""}
        Accepting adds you to the file, so you can follow what happens on it, read what the firm shares with you,
        message them and see any invoice they raise. Nothing the firm keeps to itself is shared.
      </p>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Joining…" : "Accept and open the file"}
      </Button>
      <p className="text-xs text-gray-500">
        Invited by mistake? Close this page and tell the firm — an invitation nobody accepts expires on its own.
      </p>
    </form>
  );
}
