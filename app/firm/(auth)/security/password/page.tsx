// Where a password-recovery link lands, after /auth/callback has spent its code for a session.
//
// UNDER (auth), NOT (console), AND THAT IS THE POINT. app/firm/(console)/layout.tsx refuses to
// render below an MFA-verified session; a page for somebody who has lost their password cannot sit
// behind a gate that a person who has lost their password cannot pass. Being outside that gate
// does not weaken it: this screen changes a password and touches no factor, and the console and
// the database both still demand aal2 afterwards, so a stolen mailbox buys a password and stops at
// the authenticator. set-password.tsx says the same thing next to the code that relies on it.
//
// RENDERED PER REQUEST, like the rest of this group: the session is read in the browser, so Next
// would otherwise prerender this at build time and the nonce policy in src/lib/csp.ts would leave
// the form as dead HTML.
export const dynamic = "force-dynamic";

import { SetPassword } from "./set-password";

export const metadata = { title: "Set a new password" };

export default function SetPasswordPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <h1 className="font-heading text-2xl font-semibold text-brand">Set a new password</h1>
      <p className="mt-1 text-sm text-ink-muted">
        This link signed you in once. Choose a password and it will be replaced.
      </p>
      <div className="mt-4">
        <SetPassword />
      </div>
    </main>
  );
}
