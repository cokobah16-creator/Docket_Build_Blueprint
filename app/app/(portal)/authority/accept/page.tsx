// Where somebody authorised to act for a client redeems their one-time link.
//
// accept_representation() decides everything: the token must be unused and unexpired, the caller
// must not be the client themselves nor a member of the firm, and, where the firm recorded who it
// was inviting, the caller must BE that person, signed in as themselves. Holding the link is not
// enough, and holding the phone number is not enough. AcceptAuthorityForm says each refusal again
// in the client's words, keeping the database's meaning.

import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Screen, ScreenTitle } from "@/components/portal/screen";
import { AcceptAuthorityForm } from "@/components/portal/accept-authority-form";

export const metadata = { title: "Accept an authority" };

export default async function AcceptAuthority({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const sp = await searchParams;
  return (
    <Screen>
      <ScreenTitle>Act for a client</ScreenTitle>
      <Card>
        <CardHeader title="Take up this authority" />
        <CardBody>
          {/* What taking it up means comes before the button (docs/VOICE.md, rule 16). */}
          <div className="space-y-2 text-15 text-ink">
            <p>A firm has recorded that you may act for one of its clients.</p>
            <p>If you take it up here, it is tied to the account you are signed in with now, and the client is told.</p>
            <p>You will be able to read the matters it covers and write to the firm about them.</p>
            <p>You can do only what the firm listed. That may or may not include documents or payments. It never includes signing anything.</p>
          </div>
          <div className="mt-4"><AcceptAuthorityForm token={sp.token ?? ""} /></div>
        </CardBody>
        <CardBody className="border-t border-hairline text-13 text-ink-muted">
          If you were not expecting this, do not take it up. Tell the firm, on a number you already have for them.
        </CardBody>
      </Card>
      <Alert kind="info" title="Signed in as somebody else?">
        Sign out, then sign in again as the person the firm named. An authority is for a person, not for whoever holds the link.
      </Alert>
    </Screen>
  );
}
