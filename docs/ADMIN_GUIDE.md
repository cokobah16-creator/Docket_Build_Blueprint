# Administrator's guide — setting your firm up on Docket

*For the owner of a firm, or whoever they have made an administrator. It covers everything you
change about your own firm, in the order it needs doing, and it says plainly what each change does
to your clients.*

Everything here is at **`/firm/admin`** in the console. If a screen does not offer you a form,
that is not a mistake in the screen: the database itself decides what you may change, and the
console declines to show a button it knows would be refused. Where it does refuse, you see the
database's own words, not a rewritten version of them.

---


## Your checklist

**`/firm/admin`** opens with three states — *Site published*, *Bookable*, *Payment-ready* — and
the list of steps behind them, in the order the booking engine checks them. Every line is a fact
read from the database when the page opens, never a box someone ticked: publishing the policies
turns the line green because they are published. A step your firm will not do — a settlement
account when you take payment in chambers, a domain of your own — can be **set aside** with a
note; that is kept in the audit trail with your name, and the step can be put back.

Two steps only a practitioner can do themselves: their **profile** on the firm's site (from
**Me**, with the switch that lets clients book them) and their **working week** (from
Availability). Both on the same lawyer: the booking page lists public profiles and offers the
times on that lawyer's own week, so hours on one colleague and a public profile on another give a
visitor a name and no time. The checklist counts only lawyers who have both.

**Payment-ready** means invoices can be paid: any priced service that is on raises an invoice at
booking, and an invoice is paid through Docket only into the settlement account — a service that
asks for payment first is refused at booking until the account is set, one paid afterwards is
booked and its invoice waits. Set the step aside only if you truly take every payment in chambers.

## Bringing existing matters in

**`/firm/admin/import`** takes a CSV export of your spreadsheet, one matter per row. You say what
each column means, the screen shows what will happen row by row — an unknown status, a lawyer
who is not a member, an unreadable date, a file that already looks like a matter on the books —
and then the database files them a batch at a time, each row on its own, so one bad row never
stops the rest. The result page is the reconciliation: how many filed, left out, refused,
invitations to send and accepted, clients not invited; every row with its reason; and a results
file to download.

- **Dates are kept.** `opened_on` and `closed_on` are the days on the file, not today. Your old
  file number is kept beside the Docket reference, and the same number is never imported twice.
- **The reference prefix locks at the first matter.** Check it under Settings → Operations
  before you import.
- **Clients are never made up, and never linked by a number in a file.** Every client row becomes
  an invitation you send yourself, offered on the result page until they accept — a client already
  on Docket accepts it with their account. A colleague's number is refused as a client.
- **Nothing is invented for the client to read.** The import posts one internal note per matter;
  the client sees the timeline as the firm keeps it once they join.
- **With conflict checks required**, every matter comes in and no invitation is made until a check
  on that matter is cleared; the row says so, and you invite from the matter once it is.
- **A phone Docket cannot read is said, not guessed.** `0803 000 0000` or `+234…` are read; a
  number a digit short, or a landline, is kept in the row's note as *client not invited* so you
  can invite them from the matter with the right number.
- **If the connection drops while the file is going up**, nothing is filed: the database refuses
  to file a batch it has not seen whole. The wizard offers **Retry from where it stopped** into
  the same batch, or **Discard this batch**; an unfinished batch on the imports list says how many
  rows arrived and offers the same discard. A batch that has begun filing is never discarded — it
  is the record.

Only an owner or an administrator can import. The columns are listed, with a template, at
`/firm/admin/import/template`.

## Before a consultation

**Settings → Before a consultation** is off by default: a booking is confirmed the moment it is
made or paid, as it always was. Switched on, every booking is **held** — the time is the
client's, the slot is taken — until you confirm it, and the database refuses the confirmation
until what you asked for is in:

- the fee, but only where the service is one you are **paid in advance for**. A service you
  settled to be paid later, or in chambers, is not turned into a pay-first one by switching this
  on: the booking is not held for a fee you have not asked for yet;
- the questions your intake form marks required (a client who skipped one answers it in their
  app, on the consultation, without redoing the rest);
- any document you asked for **on the consultation** (the consultation page → Ask the client for
  a document; the client sees the request and uploads against it);
