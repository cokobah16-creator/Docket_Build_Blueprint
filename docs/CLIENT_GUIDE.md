# Client's guide — using Docket to work with your lawyer

*For a client of a firm that works on Docket. It covers signing in, booking and paying for a
consultation, joining it, following your matter, and — just as importantly — what your firm can
and cannot see, and what Docket's own operators can see.*

Docket is built for a phone. Everything below works in a phone browser, and you can add it to your
home screen so it opens like an app.

---

## Signing in

**There is no password.** You sign in with a one-time code or link sent to your phone or email,
so there is nothing to remember.

Go to **`/app/login`** (or follow the link your firm sent you) and choose:

- **Phone** — enter your number, and a six-digit code arrives by SMS. Type it in and you are in.
  This is the usual way for Nigerian numbers.
- **Email** — enter your address and a sign-in link arrives. Open it on the same device.

Use the number or address your firm already has for you. If a code does not arrive, wait a moment
and ask again — but ask your firm to check the number they hold before you try many times.

### Adding Docket to your home screen

On Android, your browser will offer to install it. On an iPhone, Safari does not offer, so do it
yourself: tap the **Share** button, then **Add to Home Screen**. It then opens full-screen, like
any other app.

### If your data is expensive

There is a **low-data** switch in the app. With it on, documents and images do not download until
you tap them. It is remembered on that device.

If you lose signal mid-way, the app shows a plain offline page rather than a broken one, and a
small **Offline** mark in the corner while it lasts. A message you were typing is kept on that
device until you send it: open the thread again and it is there, with the files you attached (each
was uploaded the moment you attached it, so it is already safe). An upload that stopped
can be finished from the same Documents tab — you will see **Finish upload** beside it, on any
device — or removed if you would rather start again. Nothing is sent twice: a message that did go
through before the reply was lost is recognised, not repeated. If you change the message before
sending it again, it is treated as a new one, because the first may already have reached your firm
and a message cannot be unsent.

---

## Agreeing to your firm's terms

You are asked to accept **that firm's** terms of service and privacy notice in two places: on the
last step of booking a consultation (see *Booking a consultation*), and when you open the
portal for that firm. The portal asks only if you have not already accepted the versions the firm
has published, so if you accepted them when you booked, it does not ask again. You cannot go
further until you do — and that is the point: you should know what you are agreeing to before your
lawyer starts work.

A few things worth knowing:

- **You are never shown a draft.** Until a firm has published real documents, no client is asked to
  agree to anything, and no booking can be taken.
- **Each version is recorded separately** — which document, which edition, and the moment you
  accepted it. You can see your whole list at any time under **What you have agreed to** on your
  profile.
- **If the firm changes a document, you will be asked again.** That is not a glitch. It means the
  document has actually changed, and you are agreeing to the new one rather than being assumed to.
- **The record cannot be edited or deleted through the app or its API.** Not by you, not by the
  firm. It can only be added to. It is deleted along with your account, or the firm's, if either
  is deleted.

You accept each firm's documents separately. Working with two firms on Docket means two sets.

---

## Booking a consultation

From your firm's website, choose **Book a consultation** (a firm can word that button its own
way). There are four short steps, or five if the firm asks you some questions first:

1. **Service** — what you need, how long it takes, and what it costs. Where the firm charges
   VAT, the price shown already includes it and says "including VAT". A free consultation says
   "Nothing to pay".
2. **How you meet** — video, in person, or by phone. Only the options that firm offers appear.
3. **Day and time** — the lawyer, then a day, then a time. The times you are offered are real:
   Docket has already checked that lawyer's working hours, breaks, days off, existing appointments
   and daily limit. **They are shown in your own timezone**, not the firm's, so there is nothing to
   convert. Nothing less than two hours away is offered.
4. **Details** — the firm's questions, if it asks any. Answer what you can; only the questions
   marked required must be filled in.
