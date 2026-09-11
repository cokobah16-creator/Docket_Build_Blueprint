# Administrator's guide — setting your firm up on Docket

*For the owner of a firm, or whoever they have made an administrator. It covers everything you
change about your own firm, in the order it needs doing, and it says plainly what each change does
to your clients.*

Everything here is at **`/firm/admin`** in the console. If a screen does not offer you a form,
that is not a mistake in the screen: the database itself decides what you may change, and the
console declines to show a button it knows would be refused. Where it does refuse, you see the
database's own words, not a rewritten version of them.

---

## Before anything else: your second factor

**Every change a firm makes to itself requires two-factor authentication.** Not as policy — the
database checks it. A staff account without it can read everything it is entitled to and **write
nothing at all**, and every form will refuse.

Enrol an authenticator app at **`/firm/security/mfa`**. Do this first; several people lose an
afternoon to it.

If you are an owner or administrator of more than one firm on Docket, the console works on one
firm at a time and the address carries `?firm=<id>`. Each screen re-checks which firm you actually
administer.

---

## Where your firm stands

Open **`/firm/admin`**. It tells you, in one page, what your firm is today and what that means for
your clients. Three states:

| Status | What it means |
|---|---|
| **Pending** | You have registered and Docket has not yet verified you. **You can change everything** — this is the setup path — but your public site does not resolve and nobody can book |
| **Active** | Docket has checked your RC/BN number against CAC and your owners' enrolment numbers against the Roll of Legal Practitioners. Your site is live, your lawyers are listed, and bookings are open |
| **Suspended** | Every screen still **reads**, and **no form will save.** See the last section |

You cannot set your own status, plan, web address (slug) or custom domain. Those are Docket's, and
the database refuses a write to any of them with *status, plan, verification, slug and custom
domain are set by the platform*. There is no form for them, on purpose.

---

## 1. Publish your terms and your privacy notice

**`/firm/admin/settings` → Policies.** Do this before anything else that touches a client, because
**nobody can book you until it is done.** `book_appointment()` refuses with:

> this firm has not published its terms and privacy notice yet

### What "published" means

Every new firm starts with a skeleton whose version is `0-draft`. **A version that starts with
`0-` means not published.** Docket will not show a draft to a client and will not let a client
consent to one. Both documents — terms **and** privacy — must be published before a single booking
can be taken.

Each document has three things you fill in:

- a **version** — your own label for this edition, up to 40 characters. A date like `2026-09` works
  well;
- the **text**, or
- a **link** to where the document is published on your own site. The link must be `https://`.

Angle brackets are stripped from everything you type, and text is capped at 60,000 characters.
Docket stores four documents — terms, privacy, engagement and cancellation — and silently drops
anything else, so use those four.

### Changing a version is not a small thing

Read this twice.

**Every client of yours compares the version they accepted against the version you have published,
character for character. Change the version string and every one of them is asked to accept again
the next time they open the app — and they cannot use the portal until they do.**

That is the right behaviour: a client should agree to the terms you are actually operating on. But
it means:

- **Correcting a typo? Do not change the version.** Edit the text, leave the version string alone,
  and nobody is interrupted.
- **Changing what the document says? Change the version.** That is exactly when everyone should
  re-accept.

The screen asks you to tick a box confirming you understand, when a published version is about to
change. It is not a formality.

Every acceptance is recorded permanently: who, which firm, which document, which version, and
when. Nobody — not you, not Docket — can edit or delete one through the app. A client can see
their own list at any time under their profile.

---

## 2. Price a service and switch it on

**`/firm/admin/services`.**

Docket gives every new firm exactly one service — "Legal Consultation", **inactive and priced at
zero**. Until you price something and switch it on, your booking page has nothing to offer.

For each service you set:

