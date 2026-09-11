"use client";

// Client sign-in: phone OTP (primary for Nigerian clients) or email magic
// link. No passwords for clients; Supabase Auth issues the session and RLS
// does the rest.
//
// The screen is the shape /app/join is: a glyph, the heading, one line saying
// what to use, the card, and the way out to the console underneath. Neither of
// the two calls itself "Docket" any more — in the client app the client is
// dealing with their lawyers, and this screen is already wearing their colours.

import { useRouter } from "next/navigation";
import { SignInForms } from "@/components/auth/sign-in-forms";
import { AppCard, AppCardBody, Footnote, ScreenTitle } from "@/components/app";
import { UserIcon } from "@/components/ui/icons";

export default function ClientLoginPage() {
  const router = useRouter();
  return (
    <div className="dk-rise flex flex-col gap-3.5">
      <header>
        <span
          aria-hidden="true"
          className="mb-3 grid h-11 w-11 place-items-center rounded-full border border-dk-line bg-white text-dk-pri"
        >
          <UserIcon size={21} />
        </span>
        <ScreenTitle>Sign in</ScreenTitle>
        <p className="mt-1.5 text-[13px] leading-relaxed text-dk-muted">
          Use the phone number or email your firm has for you.
        </p>
      </header>

      <AppCard>
        <AppCardBody>
          <SignInForms redirectNext="/app" onSignedIn={() => router.replace("/app")} />
        </AppCardBody>
      </AppCard>

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