5. **Check and book**, or **Check and pay** when you pay now. For a paid consultation a
   **Before you pay** box shows who you are paying, the fee, the VAT if the firm charges it, and
   the total, worked out exactly as the invoice will be. If you are not signed in yet, you sign in
   right there, under **Sign in to book**, without losing your place. If the fee is paid in
   advance, the button reads **Book and pay** with the total. If the firm invoices it after
   booking, nothing is paid there: the box is headed **What you will pay** and the button reads
   **Book this consultation**, as it does for a free one.

   Just above the button are two boxes: one to accept the firm's terms of service, and one to say
   you have read its privacy notice. Each shows the version you are accepting. The name of each
   document is a link that opens it in a new tab, so you keep your place. Neither box is ticked for
   you, and the button stays off until you tick both. Your acceptance is recorded when you press
   the button, before anything is booked. If the firm has published a new version since the page
   was loaded, nothing is recorded or booked, and you are asked to reload the page and read the new
   version. If the firm has not published its terms and privacy notice yet, there are no boxes: a
   note says the firm cannot take bookings online, and the button stays off.

### Before your consultation

Some firms hold a booking until they confirm it. If yours does, your consultation page marks it
**Held** and lists what is still needed: paying the fee, answering any question the
firm's form requires, sending a document the firm asked for, accepting the firm's terms and
privacy notice. Each has its action on the page. Anything the firm has to do on its own side is
shown only as that. You are reminded two days before if something is still missing; the firm
confirms the booking from its side, and you are told when it does.

### Paying

If the consultation is paid in advance, your slot is **held for fifteen minutes** while you pay.
You go to Paystack's own checkout page — Docket never sees your card — and come back when it is
done. If the invoice turns out to be for a different total from the one you were shown, you go to
your consultation page instead, so you can check the amount before you pay. You also go there, and
not to checkout, if the booking turns out to need payment now when the page said it would not, or
the other way round. The consultation page says which. Wherever you pay, the same **Before you
pay** box comes first, and the amount on the button is the amount Paystack asks you for.

**The money goes to your firm**, into its own account. Docket does not hold it.
Your firm pays Paystack's processing fee, so nothing is added to the total you were shown.

**Paying by bank transfer?** Paystack shows an account number that is for that one payment only.
Send the exact amount to it from your bank app. It can take a few minutes to confirm, so do not pay
again while you wait, or you will pay twice.

Your consultation is confirmed **when Paystack tells Docket the payment succeeded**, not when the
page finishes loading. If you have paid and the app has not caught up, wait a minute and refresh
before worrying. Your reference number is on your consultation page.

If you do not pay within fifteen minutes the hold is released and the time goes back to whoever
wants it, and you can simply book again. Do not finish a payment after that: the money still
reaches the firm, and only the firm can refund it.

If the firm invoices the fee after booking, you book without paying. The invoice for the total is
raised at once, and you find it on your consultation page and under **Payments**.

If the consultation is free, it is confirmed straight away.

### Changing or cancelling

You can cancel a consultation you have booked, as long as it has not started. Cancelling does
not refund a payment by itself: any refund is the firm's to make. If your firm has published a
cancellation policy, it appears when you book and with the consultation, and usually on the
firm's terms page too; otherwise ask the firm.

To **move** a consultation, ask the firm: rescheduling is theirs to do, so that the new time is
checked against the lawyer's diary properly.

---

## A video consultation

From an hour before the start time, your consultation page offers **Join the waiting room**. The
room itself opens ten minutes before the start, and a reminder is sent then.

1. **Join the waiting room.** Check your camera and microphone there — the time to find out the
   microphone is off is before, not during. If your network is weak, you can join with **audio only**.
2. **Your lawyer lets you in.** The room is private and knocks: nobody wanders in, and there is no
   permanent link anybody could pass around.
3. **Talk.** You have your camera, your microphone, screen sharing if you need to show something,
   and chat.

Two things to be clear about:

- **Docket does not turn recording on.** It never asks the video service to record your room. If
  you want to know whether your firm records calls in some other way, ask it.
- **The room expires an hour after your consultation ends.** The link cannot be reused afterwards.

Afterwards, your lawyer writes up a summary. **You see that summary** on your consultation page.
Your lawyer may also keep private working notes — see below.

---

## Following your matter

Once your firm opens a matter for you, **`/app/matters`** is where you follow it. Each matter has:

