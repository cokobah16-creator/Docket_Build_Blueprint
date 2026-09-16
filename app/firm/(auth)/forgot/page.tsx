// "I cannot get in." Until now that was a support ticket: nothing in this repository called
// resetPasswordForEmail, though the blueprint's own feature table has listed "Forgot password"
// since the beginning. A staff account with a forgotten password could only be recovered by
// somebody with database access.
//
// It lives under (auth) and NOT under (console) deliberately — see the note in
// security/password/page.tsx. A person who has lost their password cannot pass the console's gate,
// so a recovery screen behind that gate is a recovery screen nobody who needs it can reach.
//
// RENDERED PER REQUEST. This page reads no cookies, headers or search params, so Next.js would
// prerender it at build time — and a prerendered page's inline bootstrap scripts carry no nonce,
// which the policy in src/lib/csp.ts then refuses, leaving the form as dead HTML. /firm/start and
// /firm/security/mfa carry this same line for this same reason.
export const dynamic = "force-dynamic";

import { ForgotPasswordForm } from "./forgot-form";

export const metadata = { title: "Forgotten password" };

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <h1 className="font-heading text-2xl font-semibold text-brand">Forgotten password</h1>
      <p className="mt-1 text-sm text-ink-muted">
        We will email you a link that signs you in once, so you can set a new one.
      </p>
      <div className="mt-4">
        <ForgotPasswordForm />
      </div>
    </main>
  );
}
