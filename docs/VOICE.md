# How Docket talks to clients

The words on every screen a **client** sees: the portal (`app/app/`), a firm's public site
(`app/(public)/[firm]/`), and the notifications a client receives. The staff console keeps its own,
denser register and is not covered here.

Docket is "Powered by AK". Attorneys Klinique writes to its clients in a voice that is calm, warm,
short and plain about money, and that voice is the one Docket's client screens use. What a screen
**looks** like stays Docket's own: `DESIGN.md` governs layout, colour, type and components, and wins
wherever the two seem to disagree on those. This document governs **tone and wording**, and wins on
those.

Every firm on Docket speaks through these screens, so nothing here is Attorneys Klinique's alone: a
firm's name, number, policies and prices always come from its data, never from the code.

## The rules

1. **One idea per sentence, in plain words.** Say what is happening and what happens next. No
   fragments joined with "·" for anything a person has to read as a sentence.
   *"Do not miss the date. Missing it can mean a judgment or a warrant against you."*

2. **"You" for the client; the firm by name.** Call the client "you". Anything only the firm can do
   (confirm, refund, check a payment) is said with the firm's name: "Attorneys Klinique will confirm
   your booking." Docket's portal serves several firms, so "we" is never the firm. Buttons may say
   "my": "Add these dates to my calendar".

3. **Warm and calm.** Thank people. Greet them by first name ("Good morning, Ada"), never by an email
   address or phone number. Never alarm, never blame, never cheer. No exclamation marks.

4. **Never show a code.** No enum values, IANA zone names, provider names in the raw, or system words
   (`awaiting_payment`, `Africa/Lagos`, `succeeded`, `virtual`). `src/lib/client-words.ts` turns each
   code into words, in one place, so a status reads the same on every screen.

5. **Lead with what, who and when.** "Consultation with Ada Obi, Wednesday 4 November 2026 at 10:00 WAT".
   A reference number comes last, with a label, if at all.

6. **Money: who is paid, for what, and how the total is made.** Wherever a client pays, the
   `BeforeYouPay` register (`src/components/portal/before-you-pay.tsx`) answers all three before the
   button. Its figures come from `buildBreakdown()` (`src/lib/payment-breakdown.ts`), which is also
   what the pay actions charge, so the amount shown is the amount charged.

7. **Only lines that exist.** No "VAT ₦0", no "Paid ₦0" before anything is paid, no processing-fee
   row nobody is charged. A free consultation says "Nothing to pay", never "₦0".

8. **Naira as people write it.** "₦32,250". Kobo only when there are kobo ("₦30,558.38"). When any
   amount in a breakdown has kobo, every amount in it and its pay button show kobo, so a round fee
   there reads "₦28,425.00"; anywhere else, never a trailing ".00". Never "NGN" on a screen (the PDF
   writer cannot draw "₦" and is the one exception). The exact amount goes on the pay button:
   "Pay ₦32,250".

9. **After a payment attempt, say whether money moved and what happens next.** Never invite a second
   payment while one is being confirmed: "Paystack is confirming your payment. This page updates by
   itself, so there is no need to pay again." If something went wrong after money may have left the
   account, say who can sort it out: "If money left your account, message Attorneys Klinique with your
   bank reference."

10. **Waits.** Say how long, what happens meanwhile, and whether the client must do anything. Name
    the actual step: "Opening Paystack…", not "Taking payment…".

11. **Dates and times.** "Wednesday 4 November 2026", 24-hour "10:00", and always the zone: "10:00 WAT".
    Short forms ("Wed 4 Nov") only where space is tight.

12. **Errors.** Say what was not done, whether anything was saved or charged, and what to do next.
    Never pass raw error text through (`userError()` / `userErrorMessage()`, `DESIGN.md`). A message
    that travels in `?error=` must also be in `KNOWN_NOTICES` (`src/lib/user-error-message.ts`), word
    for word, or the client sees a generic sentence instead.

13. **Empty states.** "No X yet." Then what will appear here, and one action that fills it. No icon,
    no encouragement (`EmptyState`).

14. **Buttons and links: verb first, the thing named, sentence case.** "Book a consultation",
    "Message your lawyer", "Pay ₦32,250", "See what they need". Not "Message", "Details", "All",
    "Book a Consultation". A disabled button says what is missing, right under it.

15. **One main action per screen.** One filled button: the thing this screen is for, right now.
    Everything else is a ghost button or a text link, and secondary detail folds into a `Disclosure`.

16. **Show the consequence before the tap.** Cancelling, paying and agreeing say what follows first:
    "Cancelling does not refund you automatically. Any refund is Attorneys Klinique's to make."

17. **Legal caution.** General information is labelled as such: "This is general information, not
    legal advice." Use "can" and "may" rather than verdicts. Any statement of the law (for example
    "police bail is free by law") is kept to what is settled and is reviewed by a lawyer before it
    ships.

18. **Nigerian English.** British spelling (organisation, cancelled, centre). Local names people know:
    WAT, 112, EFCC, CAC, the Legal Aid Council, USSD, business day. Phone numbers as "0803 123 4567"
    or "+234 814 321 2579". Say "Paystack", not "the payment provider".

19. **One word per thing.** "Consultation" is the meeting, "booking" is the reservation. Client labels
    say "Consultations" even where the route is `/appointments`.

20. **Lock screens stay private.** A push notification says that something happened, never an
    amount, a matter title or a name.

21. **House style.** No contractions ("do not", "you are"). No em dashes in client copy. "Sign in" as
    a verb; "sign-in" only as an adjective ("sign-in link"). Numerals for time, money and counts.
    Avoid: webhook, subaccount, configured, provider, issued, "raises an invoice", "Failed to…".

## Where the two documents meet

- **Icons** decorate nothing: `DESIGN.md` wins. An icon marks an action, such as "Call 112".
- **Status** goes through `StatusPill`, or `MatterStatusChip` for a firm's own matter stages
  (`DESIGN.md`). Appointment and invoice words come from `clientStatusLabel()`.
- **Tabs** are underlined strips, never pills, whatever the label says.
- **Warmth** (thanks, greetings) is tone, so this document wins over `DESIGN.md`'s "no encouragement",
  which is about cheering, not courtesy.

## Strings tests depend on

Some client wording is asserted by tests. Change it only together with the test.

- `tests/e2e/smoke.spec.ts`: the sign-in heading matches /sign in/i; the "Phone" and "Email" tabs
  and the field label "Email address"; the button "Email me a sign-in link" and the text "We sent a
  sign-in link to…"; no field labelled /code from the email/i; on a firm's site, the first link to
  /{slug}/book is the header's, and the header's first link does not read "sign in"; a `tel:112`
  link on Urgent help.
- `tests/integration/journeys.spec.ts`: the "Phone" tab and fields labelled /phone/i and /code/i;
  the buttons "Send code" and "Verify and continue"; on /app, the firm switcher is the first button
  matching /firm|switch/i, so keep its hidden "Switch firm" and let no earlier button contain
  "firm" or "switch" ("Confirm" included); the first button matching /send/i on a thread is the
  composer's; the client not-found page (`app/app/not-found.tsx`) keeps a phrase matching
  /not found|no longer|don't have access|not available/i; and no link on a matter page except a
  document's may match /download|open|view/i (the journey clicks the first one; the default tab has
  none today, so that journey skips).
- `tests/fixtures/composer.mjs`: the Send button.
- `tests/fixtures/navigation.mjs`: "More" and "More destinations".