- **A timeline** — everything that has happened, newest first: hearings and what came of them,
  filings, correspondence, documents, fee entries, changes of status (a *Status* entry says the
  stage your matter moved to, with a line from your firm where they wrote one). This is the part that means
  you do not have to ring and ask.
- **Documents** — what your firm has shared with you, and anything you upload.
- **Messages** — a thread with your firm about that matter.
- **Court dates** — when your matter is next in court, for what, and where.

**`/app/court-dates`** gathers every court date across every matter and every firm you work with.
Each says where it came from: *Fixed by the court. The notice is on file.* when your firm has
attached the court's notice, *Listed by the court registry and confirmed by your lawyer.*, or
*Recorded by* your firm. A date the registry has vacated is taken off the list and out of the
calendar file; the timeline keeps what happened.
**Add these dates to my calendar** on that page downloads those dates as a calendar file you can
import into your own calendar. It adds the dates **as they are today, not a live feed**: if a date
is moved, add them again (the same date is updated, not doubled). The app itself always shows the
current dates, and tells you three days and one day before.

### What you are told, and when

Docket sends you a message when something happens: a consultation confirmed, reminders 24 hours, an
hour and ten minutes before, a consultation moved or cancelled, a new invoice, a payment received,
an update on your matter, a court date in three days, a court date tomorrow, a new message, and a
document your firm has asked you for.

**You control which of these reach you.** In **Notification preferences** (from Notifications,
**Change preferences**), choose the events you want and whether each comes by push notification,
email or text message (SMS). You can also set **quiet hours** — nothing
will reach you during them except the reminder 10 minutes before a consultation, which will, because
by then you want it.

Two messages always arrive whatever you choose: the one telling you your consultation is ready to
join, and every in-app notice, which waits quietly in the app rather than interrupting you.

---

## Money

**`/app/payments`** shows every invoice from every firm you work with: what is outstanding, what is
paid, and what is overdue. Amounts are kept in their own currency and never added together across
currencies.

- You see an invoice **only once the firm has issued it.** A draft is the firm's working document
  and is not yours to see.
- Open an invoice to pay it. It shows the same **Before you pay** box as booking does: who you
  are paying, what for, the VAT, what has been paid so far and what is left. Again: straight to
  the firm's account.
- A payment marked **Not added to this invoice** means money left your account but was not counted
  against this invoice. Message your firm with your bank reference, so they can find it and put it
  right.
- Every invoice can be downloaded for your records: **Download invoice (PDF)**, or **Download
  receipt (PDF)** once it is paid.

---

## What your firm can see, and what it cannot

Worth saying plainly.

**Your firm can see:** your name and contact details, your consultations, the answers you gave at
booking, your matters and everything on them, documents on your matters, your messages, your
invoices and payments, and when you accepted its terms.

**Your firm cannot see:** anything belonging to another firm. Not your matters with them, not your
consultations, not your documents, not your invoices. If you work with two firms on Docket, neither
knows the other exists. This is enforced by the database itself on every single read — not by the
app remembering to ask.

**Docket's operator screens do not show your case.** Not the documents, not the messages, not the
timeline, not what an invoice is for, and not what any notification said. Those screens are about
firms: whether a firm is active and verified, how many open matters it has, and whether its
messages are failing. For a payment that has not gone through, they also show the invoice number
and the amount, so that money sent to the wrong account can be traced. These limits on an
operator's account are set in the database, not left to good behaviour.

## What you cannot see, and why

- **Your lawyer's private working notes.** Docket keeps two separate sets of notes on a
  consultation: the summary written for you, which you see, and internal notes, which you do not.
  They are in different places precisely so the second can never reach you by accident.
- **Internal entries on the timeline.** Your firm marks each entry as yours to read or internal.
  You see the first kind.
- **Draft invoices**, until issued.
- **Other parties' details** beyond what your firm chooses to put on the timeline. Your firm's
  own record of who is on the other side, and its conflict checks, are its working papers.

---

## Your documents

- **Nothing is public.** Your documents are not on the open web, and there is no permanent address
  for one. Guessing at a link gets nowhere.
- **Every view is a fresh, short-lived permission.** When you tap a document, Docket checks who you
  are and what you are entitled to, then issues a link that works for **two minutes** and stops.
  A document you open to sign gets a link that works for **ten minutes**, so you have time to read
  it. While it works the link is the key, so do not forward it; after that it opens nothing, for
  anybody.
