// Who may act for me — the client's own view of every authority a firm has recorded over their
// files, and the button that ends one.
//
// This screen exists because an authority the client cannot see is not one they granted. The rows
// come back under RLS (representations_select admits the principal), and revoke_representation()
// admits the principal as well as the firm, so ending one here is the client's own act and not a
// request to anybody.

import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Screen, ScreenTitle } from "@/components/portal/screen";
import { supabaseServer } from "@/lib/supabase/server";
import { clientTimezone } from "@/lib/portal-data";
import { todayIn } from "@/lib/days";
import { AuthorityList } from "@/components/portal/authority-list";
import type { IdentityEventRow, RepresentationRow } from "@/lib/db/types";

export const metadata = { title: "Who may act for me" };

export default async function PortalAuthority() {
  const supabase = await supabaseServer();
  if (!supabase) {
    return <Screen><Alert kind="warning" title="Not configured">Supabase environment variables are not set.</Alert></Screen>;
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <Screen><Alert kind="warning" title="Sign in">Sign in to see this.</Alert></Screen>;

  const tz = await clientTimezone(supabase, user.id);
  const [{ data: rows, error }, { data: firmRows }, { data: idRows }] = await Promise.all([
    supabase.from("representations").select("*").eq("principal_id", user.id).order("created_at", { ascending: false }).limit(100),
    supabase.from("firms").select("id, name"),
    supabase.from("identity_events").select("*").eq("user_id", user.id).order("changed_at", { ascending: false }).limit(20),
  ]);
  const reps = (rows ?? []) as RepresentationRow[];
  const firms = new Map(((firmRows ?? []) as Array<{ id: string; name: string }>).map((f) => [f.id, f.name]));
  const events = (idRows ?? []) as IdentityEventRow[];

  return (
    <Screen>
      <ScreenTitle>Who may act for me</ScreenTitle>

      {error && (
        <Alert kind="error" title="This did not load">
          Nothing is shown because nothing could be read — this is not the same as nobody being authorised. Try again.
        </Alert>
      )}

      <Card>
        <CardHeader title="Authorities your firms have recorded" />
        {reps.length === 0 ? (
          <EmptyState
            title="Nobody else may act for you"
            hint="If a firm records that someone may act on your files — a company officer, a relative, an attorney under a power — it will appear here, and you can end it yourself."
          />
        ) : (
          <AuthorityList rows={reps} firms={Object.fromEntries(firms)} today={todayIn(tz)} />
        )}
        <CardBody className="border-t border-gray-100 text-xs text-gray-500">
          Ending an authority stops it at once. It cannot un-read a page or recall a document already
          downloaded. If you did not ask for one of these, end it and tell the firm.
        </CardBody>
      </Card>

      {events.length > 0 && (
        <Card>
          <CardHeader title="Changes to how you are reached" />
          <ul className="divide-y divide-gray-100">
            {events.map((e) => (
              <li key={e.id} className="px-4 py-3 text-sm text-gray-800">
                Your {e.field === "phone" ? "phone number" : "email address"} was changed
                {e.old_value ? <> from <span className="font-mono text-xs">{e.old_value}</span></> : null}
                {e.new_value ? <> to <span className="font-mono text-xs">{e.new_value}</span></> : null}
                {" "}on {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: tz }).format(new Date(e.changed_at))}.
              </li>
            ))}
          </ul>
          <CardBody className="border-t border-gray-100 text-xs text-gray-500">
            Your firms are told when this happens, and the old details are kept here. If one of these was not you,
            contact your firm on a number you already trust — not one shown on this screen.
          </CardBody>
        </Card>
      )}

      <p className="px-1 text-xs text-gray-500">
        <Link href="/app/profile" className="underline underline-offset-2">Your profile</Link> ·{" "}
        <Link href="/app" className="underline underline-offset-2">Home</Link>
      </p>
    </Screen>
  );
}
