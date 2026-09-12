# Client money and law-firm finance — a design for review

**Status: a proposal, not a build.** Nothing in this document exists in the code. It is written to
be read by the firm's legal-accounting adviser and argued with *before* any of it is built, because
the binding constraints here are regulatory rather than technical, and a ledger that mixes client
money with fee income is the one mistake in this programme that cannot be cheaply undone.

The plan records the decision that prompted it: *Docket **will** model client accounts properly.
Design it with the accounting adviser **before** building, because retrofitting a mixed ledger is
the expensive mistake here.*

Assessment item #18. Related: `docs/DOCKET_PLATFORM_MODEL.md` §4, `BUILD_PROMPTS.md` slice 6.

---

## 1. What exists today, stated plainly

Docket has **fee invoicing only**, and one route for money:

- A client is invoiced (`invoices`, `invoice_items`), and pays through Paystack.
- Paystack settles **directly into the firm's own subaccount**. Docket never touches the funds and
  holds no balance. `record_payment()` is the only writer of `payments`, it is idempotent on the
  provider's reference, and a charge reported against a subaccount that is not the firm's is
  written as `failed` and pays nothing.
- Since migration 42 the invoice tables are, like `payments`, written by their functions alone:
  `create_invoice()`, `issue_invoice()`, `cancel_invoice()`, `record_payment()`. Nothing else.

What Docket therefore **cannot** represent today, and should not be described as if it could:

| Absent | Consequence now |
|---|---|
| Money received without an invoice | `payments.invoice_id` is `not null`, so there is no "on account" |
| A client-money balance of any kind | No table, no view, no RPC mentions one |
| Refunds | `payment_status` has a `refunded` value nothing ever writes |
| Credit notes | The words appear only in a refusal message |
| Time, expenses, disbursements | No tables |
| Fixed-fee milestones, retainers | No tables |
| Reconciliation against the bank | Paystack's fee, net amount and settlement date are never captured |
| Overdue chasing | `mark_overdue_invoices()` flips a status and tells nobody |

The two claims already in the product — *"Docket never holds client money"* on the pay panel, and
the platform model's statement that funds settle directly — are true today and must stay true, or
be changed deliberately and everywhere at once.

## 2. The question for the adviser

Everything below turns on one answer, and the rest of the design follows from it:

> **Is Docket recording a client account the firm operates at its own bank, or is Docket in any
> sense a route through which client money travels?**

The design assumes the **first**, and recommends it strongly. Under it Docket is a *ledger and a
control*, not a payment institution: the firm's client account is at the firm's bank, the firm's
own people move the money, and Docket records what happened, refuses what the rules refuse, and
makes the balances impossible to misstate. The second answer changes Docket's regulatory character
entirely — money transmission, safeguarding, licensing — and is out of scope for the pilot.

**What the adviser is asked to settle**, each of which has a place below:

1. The correct name and structure in this jurisdiction (client account, trust account, designated
   account per client or a pooled account with a ledger per matter).
2. Whether interest arises on the client account, to whom it belongs, and at what threshold.
3. The rules governing a transfer from client money to the firm — what must exist first (a bill
   delivered? a period elapsed?), and who may authorise it.
4. What must be reconciled, how often, by whom, and what record of the reconciliation must be kept.
5. Retention: how long client-money records must be kept, and whether that is longer than the
   general matter retention this product has not yet set.
6. Whether a shortfall on the client account must be reported, to whom, and in what time.
7. Withholding tax and VAT treatment of disbursements paid out of client money.

Where this document guesses at any of these it says so in the margin. **No guess should reach the
schema.**

## 3. The principle the schema must enforce

> **Client money and fee income are separate by construction, not by convention.**

Not two columns on one balance. Not a `kind` flag on `payments`. Two ledgers, two destinations, and
no function anywhere that can move a figure from one into the other except the one transfer this
design names and audits.

The reason is the failure mode. A single table with a discriminator lets a bug, a bad migration or
a careless `sum()` produce a firm balance that silently includes money belonging to clients. That
is not a reporting error; it is the thing the rules exist to prevent, and no amount of care in
application code substitutes for a schema in which the wrong sum cannot be written.

### The shape

```
client_accounts        one per firm per currency; the firm's real bank account, recorded
  firm_id, currency, bank_name, account_name, account_number_last4, opened_on, closed_on

client_ledger_entries  append-only, double-entry, never updated and never deleted
  id, firm_id, account_id, matter_id, client_id, currency,
  amount_minor (signed), direction in/out, kind, occurred_on (a calendar day),
  reference, description, evidence_document_id, entered_by, entered_at,
  reversal_of  -- a correction is an equal and opposite entry, never an edit
```

Balances are **derived**, never stored:

```
client_matter_balances  a view: sum(amount_minor) per (firm, matter, currency)
client_account_balances a view: sum(amount_minor) per (firm, account, currency)
```

Three rules the database enforces, not the screens:

1. **No matter goes into deficit.** A withdrawal that would take a matter's client-money balance
   below zero is refused. One client's money never funds another's work, and a pooled account whose
   total is positive can still hide a matter that is overdrawn — so the check is per matter, not
   per account.
2. **Nothing is edited.** No `update` and no `delete` grant, exactly as `audit_log`, `payments` and
   now `invoices` are. A mistake is corrected by a reversing entry that names the entry it reverses.
3. **Money leaves only by a named route.** Every `out` entry has a `kind`, and each kind has its
   own function with its own rule (below). There is no general "record a withdrawal".

### The kinds