- your terms and privacy notice, at their current versions;
- and, where you require conflict clearance before taking a client on, a cleared check on the
  consultation (run it from the consultation page; the client sees only that you have checks to
  finish, never what they found).

The consultation page shows every item and its state, and **Confirm the consultation**. The
client is told the booking is held, is reminded two days out of anything still missing, and the
lawyer is told a day out that it is theirs to confirm. A held booking nobody confirms by the time
it is due is released; a fee already paid on it is **not** refunded by Docket — refund it yourself.

## Matter walls

By default every member of your firm can open every matter — the stance most partnerships want,
and the one Docket started with. **Settings → Matter walls** switches on the option to restrict a
matter to its team.

- A matter is restricted from its **Edit** tab, by someone on its team. If you are not on the team
  yet, the button puts you on it and restricts in one step — a wall you are outside of would lock
  you out of the file.
- Once restricted, the matter and everything on it — documents (the files themselves, not only
  the list), messages, the timeline, tasks, court dates, parties, counsel, process served, invoices
  — can be opened only by the people on its team. **Owners and admins are not exempt.** The client
  on the matter sees exactly what they saw before.
- Anyone on the team can add colleagues to it or open the matter to the whole firm again. The last
  person on a restricted matter's team cannot be removed: nobody could open the file.
- Walls cannot be switched off while any matter is still restricted. Open those matters first, one
  by one, so no file is quietly opened to the whole firm by a checkbox.

This is enforced by the database, not by the screens: a restricted matter is invisible to a
colleague outside its team through every door, including a direct request to the API.

## Asking a client for a document

A matter's **Documents** tab has a panel, **Asked of the client**. Name the document, say why if it
helps, and give a day it is needed by. The client is told, sees the request on their own Documents
tab with an **Upload this** button, and their upload answers it: the request shows *answered*,
with the file, and whoever asked is told it arrived.

- A request is answered once. A second file on the same subject is just another document.
- You may **withdraw** a request while it is open. Requests are never deleted: what was asked for
  is part of the file's history, withdrawn or answered.
- On a restricted matter, requests are behind the wall like everything else on it.

## When the connection drops

A court update posted from a corridor, a note, a message, a document request: each is kept on the
device as you type it, and offered back when you open the same form again on that device. A form
that lost its reply can be sent again safely — Docket recognises the posting it already made and
does not make a second timeline entry, court event, request or client notification. While you are
offline the console says so in the corner and the send buttons wait.

**One thing to know if you correct something before re-sending.** A send whose reply never arrived
may in fact have gone through. So if you change anything — the outcome, the next date, the words to
the client — before trying again, Docket treats it as a new posting rather than the same one,
because the old one may already be on the timeline and cannot be edited. Re-send unchanged and it
lands once; correct it first and you may get both, the original and the correction. Look at the
timeline after a dropped connection before you retype.

An upload that stopped part-way leaves a document with no file. It is listed, but it answers no
request and the client cannot open it. **Finish upload** beside it completes it — from any device,
not only the one that started it; **Remove** retires it if you would rather start again. Drafts
live on the device, not in Docket: they are not backed up, they are not visible to anyone else,
and they are cleared when you sign out.

## Conflict checks

Docket keeps, per matter, a register of **the other side** — the opposing party, co-parties,
witnesses, related companies, with their other spellings — on the matter's **Parties** tab and on
the form that opens a matter. The client never sees it.

A **conflict check** searches your firm's own register: every client on your books, every other
side you have recorded, the cause titles, across every other matter, closed ones included. Run it
from the Parties tab of a matter (it checks everyone the matter names) or while opening one (it
checks the client and the other side you typed). It never searches another firm's records, and
another firm never searches yours.

- What comes back is a list of matches, each saying where the name was found and how closely it
  matched. A match on a matter you are walled out of says only that a match exists and who leads
  that matter, so you can ask.
- **You decide, once**: *clear*, *conflict*, or *waived* with the reason. The decision is recorded
  with your name and the time, and the search results stay with it. To change your mind, run a
  new check.
- **Settings → Conflict checks** is off by default: checks are advisory and recorded. Switched on,
  Docket refuses to put a client on a matter — when it is opened, by invitation, or any other
  way — until the latest decided check on that matter is clear or waived. A contact may still be
  invited. A check that found a conflict blocks until a later one clears it.

Docket never decides a conflict. It finds the names and keeps the record of who decided what.

