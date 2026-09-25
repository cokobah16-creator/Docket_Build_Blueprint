import { redirect } from "next/navigation";
import { loginPath } from "@/lib/auth-redirect-server";
import { supabaseServer } from "@/lib/supabase/server";
import { selectedFirm } from "@/lib/portal-firm";
import { clientThreads } from "@/lib/portal-threads";
import { ThreadList } from "@/components/portal/thread-list";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Screen, ScreenTitle } from "@/components/portal/screen";
import { ListDetail } from "@/components/shell/layout";

export const metadata = { title: "Messages" };

export default async function MessagesPage() {
  const supabase = await supabaseServer();
  if (!supabase) redirect("/app/login");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(await loginPath("client"));
  const firm = await selectedFirm(supabase);
  const { threads, timezone } = await clientThreads(supabase, user.id, firm?.id);

  return (
    <Screen>
      <ScreenTitle>Messages</ScreenTitle>
      {/* On a phone this is the whole screen; from 1024px the list keeps its
          column and the right-hand side says what to do with it. */}
      <ListDetail
        listIsScreen
        list={<ThreadList threads={threads} timezone={timezone} userId={user.id} />}
        detail={
          <Card className="grid min-h-[320px] place-items-center p-8 text-center">
            <div className="max-w-xs">
              <Icon name="mail" size={28} className="mx-auto text-ink-disabled" />
              <p className="mt-3 text-15 font-semibold text-ink">
                {threads.length > 0 ? "Choose a conversation" : "No conversations yet"}
              </p>
              <p className="mt-1 text-13 leading-relaxed text-ink-muted">
                Each matter and consultation has its own private thread. Only {firm?.name ?? "your firm"} and the people on that matter or consultation can read it.
              </p>
            </div>
          </Card>
        }
      />
      <p className="text-11 leading-relaxed text-ink-muted lg:hidden">
        Each matter and consultation has its own private thread. Only {firm?.name ?? "your firm"} and the people on that matter or consultation can read it.
      </p>
    </Screen>
  );
}