- **Every version is kept**, with a fingerprint of the file. Nothing is quietly replaced.
- **Documents are never hard-deleted** through the app. Legal records stay records.
- **You can upload too** — on a matter, or on a consultation. What you upload is visible to your
  firm and to you.
- **Your firm may ask you for a document.** The request appears at the top of the matter's
  Documents tab, with why and by when. **Upload this** answers it, and your firm is told the moment
  the file arrives. A request your firm withdraws simply disappears from the list.
- Up to 25 MB per file: PDF, Word, and JPEG, PNG or HEIC photographs.

### Signing a document

Your firm may draw up a document and ask you to sign it. It appears on the matter's Documents tab
saying so, with **Read and sign**.

- **You read it first, and Docket checks that you did.** The document opens in front of you; only
  then does the box to sign appear. A signature without that is refused.
- **You sign by typing your name** — exactly as it is on your profile — and pressing **Sign this
  document**. If your name there is wrong, correct it on your profile first; Docket will not
  accept a different name for you. **Close without signing** leaves it unsigned, to come back to.
- **What is recorded** is: that it was you, the name you typed, the exact version of the file and a
  fingerprint of its contents, that you opened it, and when. That is what makes it evidence of what
  you signed rather than of "a document".
- **Once signed, the document is final.** No new version can be added to it, by anyone. If
  something must change, your firm draws up a new document.
- **Some documents cannot be signed here.** A deed, or anything needing a witness or stamping, has
  to be signed on paper before the right person. Your firm will tell you, and will record on Docket
  what was executed and when.
- **You are never asked to sign anything your firm has not shared with you**, and a signature is
  never taken from you automatically.

---

## Your data, and your say over it

- **See what is held.** Most of it is already in the app: your matters, timeline, documents,
  invoices, messages, and — under your profile — every consent you have given, with its date.
- **Correct it.** Your own name, address and contact details are yours to edit under your profile.
  Anything on your matter is your firm's record; ask them to correct it, and the change is logged.
- **Stop the messages.** Turn events off individually, or set quiet hours. Turning off push on a
  device stops push on that device.
- **Ask for a copy, or for deletion.** Ask your firm — under Nigerian data-protection law your firm
  is responsible for your matter records, and Docket acts on its instructions. Be aware that some
  records cannot simply be deleted: a consultation you booked and an invoice you were issued are
  the firm's own record of a transaction, and it may be required to keep them.

---

## If something cannot wait

Every firm's website has an **Urgent help** page, linked from the top of every page of the site.
It says what to do first if someone has been arrested, you are being locked out of your home
today, someone is threatening you, you have just lost money to fraud, or a court date is today or
tomorrow. It gives the firm's own phone, WhatsApp and email where the firm has set them, and
national help that does not depend on the firm, starting with **112** if anyone is in danger. You
do not need to be signed in or to be a client. It is general information, not legal advice for
your situation: speak to a lawyer as soon as you can.

---

## If something goes wrong

| | |
|---|---|
| **The sign-in code has not arrived** | Wait a minute and ask once more. If it still does not come, ask your firm to check the number it holds for you |
| **I paid and it still says not paid yet** | Wait a minute and refresh. Confirmation waits for Paystack, not for the page. If it does not clear, tell your firm your reference and the Paystack receipt |
| **My slot expired while I was paying** | The fifteen-minute hold ran out, and the slot is released soon after. If no payment went through, book again. If Paystack took a payment and the consultation now says cancelled, tell your firm your reference and the Paystack receipt |
| **There is no Join the waiting room button** | It appears an hour before the start time, and only for a confirmed video consultation. The room itself opens ten minutes before |
| **I cannot get past the terms screen** | Both boxes must be ticked. If the firm has just published a new version, you are being asked again on purpose |
| **A document will not open** | The link has expired: it works for two minutes, or ten when you open a document to sign. Tap it again to get a new one |
| **The app looks empty** | Every list says what to do next when it has nothing in it. If it does not, tell your firm |

Your firm is the right first call for anything about your matter. Docket's operator screens do not
show it.
