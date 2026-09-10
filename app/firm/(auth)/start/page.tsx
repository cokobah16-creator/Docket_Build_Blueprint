// Self-serve firm registration: any Nigerian law firm opens its own tenant
// here — the same path tenant #1 took, minus the seed file.

import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { Alert } from "@/components/ui/alert";
import { FirmStart } from "./firm-start";

export const metadata = { title: "Register your firm" };

export default async function FirmStartPage() {
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { count } = await supabase
      .from("firm_members")
      .select("firm_id", { count: "exact", head: true });
    if ((count ?? 0) > 0) redirect("/firm");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-12">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand-accent">Docket</p>
      <h1 className="mt-1 font-heading text-2xl font-semibold text-brand">Register your firm</h1>
      <p className="mt-1 text-sm text-gray-600">
        Two steps: your account, then your firm. You become the firm’s owner and
        set up two-factor authentication before the console opens. Your public
        site and bookings go live once Docket has verified the firm (RC/BN number
        and the owner’s enrolment number); the console is yours right away.
      </p>
      <div className="mt-6">
        <FirmStart signedIn={Boolean(user)} email={user?.email ?? null} />
      </div>
    </main>
  );
}