| Direction | Kind | What it is | The rule |
|---|---|---|---|
| in | `receipt` | The client paid money into the client account | Evidence required: the bank reference and, ideally, the advice as a document |
| in | `transfer_in` | Money moved in from elsewhere on the client's behalf | As above |
| out | `disbursement` | Paid out on the client's behalf — filing fees, an expert | Cannot exceed the matter's balance |
| out | `refund_to_client` | Returned to the client | Cannot exceed the matter's balance; the destination is recorded |
| out | `transfer_to_fees` | **The only bridge to the firm's money.** | See below |
| either | `correction` | Reverses a named earlier entry | Must name `reversal_of`; equal and opposite |

### The bridge, and why it is the only one

`transfer_to_fees` is the single point at which money stops being the client's and becomes the
firm's. Everything about it is deliberately narrow:

- It requires an **issued invoice** on the same matter, for the same client, in the same currency.
- It may not exceed that invoice's outstanding amount, nor the matter's client-money balance.
- It is authorised by `admin_w` — an owner or administrator with a second factor — and never by a
  lawyer acting alone. *(Whether the rules require a specific person, a delivered bill, or a
  waiting period is question 3 for the adviser; the function is written to take whatever answer
  comes back as an explicit precondition, not to be relaxed later.)*
- It writes **two things in one transaction**: the `out` entry on the client ledger, and a
  `payment` against the invoice with provider `client_account`. So the invoice's `paid_minor` and
  the client ledger can never disagree, and the existing invoice machinery — statuses,
  notifications, the receipt PDF — works unchanged.
- It audits `client_money.transferred_to_fees` with both sides.

A firm that never uses client money never sees any of it. Like matter walls and conflict checks,
this is opt-in per firm (`firms.client_account_enabled`), off by default, and the pilot firm turns
it on only when its adviser says the account is correctly constituted.

## 4. Reconciliation, which is the point of the exercise

A ledger nobody reconciles is bookkeeping theatre. The design therefore includes, from the first
version and not as a later phase:

- **A statement import.** The firm uploads its client-account statement; each line is matched
  against a ledger entry by reference and amount, or left unmatched.
- **`client_account_reconciliations`**, append-only: the period, the statement closing balance, the
  ledger balance, the difference, the unmatched lines, who reconciled it and when. A difference of
  zero is a fact recorded, not an absence of a record.
- **A shortfall is loud.** Where the ledger says the firm holds more than the bank does, the
  reconciliation screen says so in those words and the platform health screen counts it. *(Question
  6: what must be reported, to whom, how fast.)*
- **Nothing auto-matches silently.** A match a person did not confirm is shown as proposed.

## 5. The rest of #18, which is ordinary and follows after

These are real gaps, but they are commercial rather than regulatory, and they should not delay or
complicate the client-money work. Recommended order once client money is settled:

1. **Credit notes and refunds.** Both are promised in refusal text today and neither exists: a
   paid consultation that is cancelled keeps a `paid` receipt for ever. `credit_notes` with its own
   numbering, reducing an invoice's outstanding without touching what was originally billed; and a
   refund path that writes the `refunded` status the enum already has, with a reason and an
   approver. **This is the first thing to build after the ledger**, because it is the one place the
   product currently says something untrue.
2. **Time and expenses.** `time_entries` (matter, person, minutes, rate at the time, billable),
   `expenses` (with a receipt document, and a pass-through vs marked-up distinction so a
   disbursement is not silently VAT-ed). A rate is snapshotted on the entry, never read live.
3. **Fixed-fee milestones and retainers.** A retainer is *not* client money in every case, and the
   distinction matters: money on account of fees may or may not be client money depending on the
   answer to question 3. **Ask before building.**
4. **Dunning.** An `overdue` status that tells nobody is a status, not a process.
5. **Per-line VAT and a rate snapshot.** One firm-wide rate applied once to the subtotal cannot
   express an exempt disbursement, and a historic invoice cannot state the rate it was raised at.

## 6. What this design deliberately refuses

- **No balance column anywhere.** Balances are sums of entries. A stored balance is a second source
  of truth and eventually the wrong one.
- **No editing.** Not for an administrator, not for platform support, not for Docket.
- **No client-money figure in any client-facing screen until the adviser has approved the wording.**
  A client seeing "we hold ₦2,000,000 for you" is a statement with legal weight.
- **No single sum across currencies**, here as everywhere else in Docket.
- **No inference.** If the rows cannot say whether a transfer was authorised, the screen says the
  rows cannot say, in the manner of the baseline's caveats.
- **Docket still never holds the money.** If that ever changes, it is a different product with a
  different regulatory character, and this document is not the design for it.

## 7. What has already been done in preparation

Only one thing, and it is a correctness fix that stands on its own merits:

**Migration 42 closes the invoice write door.** `invoices` and `invoice_items` were writable
directly by any member of the firm with a second factor and access to the matter — `paid_minor`,
`status`, `currency`, `client_id`, all of it — beside the four functions that read as the
authority. Nothing in Docket ever used that grant; every reference in `app/` and `src/`, on this
branch and on the deployed main, is a read. It is the same shape as the `firm_members` escalation
Wave 0 found, and it is now revoked, with the standing check in `supabase/tests/80_doors.sql`
extended to hold it closed.

That fix was not optional for this design. A client-money ledger whose bridge to the firm's money
depends on an invoice's outstanding amount would have inherited a table any member could edit.

---

## For the adviser: the shortest version

Docket proposes to record — never to hold — client money, as an append-only double-entry ledger
per matter, in a firm-level account the firm operates at its own bank, with balances derived and
never stored, corrections made by reversal and never by edit, one narrow audited route by which
money becomes the firm's, and a reconciliation against the bank statement that records a difference
of zero as a fact rather than as silence.

Please tell us where that is wrong, and answer the seven questions in §2. Nothing will be built
until you have.
