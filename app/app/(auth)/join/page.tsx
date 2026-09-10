// Matter-invitation landing: /app/join?token=… — the link the console builds when a
// firm invites a client onto a file and sends it over WhatsApp, SMS or email.
//
// The token alone proves nothing. accept_invite() is granted to `authenticated`
// only, so somebody who finds the link must still sign in as themselves before the
// database will put them on the matter. This page therefore does one of two things:
// signs them in, or lets them accept.
//
// Nothing firm-specific appears here: the invitation is not readable by a client
// before it is accepted, so the page describes what accepting does rather than
// naming a firm it cannot verify.

import { supabaseServer } from "@/lib/supabase/server";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody } from "@/components/ui/card";
import { JoinMatterForm } from "./join-form";

export const metadata = { title: "Join your matter" };

export default async function JoinMatterPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const supabase = await supabaseServer();

  if (!supabase) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <Alert kind="warning" title="Not configured">
          Supabase environment variables are not set. See <code>.env.example</code>.
        </Alert>
      </main>
    );
  }

  if (!token || !/^[0-9a-f]{48}$/.test(token)) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <Alert kind="error" title="That invitation link is not valid">
          The link may have been cut short by the app it arrived in. Ask the firm to send it again.
        </Alert>
      </main>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-accent">Docket</p>
      <h1 className="mt-1 font-heading text-2xl font-semibold text-brand">Join your matter</h1>
      <p className="mt-1 text-sm text-gray-600">
        Your lawyers have invited you to follow a file on Docket.
      </p>
      <Card className="mt-4">
        <CardBody>
          <JoinMatterForm token={token} signedIn={Boolean(user)} identity={user?.phone ?? user?.email ?? null} />
        </CardBody>
      </Card>
      <p className="mt-6 text-center text-sm text-gray-500">
        Staff? <a href="/firm/login" className="font-medium text-brand underline">Sign in to the console</a>
      </p>
    </main>
  );
}
