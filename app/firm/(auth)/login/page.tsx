// Staff sign-in. The form is a client component (staff-login-form.tsx); this page's job is to
// read where the caller was going before the console's gate turned them away.
//
// RENDERED PER REQUEST, because of that parameter — it used to be one of the three prerendered
// shells in src/lib/csp.ts, and reading a search param takes it out of that set. It is now
// served the strict nonce policy like every other console screen.

import { safeNext } from "@/lib/auth-redirect";
import { StaffLoginForm } from "./staff-login-form";

export const metadata = { title: "Staff sign-in" };

export default async function StaffLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // Checked here as well as where it was written: a redirect target read back off a URL is
  // exactly the shape an open redirect takes.
  const next = safeNext((await searchParams).next);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <StaffLoginForm next={next} />
    </main>
  );
}