- **name and description** — what the client is choosing;
- **price** — in naira and kobo, or dollars and cents. Zero is allowed and means free;
- **duration in minutes** — this decides the length of every slot offered;
- **whether payment is taken up front** — the usual answer is yes;
- **whether it can be done by video**;
- **which category of lawyer** takes it, if you use categories;
- **active or not.**

Your VAT rate (**Settings → Operations**) is applied on top at booking, and the screen shows you
the figure the client's invoice will actually carry — worked out exactly the way the booking does
it, so there are no rounding surprises.

**Four things must all be true before a client can book:**

1. terms and privacy published (§1);
2. at least one **active** service;
3. a Paystack subaccount stored, if that service is prepaid and priced (§4);
4. a lawyer with a working week (§6).

The services page tells you which of these is missing.

---

## 3. Ask the right questions at booking

**`/firm/admin/intake`.**

An intake form is the set of questions a client answers between choosing a time and paying. Keep it
short. Every answer is personal data you will hold, and a long form loses bookings.

- A form with **no service attached** is your firm's default, used for anything without its own.
- A form **attached to a service** replaces the default for that service.
- Two live forms aimed at the same service means one of them is never asked. The screen says so.

Each question has a key, a label, a type, whether it is required, and — for choice questions — its
options. A question can be made to appear only when an earlier answer has a particular value.

**Ask for what you need to advise, and nothing more.** There is no validation in the database on
what an intake form contains: whatever you ask for, Docket stores, and it becomes part of what you
must protect and what you must produce if the client asks for a copy.

Answers arrive with the booking and sit on the appointment, readable by your firm and by the client
who wrote them, and nobody else.

---

## 4. Getting paid

**`/firm/admin/settings` → Settlement.**

**Docket never holds your money.** Every card payment routes straight to your own Paystack
subaccount, and the processing fee is borne by that subaccount. Docket's Paystack account is a
router, not a purse.

To set it up:

1. Ask Docket to create a **Paystack subaccount** against your firm's bank account. You will be
   given a subaccount code.
2. Paste the code into **Settlement** and save. **Only you can do this** — an owner or an
   administrator of your firm. A Docket operator cannot write it for you.

Until the code is there, a priced prepaid booking is refused with:

> this firm is not yet set up to receive payments

**If the code is wrong**, something worse than a refusal happens, and it is worth understanding.
Docket checks every successful charge against *your* subaccount code. A payment that Paystack
reports against a different account is recorded as a **failed** payment, flagged, written to the
audit trail, and **you are notified** — and the invoice stays unpaid and the appointment stays
unconfirmed. That is deliberate. A charge that did not reach your account has not paid anybody, and
confirming a consultation off the back of it would be a lie to your client. Check the code and tell
Docket.

### Invoices and VAT

- Your **VAT rate** (Settings → Operations) is applied to consultation fees at booking and to any
  invoice you raise by hand.
- Your **reference prefix** — the letters at the front of a reference such as `XY-2026-000123` — is at Settings → Operations and
  becomes **fixed as soon as your firm issues its first reference**. The screen locks it then, and
  the reason is arithmetic, not caution: references are numbered per firm per year, and changing
  the prefix mid-year leaves one year's numbering carrying two different prefixes. Choose it at
  the start.
- A **paid or part-paid invoice cannot be cancelled** — the database refuses with *a part-paid or
  paid invoice cannot be cancelled — raise a credit note*. Only an owner or an administrator can
  cancel even a draft.

---

## 5. Your people, and what each of them may do

**`/firm/admin/people`.**

Four roles:

| Role | Can |
|---|---|
| **Owner** | everything an administrator can, plus appoint and stand down other owners |
| **Administrator** | the whole console, plus settings, services, intake, people, the audit trail and cancelling invoices |
| **Lawyer** | the console — matters, clients, consultations, invoices, court updates, their own diary. Not settings, not people, not the audit trail. Can acknowledge process served on the firm |
| **Staff** | the console, for the day-to-day work. Not settings, not people, not the audit trail, and **cannot acknowledge service** — that is a practitioner's act |

