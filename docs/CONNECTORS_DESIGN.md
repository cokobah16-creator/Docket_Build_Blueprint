# Connectors — what is built, and what must be decided before the rest is

*13 September 2026. A design document, not a description of working software. One section describes
something that exists; the rest is a proposal with questions in it.*

The assessment's #20 asks for calendar, email and document connectors, and gives the rule that
governs all three: **one connector at a time, and define the system of record per field before
syncing anything two-way.** This document honours that order. The one-way connector is built. The
two-way ones are designed here and are not built, because the decisions below are not mine to take
and building first would be taking them by default.

---

## 1. Built: the calendar feed (one-way, out)

**What it is.** Each member of a firm can issue themselves a subscribed calendar URL. Their court
sittings, their consultations and their confirmed deadlines appear in whatever calendar they already
use — on their phone, in Outlook, in Google Calendar — refreshing itself, with no OAuth application,
no client secret, and nothing for Docket to register with anybody.

**Why this shape.** A Google or Microsoft integration needs an OAuth app, a consent screen,
refresh-token storage, and an answer to "what happens when the lawyer edits the copy in their own
calendar". An ICS feed needs a URL and answers that last question by construction: nothing flows
back, so nothing can conflict. It is the smaller thing that works today rather than the larger thing
that needs credentials nobody has yet.

**What it carries, and what it does not.**

| | |
|---|---|
| Court sittings | purpose, matter reference, court, suit number, judge |
| Consultations | the member's own only, by reference, with mode and service |
| Deadlines | **confirmed** ones only, as all-day entries on the day they fall |
| Client names | **off by default** — a deliberate choice, made once, per feed |
| Never | a note, a message, a document, an amount, or anybody else's diary |

**The security properties**, all asserted in `supabase/tests/99_calendar_feed.sql`:

- The token is hashed like an API key, shown once, and rotating is issuing another — which revokes
  the old URL the same second.
- **The matter wall holds inside it.** `can_see_matter()` asks about `auth.uid()`, and there is no
  session when a calendar app fetches a URL, so `calendar_feed_events()` writes the same test out
  against the feed's owner by name. A sitting on a matter restricted to a team they are not on is
  absent from their feed. This is the one place the wall is stated twice, and it is called out in
  the migration for that reason.
- A member who leaves the firm has no diary, whatever URL they still hold.
- A suspended firm's feeds stop with it.
- Client names are off unless deliberately turned on: a feed URL ends up in a phone's settings and a
  provider's fetchers, and *"R v Adebayo, 10am"* on a stolen phone says more than a firm may wish.

**What it is not.** It is not a Google Calendar connector. A lawyer cannot create a Docket court
date by making an event in their own calendar, and nothing they change there reaches Docket. That is
section 2.

---

## 2. Not built: calendar write-back

The obvious next ask — "let me move a court date from my phone" — is the first place the
system-of-record question bites, and it bites hard.

**The problem.** A court date is not a meeting. It is set by a court, recorded with provenance
(migration 38 stores who entered it, from what notice, and whether it is evidenced or merely
claimed), and a lawyer moving it in Google Calendar has not moved anything at all — the court has
not been told. Write-back would let a calendar app silently overwrite a fact whose whole value is
that it came from somewhere.

**Per-field system of record, proposed:**

| Field | System of record | Why |
|---|---|---|
| `scheduled_at` of a court event | **Docket, always** | It is the court's date. A change is `refixed_to`, with a reason and provenance, not an edit |
| Consultation time | **Docket, always** | Moving it re-runs availability, the hold, the notice to the client. A calendar cannot do those |
| Deadline `due_on` | **Docket, always** | Computed from rules with a recorded calculation. A calendar edit would silently break the audit trail |
| The lawyer's own private events | **Their calendar** | Docket has no business holding them and does not |

Which is to say: **the honest answer for write-back is that there is nothing to write back.** Every
field a calendar could change is one Docket must own. What a lawyer actually wants — "I am busy
then" — is *availability*, and Docket already models that (`availability_rules`,
`availability_exceptions`).

