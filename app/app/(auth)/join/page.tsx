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
// naming a firm it cannot verify. The firm's colours are the layout's, and they
// need no invitation to be read.
//
// All three states are the same screen. The two failures used to drop the
// heading and hand over a bare alert floating at the top of a white page, which
// left the reader nothing saying where they were or what had been attempted.

import type { ReactNode } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import { Alert } from "@/components/ui/alert";
import { AppCard, AppCardBody, Footnote, ScreenTitle } from "@/components/app";
import { FolderIcon } from "@/components/ui/icons";
import { JoinMatterForm } from "./join-form";

export const metadata = { title: "Join your matter" };

/** The screen around whatever this visit turned out to be: a form, or a reason. */
function JoinScreen({ children }: { children: ReactNode }) {
  return (
    <div className="dk-rise flex flex-col gap-3.5">
      <header>
        <span
          aria-hidden="true"
          className="mb-3 grid h-11 w-11 place-items-center rounded-full border border-dk-line bg-white text-dk-pri"
        >
          <FolderIcon size={21} />
        </span>
        <ScreenTitle>Join your matter</ScreenTitle>
        <p className="mt-1.5 text-[13px] leading-relaxed text-dk-muted">
          Your lawyers have invited you to follow a file on Docket.
        </p>
      </header>

      {children}

      <Footnote className="text-center">
        Staff?{" "}
        <a
          href="/firm/login"
          className="inline-flex min-h-[44px] items-center font-medium text-dk-pri underline underline-offset-2"
        >
          Sign in to the console
        </a>
      </Footnote>
    </div>
  );
}

export default async function JoinMatterPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const supabase = await supabaseServer();

  if (!supabase) {
    return (
      <JoinScreen>
        <Alert kind="warning" title="Not configured">
          Supabase environment variables are not set. See{" "}
          <code className="font-mono text-[12.5px]">.env.example</code>.
        </Alert>
      </JoinScreen>
    );
  }

  if (!token || !/^[0-9a-f]{48}$/.test(token)) {
    return (
      <JoinScreen>
        <Alert kind="error" title="That invitation link is not valid">
          The link may have been cut short by the app it arrived in. Ask the firm to send it again.
        </Alert>
      </JoinScreen>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <JoinScreen>
      <AppCard>
        <AppCardBody>
          <JoinMatterForm token={token} signedIn={Boolean(user)} identity={user?.phone ?? user?.email ?? null} />
        </AppCardBody>
      </AppCard>
    </JoinScreen>
  );
}