## Where a court date came from

Every court date now records who entered it and when. A date that came from the court — a hearing
notice, the cause list — should carry its evidence: on the matter's **Deadlines** tab, beside each
open date, **Attach the notice or reference** takes the notice as a document on the matter and/or
the reference on it (the cause-list date and item, say). A date with evidence attached shows as
*from the court, notice on file*, on the sittings page and to the client; one marked as from a
notice with nothing attached shows as exactly that; everything else is *as recorded by the firm*.
Attaching the evidence records you as the lawyer who confirmed the date. The diary is audited:
a date made, moved, vacated, closed or evidenced leaves a line in your audit trail.

## Your workflow: stages, and the work each starts

**`/firm/admin/workflow`** shows the stages a matter moves through — the label your client reads,
the order, which matter types each is offered on — and the packs Docket publishes. A **pack** is a
numbered version of a set of stages and the task templates each stage starts; Docket ships
*Litigation* (the fifteen stages every firm begins with — installing it recognises yours as they
are) and *Conveyancing* (for property matters), and publishes new versions as practice suggests.
Installing a pack **adds** the stages you lack and **never rewrites** the ones you have: your
wording, colours and order stay, and no matter is moved. Installing a newer version adds only.
An owner or administrator can also edit a stage's wording, colour, order and the next action it
suggests; the key underneath never changes.

Changing a matter's stage (on its Details tab) is now one act: the client sees a *Status* entry
on the timeline, with the line you add; a closing stage closes the file today and leaving it
reopens the file; the stage's suggested next action is offered where the slot is empty; and every
task the stage starts in your installed packs is added to the matter's Tasks — once. Setting the
same stage twice never doubles the list. Tasks a pack started say so, with the stage that started
them, and are yours to reassign or close like any other.

## Deadlines

A deadline is counted by Docket, shown day by day, and confirmed by a lawyer. On a matter's
**Deadlines** tab, **Add a deadline** asks for the triggering event (a judgment, a ruling, an
order, service, a hearing, a filing — or pick a sitting from the timeline and both are filled in),
the day it happened on the court's calendar, and the rule. The rules offered are the ones Docket's
platform has entered for that court's level and state, in force on that day, counting from that
event; **Count it** shows the day due and everything the count did — days not counted because the
court does not sit or because time stopped for a vacation, days rolled past, and what reference
data it relied on. If no vacation calendar is entered for the court, the count says so in words
rather than pretending: check the practice direction. Without a rule, give the day yourself and
the row says it is the firm's own date.

- **A deadline is proposed until a lawyer confirms it.** Anyone on the matter can count one; an
  owner, admin or lawyer confirms it, once, and the reminders (a week out, the day before, the
  day) go to the matter's lawyers only from then.
- **Nothing is edited.** A recount is a new row that supersedes the old one, which stays with its
  own calculation. A deadline that no longer applies is discharged with a note.
- **The rule is kept as it read.** A later correction to the rule on Docket never changes a
  deadline already counted; its name, citation and version are on the row.
- **The client never sees a deadline.** Court dates reach the client; deadlines, and the notes on
  them, are the firm's work product.

Docket counts; it does not decide. The rules on Docket are those the platform has entered from
the Rules of Court, with their citation and version, and a court's own practice can differ — the
confirming lawyer is confirming the day, not the arithmetic.

## The baseline: measuring before you claim a saving

**`/firm/admin/baseline`** shows what your own records say over a window you choose — the last
week, month, quarter or half-year — and lets an owner or administrator **record** one.

What it shows, all of it computed from your rows: consultations booked, paid and attended; how many
consultations were followed by a matter, and how long that took; what share of your sittings the
client heard about, and how many within a day; how long a client waited for a first reply, and how
long the oldest unanswered message has been waiting; documents asked for and sent in; invoiced and
collected, per currency, and how long a fee took to collect; open matters and overdue next actions;
and how many clients used the app.

**Three things it will not do**, and they are the point of the screen:

- **It never guesses at attendance.** Docket marks a consultation completed when you save its
  notes, so one held in chambers and never written up is shown as *never written up* — its own
  number, in no attendance rate. If that number is large, the rate above it means little, and the
  screen says so rather than flattering you.
- **It says which figures are inferences.** Nothing in Docket joins a consultation to the matter it
  became; "followed by a matter" means the same client had a matter opened within sixty days. It is
  printed with that sentence beneath it.
