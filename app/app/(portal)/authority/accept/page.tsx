// Where somebody authorised to act for a client redeems their one-time link.
//
// accept_representation() decides everything: the token must be unused and unexpired, the caller
// must not be the client themselves nor a member of the firm, and — where the firm recorded who it
// was inviting — the caller must BE that person, signed in as themselves. Holding the link is not
// enough, and holding the phone number is not enough. Both refusals are the database's own words.

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
          <p className="text-sm text-gray-700">
            A firm has recorded that you may act for one of its clients. Taking it up here binds it to
            <em> this</em> account, and the client is told. You will be able to read the matters it covers and
            write to the firm about them — and only what the firm listed: it may or may not include documents or
            money, and it never includes signing anything.
          </p>
          <div className="mt-3"><AcceptAuthorityForm token={sp.token ?? ""} /></div>
        </CardBody>
        <CardBody className="border-t border-gray-100 text-xs text-gray-500">
          If you were not expecting this, do not take it up — tell the firm on a number you already have for them.
        </CardBody>
      </Card>
      <Alert kind="info">
        Signed in as somebody else? Sign out and back in as the person the firm named. An authority follows a
        person, not a link.
      </Alert>
    </Screen>
  );
}