### Adding somebody

Docket **does not send the invitation for you**, and this is not an omission: an invitee has no
account yet, so there is nowhere to send it. You create the invitation, Docket hands you the link,
and you send it — WhatsApp, email, however you normally reach them.

1. Enter their **email address** and choose a role. **Only an owner may invite another owner.**
2. Copy the link and send it.
3. They open it, sign in or sign up **with that same email address**, and they are in. The address
   is matched against the one their sign-in provider gives, never a typed one, so an invitation
   cannot be redirected. A mismatch is refused with *this invite was sent to a different email
   address*.
4. Invitations last 14 days.

Lawyers, administrators and owners get a private practitioner profile to complete — title, bio,
practice areas, enrolment number, year of call, NBA branch, stamp and seal serial. It stays
private until they publish it.

### Changing somebody's role

Four rules, held by the database rather than by the screen:

- **you cannot change your own role** — ask another owner;
- **only an owner can appoint or stand down an owner**, in either direction;
- **the firm's last owner is protected** — appoint another owner first;
- and the person must actually be a member of your firm.

### Removing somebody

Removing a colleague does three things at once, and the screen counts them for you **before** you
press the button:

- their **availability is deleted**, so their bookable week disappears;
- their **public profile is unpublished**, so they come off your website;
- their **membership is removed**.

And one thing it refuses to do: **a lawyer with consultations still to come cannot be removed.** You
will see, word for word:

> that lawyer has 3 consultation(s) still to come — reassign or cancel them first

Reassign or cancel each one, then remove them. This exists so that no client is ever left holding a
confirmed appointment with a lawyer who no longer works for you.

---

## 6. When your lawyers are available

**`/firm/availability`.**

A lawyer sets their own working week; an owner or administrator may set anybody's.

For each weekday: a start and end time, an optional break, the slot length, and a cap on how many
consultations to take that day. **Days off and one-off changes** go in as exceptions.

Two things worth knowing:

- **Times are in the lawyer's own timezone**, and every slot the client is offered is converted
  into the client's. Nobody has to do the arithmetic.
- Docket never offers a slot **less than two hours away**, so nobody is ambushed by a booking for
  the next ten minutes.

The screen shows you exactly what the booking engine would offer today, so an empty week is
obvious before a client finds it.

---

## 7. Your name on it

**`/firm/admin/settings` → Brand.**

Your logo, your colours, your fonts, your tagline, the words on your booking button, and the
contact details shown on your public site.

**Docket keeps only what it can render safely, and drops the rest without complaining.** It keeps:

- the **tagline**, the **call-to-action** wording and the **logo** — up to 200 characters each, and
  no angle brackets;
- three **colours** — primary, accent and surface — each a six-digit hex code such as `#1c3f5e`.
  Anything else, including a colour name or a three-digit code, is dropped;
- two **font names** — heading and body — letters, digits and spaces only, up to 40 characters;
- four **contact** fields — email, phone, address and WhatsApp — up to 200 characters each.

Anything else you send is discarded silently by the database. So that you are never misled, the
settings screen **re-reads your firm after saving and tells you exactly what was rejected.** If
something you typed is not on the page afterwards, that message says why.

---

## 8. Your own web address

**`/firm/admin/settings` → Domain.**

Every firm gets `yourslug.docket.app` from the start. If you would rather use your own —
`chambers.example.ng` — you **ask** for it here and Docket maps it. You cannot set it yourself, and
neither can Docket set it by accident: two systems have to agree, the hosting edge and the
database, and the request keeps its own trail so you can see where it got to.

- Give the **bare hostname**. No `https://`, no trailing slash, no port. The refusal says so:
  *give the bare hostname you want, for example chambers.example.ng — no https://, no trailing
  slash*.
- A hostname already in use on Docket is refused.
- You will be given **DNS records to add at your registrar**. They appear on this screen, so you do
  not have to chase them.
