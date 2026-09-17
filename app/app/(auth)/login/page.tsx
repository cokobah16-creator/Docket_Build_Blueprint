// Client sign-in: phone OTP (primary for Nigerian clients) or email magic link. No passwords
// for clients; Supabase Auth issues the session and RLS does the rest.
//
// WHY THIS PAGE READS THE URL. Docket sends people to individual pages — a pay-by-link off an
// invoice, a notification about a message, an invitation to a matter. Each of those lands on a
// page that checks the session, and src/lib/auth-redirect-server.ts sends whoever has none here
// with ?next= on the end. Honouring it is the difference between "sign in and pay this invoice" and
// "sign in and find the invoice again yourself".
//
// RENDERED PER REQUEST, because of that parameter. It used to be one of the three prerendered
// shells in src/lib/csp.ts; reading a search param takes it out of that set, which also means it
// is now served the strict nonce policy like everything else.

import { safeNext } from "@/lib/auth-redirect";
import { callbackMessage, callbackTitle } from "@/lib/auth-errors";
import { ClientLoginPanel } from "./client-login";

export const metadata = { title: "Sign in" };

export default async function ClientLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const params = await searchParams;
  // Validated on arrival as well as on the way out: by the time it is here it is a query
  // parameter, which is to say it is whatever the browser sent, and an unchecked redirect
  // target is an open redirect.
  const next = safeNext(params.next);
  // Why the last attempt did not work, when it was a sign-in link that brought them back here.
  // A key, never a sentence: app/auth/callback/route.ts puts it on the URL and this looks it up,
  // so nothing GoTrue said ends up in browser history or a Referer header.
  const problem = callbackMessage(params.reason);
  // The heading has to move with the sentence. Google comes home to the same callback as the
  // emailed link, and "That link did not sign you in" over a paragraph about a Google consent
  // screen is a heading contradicting its own paragraph.
  const problemTitle = callbackTitle(params.reason);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <ClientLoginPanel next={next} problem={problem} problemTitle={problemTitle} />
    </main>
  );
}
