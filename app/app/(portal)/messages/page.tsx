import Link from "next/link";
import { redirect } from "next/navigation";
import { loginPath } from "@/lib/auth-redirect-server";
import { supabaseServer } from "@/lib/supabase/server";
import { selectedFirm } from "@/lib/portal-firm";
import { clientThreads } from "@/lib/portal-threads";
import { ThreadList } from "@/components/portal/thread-list";
import { buttonClasses } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { Screen, ScreenTitle } from "@/components/portal/screen";
import { ListDetail } from "@/components/shell/layout";
import { firmPageHref } from "../firm-href";

export const metadata = { title: "Messages" };

export default async function MessagesPage() {
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(await loginPath("client"));
  const firm = await selectedFirm(supabase);
  const { threads, timezone } = await clientThreads(supabase, user.id, firm?.id);
  // A booking is what gives a client with no matter their first conversation, so it is the one
  // action an empty list offers. It goes to the firm's own booking page (firm-href.ts).
  const bookHref = firm ? await firmPageHref(firm, "/book") : null;

  return (
    <Screen>
      <div>
        <ScreenTitle>Messages</ScreenTitle>
        {/* Said once, here, rather than again in the list, the pane and a footnote. */}
        <p className="mt-1 max-w-[60ch] text-15 text-ink-muted">
          Each matter and consultation has its own private conversation. Only {firm?.name ?? "your firm"} and the
          people on that matter or consultation can read it.
        </p>
      </div>
      {/* On a phone this is the whole screen; from 1024px the list keeps its
          column and the right-hand side says what to do with it. */}
      <ListDetail
        listIsScreen
        list={
          <ThreadList
            threads={threads}
            timezone={timezone}
            userId={user.id}
            emptyHint={`A conversation appears here when ${firm?.name ?? "your firm"} opens a matter for you, or confirms a consultation you booked.`}
            emptyAction={
              bookHref && (
                <Link href={bookHref} className={buttonClasses("primary", "md")}>
                  Book a consultation
                </Link>
              )
            }
          />
        }
        detail={
          <Card className="grid min-h-[320px] place-items-center">
            <EmptyState
              title="No conversation open"
              hint={threads.length > 0 ? "Choose one from the list. It opens here." : "When you have a conversation, it opens here."}
            />
          </Card>
        }
      />
    </Screen>
  );
}
