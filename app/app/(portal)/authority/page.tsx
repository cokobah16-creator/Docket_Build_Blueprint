// Who may act for me: the client's own view of every authority a firm has recorded over their
// files, and the button that ends one.
//
// This screen exists because an authority the client cannot see is not one they granted. The rows
// come back under RLS (representations_select admits the principal), and revoke_representation()
// admits the principal as well as the firm, so ending one here is the client's own act and not a
// request to anybody.

import { WorkspaceUnavailable } from "@/components/ui/unavailable";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loginPath } from "@/lib/auth-redirect-server";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Screen, ScreenTitle } from "@/components/portal/screen";
import { supabaseServer } from "@/lib/supabase/server";
import { clientTimezone } from "@/lib/portal-data";
import { todayIn } from "@/lib/days";
import { whenWords } from "@/lib/notifications-copy";
import { AuthorityList } from "@/components/portal/authority-list";
import type { IdentityEventRow, RepresentationRow } from "@/lib/db/types";

export const metadata = { title: "Who may act for me" };

const footLink =
  "inline-flex min-h-11 items-center font-medium text-ink underline underline-offset-2 " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export default async function PortalAuthority() {
  const supabase = await supabaseServer();
  if (!supabase) {
    return <Screen><WorkspaceUnavailable audience="client" /></Screen>;
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(await loginPath("client"));

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
        <Alert kind="error" title="This list did not load">
          Nothing is shown because nothing could be read. That is not the same as nobody being authorised. Refresh the page to try again.
        </Alert>
      )}

      <Card>
        <CardHeader title="Authorities your firms have recorded" />
        {/* A list that failed to load is not an empty one, so it never says "nobody". */}
        {error ? null : reps.length === 0 ? (
          <EmptyState
            title="Nobody else may act for you"
            hint="If a firm records that someone may act on your files, such as a company officer, a relative or someone holding your power of attorney, it appears here. You can end it yourself."
          />
        ) : (
          <AuthorityList rows={reps} firms={Object.fromEntries(firms)} today={todayIn(tz)} />
        )}
        <CardBody className="space-y-1.5 border-t border-hairline text-13 text-ink-muted">
          <p>Ending an authority stops it at once. It cannot undo what was already read, or recall a document already downloaded.</p>
          <p>If you did not ask for one of these, end it and tell the firm.</p>
        </CardBody>
      </Card>

      {events.length > 0 && (
        <Card>
          <CardHeader title="Changes to how you are reached" />
          <ul className="divide-y divide-hairline">
            {events.map((e) => (
              <li key={e.id} className="px-4 py-3 text-15 text-ink">
                Your {e.field === "phone" ? "phone number" : "email address"} was changed
                {e.old_value ? <> from <span className="font-mono text-13">{e.old_value}</span></> : null}
                {e.new_value ? <> to <span className="font-mono text-13">{e.new_value}</span></> : null}
                {" "}on {whenWords(e.changed_at, tz)}.
              </li>
            ))}
          </ul>
          <CardBody className="space-y-1.5 border-t border-hairline text-13 text-ink-muted">
            <p>Your firms are told when this happens, and the old details are kept here.</p>
            <p>If one of these changes was not you, call your firm on a number you already trust, not one shown on this screen.</p>
          </CardBody>
        </Card>
      )}

      <nav aria-label="More from your account" className="flex flex-wrap gap-x-5 px-1 text-13">
        <Link href="/app/profile" className={footLink}>Go to your profile</Link>
        <Link href="/app" className={footLink}>Back to home</Link>
      </nav>
    </Screen>
  );
}