- **It keeps your own account of the past separate.** When you record a baseline you may write down
  what the firm says about how the work went *before* Docket — hours a week chasing court dates,
  how long a client used to wait. Those are stored as **your statement, with your name and the
  date**, beside the computed figures and never inside them. Docket cannot measure the years before
  it existed and will not pretend to.

**Record one before you change how the firm works.** A baseline is a dated row that nobody can
edit afterwards — not you, not Docket, not an administrator. That is what makes it worth comparing
against. Without one, any later claim that Docket saved the firm time is a guess with a number
attached to it.

## Documents you draw up, and how they are executed

**`/firm/admin/templates`** holds your firm's templates. A template is the words, plus the
`{placeholders}` Docket fills from the matter itself when a document is generated — the matter's
reference and title, the suit number and court, the client's name and address, the handling
lawyer's name and enrolment number, your firm's name and address, today's date. The editor lists
every placeholder you may use; anything else is refused when you save, not later when a document
is being drawn. For a value that belongs to that one document rather than the matter — a fee, a
period, a property description — write `{extra.fee}` and Docket asks you for it each time you
generate.

Say how the instrument is executed: **signed in Docket**, **executed on paper**, or **either**.
A deed, or anything that needs a witness, attestation, stamping or registration, is executed on
paper — Docket will refuse to send it for signature, and offers to record the execution instead.

**Generating one.** On the matter's Documents tab, *Generate a document* from a template that fits
the matter's type. Docket fills it and, **if the matter has no value for something the template
names, refuses and says which** — it does not guess and does not leave a blank for you to miss.
Fill the gap on the matter and generate again. What is produced is a PDF with the document and
version recorded against it, kept staff-only until you share it.

**Asking for a signature.** *Ask the client to sign* shares the document and tells the matter's
clients. They open it, read it, and sign by typing their name.

**What a signature on Docket is.** It records: who signed, the name they typed, the exact version
and the checksum of its bytes, that they opened those bytes before signing, and when. A signature
is refused if they have not opened the document, or if the name typed is not the name on their
profile. Once signed, the document is **locked on that version** — no further version can be added
and the file cannot be removed. A change is a new document. Your firm can countersign the same
version, and your enrolment number is recorded with it.

**Executed on paper.** Upload the signed copy as a version in the usual way, then *Record execution
on paper*: the day on the instrument, the witness, who attested it, the stamp duty and registration
references. That locks the document on that version and tells the client. Docket does not claim the
signature happened here; it records that it happened, and what it happened to.

**One caution about typefaces.** The PDF Docket generates uses the standard Latin typeface, so a
character it cannot print stops the generation and names itself rather than being printed as a
question mark. If a client's name or an address needs a character outside it, draft that document
outside Docket and upload it.

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
| **Active** | A Docket platform administrator has reviewed your RC/BN number and your owners' enrolment numbers and activated the firm. **Docket does not itself check either against CAC or the Roll of Legal Practitioners** — nothing in the platform can, and no screen should tell a client it did. Your site resolves and your lawyers are listed. **Bookings open only once you have published your terms and privacy notice** (Settings → Policies): `book_appointment()` refuses every booking for a firm whose policies are unpublished, active or not |
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
| Hold bookings until you confirm them | `/firm/admin/settings` → Before a consultation |
| Ask a client for a document before a consultation | the consultation → Before the consultation |
| See the checklist and set a step aside | `/firm/admin` |
| Bring existing matters in from a spreadsheet | `/firm/admin/import` |
| Publish your own profile so clients can book you | `/firm/me` |
| Ask the client for a document | the matter → Documents → Asked of the client |
| Record the other side, run a conflict check | the matter → Parties |
| Require a cleared check before a client joins | `/firm/admin/settings` → Conflict checks |
| Read the audit trail | `/firm/admin/audit` |
| Set a lawyer's working week | `/firm/availability` |
| Enrol two-factor | `/firm/security/mfa` |

## Related

- `docs/ONBOARDING_A_FIRM.md` — the same ground from Docket's side, including registration and
  verification.
- `docs/CLIENT_GUIDE.md` — what your clients see. Worth reading once.
- `docs/RPC_REFERENCE.md` — every rule the database holds, and the exact words it refuses with.