- You may **withdraw** a request while it is still open.

Your `yourslug.docket.app` address keeps working throughout.

---

## 9. The words your clients receive

**`/firm/admin/settings` → Messages.**

Docket writes every confirmation, reminder, invoice notice and court-date alert in plain English
and signs it with your firm's name. If you would rather say it your way, you can replace the
sentence for any event.

- Replace only the events you care about. **Anything you leave alone keeps Docket's wording** — an
  empty list is the normal state, and no client is ever left without a message.
- You can replace the **subject line** as well, or leave Docket's and change only the sentence.
- Use `{braces}` for the details: `{firm}`, `{when}` (the time, in the reader's own timezone),
  `{reference}`, `{invoice_number}`, `{amount}` (already carrying its currency). Anything else in
  the message's details is available by its own name.
- A placeholder Docket does not recognise is **left exactly as you typed it** in the message — so a
  mistake shows up where you can see it, rather than being silently blanked.
- Subject lines are capped at 200 characters and the sentence at 1,000. Angle brackets are stripped.
  An entry with an empty sentence is dropped.

The events you can override include: consultation confirmed; the 24-hour, 1-hour and 10-minute
reminders; consultation moved; consultation cancelled; a new invoice; payment received; an update
on a matter; court date in three days; court date tomorrow; and a new message.

Your client also controls their own side of this: which events reach them, on which of push, email
and SMS, and quiet hours during which nothing but the imminent reminders will disturb them.

---

## 10. The audit trail

**`/firm/admin/audit`.** Owners and administrators only — a lawyer or a staff member sees nothing
here, and the screen says so rather than looking empty.

Every significant act against your firm, newest first, in the database's own words: who did it,
when, and what changed. **Nothing can edit or delete a line of it**, including Docket.

There is no filter by action or type, deliberately: filtering would read your firm's whole history
on every page, and a slow screen is worse than a plain one. The page paginates from the newest
backwards, and states at the foot which tables it does and does not cover — worth reading before
you conclude anything from a silence.

---

## 11. If your firm is suspended

Docket can suspend a firm. When it does:

- **every screen still reads.** Your matters, clients, invoices, documents and timeline are all
  there, and nothing is deleted;
- **no form will save.** Not settings, not services, not intake, not people, not a court update,
  not an invoice. The database's write gates all check that your firm is not suspended, so every
  write refuses at once rather than one form at a time;
- the console degrades to read-only and tells you why, rather than showing you forms that would all
  fail;
- your public site and bookings are closed.

The remedy is with Docket, not in the console. Your data is untouched throughout.

---

## Quick reference — where things are

| Want to | Go to |
|---|---|
| See where the firm stands | `/firm/admin` |
| Publish terms and privacy | `/firm/admin/settings` → Policies |
| Set VAT, timezone, currency, reference prefix | `/firm/admin/settings` → Operations |
| Enter the Paystack subaccount | `/firm/admin/settings` → Settlement |
| Change logo, colours, fonts, contact details | `/firm/admin/settings` → Brand |
| Ask for a custom domain | `/firm/admin/settings` → Domain |
| Change the wording of client messages | `/firm/admin/settings` → Messages |
| Record the firm's address for service | `/firm/admin/settings` → Service of process |
| Price and activate services | `/firm/admin/services` |
| Write the booking questions | `/firm/admin/intake` |
| Invite, promote or remove colleagues | `/firm/admin/people` |
| Read the audit trail | `/firm/admin/audit` |
| Set a lawyer's working week | `/firm/availability` |
| Enrol two-factor | `/firm/security/mfa` |

## Related

- `docs/ONBOARDING_A_FIRM.md` — the same ground from Docket's side, including registration and
  verification.
- `docs/CLIENT_GUIDE.md` — what your clients see. Worth reading once.
- `docs/RPC_REFERENCE.md` — every rule the database holds, and the exact words it refuses with.
