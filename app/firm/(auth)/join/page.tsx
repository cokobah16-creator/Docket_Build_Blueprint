// Staff-invite landing: /firm/join?token=… (the owner copies this link from the console
// and sends it to the invitee). The token alone proves nothing — accept_staff_invite()
// requires the signed-in account's identity-provider email to match the invitation.

import { supabaseServer } from "@/lib/supabase/server";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody } from "@/components/ui/card";
import { JoinForm } from "./join-form";

export const metadata = { title: "Join your firm" };

export default async function JoinPage({ searchParams }: { searchParams: Promise<{ token?: string; email?: string }> }) {
  const { token, email: invitedEmail } = await searchParams;
  const supabase = await supabaseServer();
  if (!supabase) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <Alert kind="warning" title="Not configured">Supabase environment variables are not set. See <code>.env.example</code>.</Alert>
      </main>
    );
  }
  if (!token || !/^[0-9a-f]{48}$/.test(token)) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <Alert kind="error" title="Invitation link not valid">Ask the firm to send the invitation link again.</Alert>
      </main>
    );
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-accent">Docket</p>
      <h1 className="mt-1 font-heading text-2xl font-semibold text-brand">Join your firm</h1>
      <p className="mt-1 text-sm text-gray-600">You have been invited to a firm on Docket. Use the email address the invitation was sent to.</p>
      <Card className="mt-4">
        <CardBody>
          <JoinForm token={token} signedIn={Boolean(user)} email={user?.email ?? null} invitedEmail={invitedEmail ?? null} />
        </CardBody>
      </Card>
    </main>
  );
}
