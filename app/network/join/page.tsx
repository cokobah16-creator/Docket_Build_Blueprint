// /network/join?token=…: where a firm's official email lands when another firm invites it.
//
// Three states, each honest about what it is:
//  · nobody signed in: the code is for a signed in person, so sign in or register the firm first.
//    The token stays in the link; nothing is checked until somebody enters the code.
//  · signed in, no firm: register the firm, then come back with the code. The invitation is
//    verified by a member of the firm that answers it, so the order matters.
//  · signed in with a firm: enter the code; read who is asking and why; accept or decline as one
//    of the firms the person belongs to and holds invite_firms at. The database decides every step.
//
// RENDERED PER REQUEST, ALWAYS: it reads the session and the query string.

import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { loginPath } from "@/lib/auth-redirect-server";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { JoinForm } from "./join-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connect with a firm on Docket" };

export default async function NetworkJoinPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const validToken = typeof token === "string" && /^[0-9a-f]{64}$/.test(token) ? token : null;
  const supabase = await supabaseServer();

  const frame = (children: React.ReactNode) => (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-12">
      <p className="text-13 font-semibold uppercase tracking-wide text-brand-accent">Docket Network</p>
      <h1 className="mt-1 font-heading text-26 font-semibold text-brand">A firm has invited yours to connect</h1>
      <div className="mt-6">{children}</div>
    </main>
  );

  if (!supabase) {
    return frame(<Alert kind="warning" title="Not configured">Supabase environment variables are not set on this deployment. See <code>.env.example</code>.</Alert>);
  }
  if (!validToken) {
    return frame(
      <Alert kind="error" title="This link is not an invitation">
        An invitation link carries a token of sixty four characters. Open the link exactly as it was sent, or ask the inviting firm to send it again.
      </Alert>,
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const signIn = await loginPath("staff");
    return frame(
      <Card>
        <CardHeader title="Sign in first" />
        <CardBody className="space-y-3 text-15 text-ink">
          <p>
            The verification code in the email is entered by a signed in member of your firm, and an owner or administrator
            then decides whether to connect. Nothing happens until the code is entered.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href={signIn} className="inline-flex min-h-[44px] items-center rounded-lg bg-brand px-4 text-15 font-medium text-brand-on">Sign in</Link>
            <Link href={`/firm/start?next=${encodeURIComponent(`/network/join?token=${validToken}`)}`} className="inline-flex min-h-[44px] items-center rounded-lg border border-edge px-4 text-15 font-medium text-brand">Register your firm</Link>
          </div>
          <p className="text-13 text-ink-muted">
            The code expires seventy two hours after it was sent and locks after five wrong attempts. If it has expired, the inviting firm can send it again.
          </p>
        </CardBody>
      </Card>,
    );
  }

  // The firms this person belongs to, by name. firms_select is is_firm_member(id), so this is theirs alone.
  const { data: memberRows } = await supabase.from("firm_members").select("firm_id, role").eq("user_id", user.id);
  const memberships = (memberRows ?? []) as Array<{ firm_id: string; role: string }>;
  const ids = memberships.map((m) => m.firm_id);
  const { data: firmRows } = ids.length ? await supabase.from("firms").select("id, name, status, verified_at").in("id", ids) : { data: [] };
  const firms = ((firmRows ?? []) as Array<{ id: string; name: string; status: string; verified_at: string | null }>).map((f) => ({
    id: f.id,
    name: f.name,
    verified: f.status === "active" && Boolean(f.verified_at),
    role: memberships.find((m) => m.firm_id === f.id)?.role ?? "staff",
  }));

  return frame(
    <JoinForm token={validToken} firms={firms} email={user.email ?? null} registerHref={`/firm/start?next=${encodeURIComponent(`/network/join?token=${validToken}`)}`} />,
  );
}
