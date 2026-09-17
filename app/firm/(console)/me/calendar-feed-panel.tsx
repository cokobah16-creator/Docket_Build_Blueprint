"use client";

// The subscribed calendar URL: issuing one, rotating it, and ending it.
//
// The URL is shown ONCE, at the moment the database mints it, and never again — only its hash is
// kept, so a database dump is not a set of working feeds. Rotating is issuing another, which stops
// the old one the same second: that is what a person who has lost a phone actually wants.
//
// The screen holds no rule. issue_calendar_feed() asks staff_w() and takes no user parameter, so
// there is no way to ask for somebody else's diary from here or from anywhere.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatWhen } from "@/lib/time";
import { issueCalendarFeed, revokeCalendarFeed } from "@/lib/actions/calendar-feed";
import type { CalendarFeedStatus } from "@/lib/db/types";

export function CalendarFeedPanel({ firmId, feed, feedBase, timezone }: {
  firmId: string;
  feed: CalendarFeedStatus | null;
  /** `https://<project>.supabase.co/functions/v1/calendar-feed` — the token is appended once, here. */
  feedBase: string | null;
  timezone: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"issue" | "revoke" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [names, setNames] = useState(feed?.include_client_names ?? false);

  async function issue() {
    setBusy("issue"); setError(null); setUrl(null);
    try {
      const r = await issueCalendarFeed(firmId, names);
      if ("error" in r) { setError(r.error); return; }
      setUrl(feedBase ? `${feedBase}/${r.token}` : r.token);
      router.refresh();
    } catch { setError("Nothing was issued — the connection may have dropped. Try again."); }
    finally { setBusy(null); }
  }

  async function end(id: string) {
    setBusy("revoke"); setError(null); setUrl(null);
    try {
      const r = await revokeCalendarFeed(id);
      if (r?.error) setError(r.error); else router.refresh();
    } catch { setError("Nothing changed — the connection may have dropped. Try again."); }
    finally { setBusy(null); }
  }

  return (
    <Card>
      <CardHeader title="My diary in my own calendar" />
      <CardBody className="flex flex-col gap-3 text-13 leading-[1.55] text-[#57534E]">
        {error && <Alert kind="error" title="That was refused">{error}</Alert>}

        {url && (
          <Alert kind="success" title="Copy the address now — it is not shown again">
            <p className="text-15">
              Add it in your calendar as a <strong>subscribed calendar</strong> (Google: Other calendars →
              From URL; Apple: File → New Calendar Subscription; Outlook: Add calendar → Subscribe from web).
              It refreshes itself.
            </p>
            <code className="mt-2 block break-all rounded-lg bg-raised px-2 py-1.5 font-mono text-11 text-ink">{url}</code>
            <p className="mt-2 text-13">
              Anyone holding this address reads your diary, so treat it as a password. Only its hash is
              stored here; if you lose the phone it is on, come back and replace it — the old one stops
              working that second.
            </p>
          </Alert>
        )}

        <p>
          Your court sittings, your own consultations and your confirmed deadlines, in the calendar you
          already use. It is <strong>read only</strong>: nothing you do in that calendar reaches Docket, and
          moving a court date is still something only Docket &mdash; and the court &mdash; can do.
        </p>
        <p>
          It never carries a note, a message, a document or an amount, and a matter walled to a team you are
          not on does not appear in it.
        </p>

        {feed ? (
          <div className="rounded-lg border border-[#DDD9D2] bg-[#FAFAF9] px-3 py-2.5">
            <p className="text-13 font-semibold text-[#141414]">A calendar URL is live</p>
            <p className="mt-0.5 text-13">
              Issued {formatWhen(feed.created_at, timezone)} ·{" "}
              {feed.last_used_at ? `last fetched ${formatWhen(feed.last_used_at, timezone)}` : "never fetched yet"}
            </p>
            <p className="mt-0.5 text-13">
              Client names are <strong>{feed.include_client_names ? "included" : "not included"}</strong>.
            </p>
            <Button size="sm" variant="ghost" className="mt-2" pending={busy === "revoke"} disabled={busy !== null && busy !== "revoke"} onClick={() => void end(feed.id)}>
              Turn it off
            </Button>
            <p className="mt-1.5 text-11">
              To change the client-names setting, or to cut off a lost phone, issue a new address below:
              the one you are using now stops working the same second.
            </p>
          </div>
        ) : null}

        <label className="flex items-start gap-2 text-13 text-[#141414]">
          <input type="checkbox" className="mt-1" checked={names} onChange={(e) => setNames(e.target.checked)} />
          <span>
            <span className="font-medium">Include client names</span>
            <span className="mt-0.5 block text-13 text-[#57534E]">
              Off by default, deliberately. A feed address ends up in a phone&rsquo;s settings and in a
              calendar provider&rsquo;s fetchers, and a client&rsquo;s name on a stolen phone says more than
              the matter reference does. The reference, the court and the time are enough to work from.
            </span>
          </span>
        </label>

        <div>
          <Button size="sm" pending={busy === "issue"} disabled={busy !== null && busy !== "issue"} onClick={() => void issue()}>
            {feed ? "Issue a new address with these settings" : "Create my calendar URL"}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