**So the real question, and it is a product one, not a technical one:**

> **Q1.** Should Docket read a lawyer's *free/busy* from their own calendar, so booking does not
> offer a slot when they are already engaged elsewhere?

That is one-way *in*, needs no write-back, and is genuinely useful. It also needs OAuth, per-user
tokens, a refresh loop, and a decision about what happens when the connection lapses — does the
diary silently open up again, or does booking stop? **Q2:** which?

---

## 3. Not built: email into the matter file

**What it would be.** Correspondence about a matter, filed against it, so the file is complete.

**Why it is not a small thing.** Every mechanism has a serious defect:

| Mechanism | Defect |
|---|---|
| Per-matter forwarding address | The address is a bearer credential. Anyone who learns it can put a document on a client's file, and nothing about an SMTP envelope proves who sent it |
| Full mailbox sync (OAuth) | Docket would hold a lawyer's entire mailbox, including everything about every other client and everything personal. That is a far larger disclosure than the product currently makes, and a far larger thing to lose |
| A plugin the lawyer clicks | Honest and narrow, but it is a desktop and mobile add-in per mail client — a bigger build than everything in Wave 4 combined |

**Questions before anything is built:**

> **Q3.** Is the deliverable "file this one email" (a click, per email) or "keep the file complete"
> (a sync)? They are different products.
>
> **Q4.** If a sync: does the firm accept that Docket then holds mail unrelated to any matter, and
> what is the retention rule for what it filed by mistake?
>
> **Q5.** A forwarding address puts an unauthenticated write on a client's file. Is that acceptable
> with a per-matter secret and a quarantine — nothing appears on the file until a lawyer accepts it
> — or not at all?

My recommendation, for what it is worth: **Q3 = the click.** Narrow, honest, no mailbox held, and it
matches what Docket already does everywhere else — a person decides, and the decision is recorded.

---

## 4. Not built: document storage connectors

**What it would be.** A firm's documents living in their Google Drive or SharePoint, with Docket
referencing rather than holding them.

**Why it conflicts with something already decided.** Docket's document model rests on things a
reference cannot provide: `document_versions.checksum` is what a signature is *over* (migration 40),
`document_reads` is the door the storage policy requires before any bytes move (migration 30), and
the storage manifest verifies the bytes still hash to what the row says (migration 28). A document
in somebody's Drive can be edited by anybody with the link, at any time, with no version, no
checksum and no read record. A signature over such a thing is evidence of nothing.

**Per-field system of record, proposed:**

| | System of record |
|---|---|
| Anything signed, executed, served or filed | **Docket. Not negotiable** — the checksum is the point |
| Working drafts before execution | The firm's Drive, if they want, with Docket holding a link and saying plainly that it is a link |
| The final version of anything | **Docket** |

> **Q6.** Is a link-only "working drafts" connector worth building at all, given it must be labelled
> everywhere as *not* a Docket document — no checksum, no read record, no signature?

My recommendation: **no, not yet.** It adds a second class of document that looks like the first and
is not, and the first thing a firm would do is try to sign one.

---

## 5. What I would build next, in order

1. **Q1/Q2: free/busy in.** Real value, one-way, no system-of-record conflict. Needs an OAuth app
   and the lapse decision.
2. **Q3: file-this-email, by a click.** Narrow, honest, no mailbox held.
3. Nothing else until a firm asks for it by name.

Everything in sections 2–4 stays unbuilt until the questions above are answered. The plan's rule was
right: defining the system of record first is what stops a connector from quietly becoming the place
the truth lives.

---

## Related

- `supabase/migrations/20260910000047_calendar_feed.sql` — the built connector
- `supabase/functions/calendar-feed/index.ts` — what serves it
- `src/lib/ics.ts`, `scripts/check-ics.ts` — the writer, and what is asserted about it
- `supabase/tests/99_calendar_feed.sql` — the wall, the rotation, the leaver, the client's name
- `docs/CLIENT_MONEY_DESIGN.md` — the same shape of document, for the same reason
