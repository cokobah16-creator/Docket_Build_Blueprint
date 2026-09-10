# Onboarding a firm — the runbook

*For the platform operator and for a firm's IT lead. Attorneys Klinique came
in through `supabase/seed.sql`; every firm after it comes in this way, and
Klinique's owner accounts are attached exactly as in step 4.*

## Self-serve (the normal path)

1. **Register** — the owner opens `/firm/start`, creates an account (email +
   password) and enters the firm: name, web address (`{slug}.docket.app`),
   registered name, RC/BN number, state, primary colour. `create_firm()` makes
   them owner, seeds the defaults (statuses, an unpriced consultation, an
   intake form, a versioned policies skeleton) and leaves the firm **pending**.
2. **Two-factor** — the owner enrols an authenticator app at
   `/firm/security/mfa`; the console opens. Nothing is public yet.
3. **Verify and activate** — a platform admin checks the RC/BN number (CAC)
   and the owner's Supreme Court enrolment number (Roll of Legal
   Practitioners) and clicks *Verify and activate* in `/admin`
   (`set_firm_status(firm, 'active')`). The firm now appears on `firm_public`
   (marked verified), its site resolves, and its owners are notified.
4. **Lawyers and staff** — the owner creates `staff_invites` (email + role) from
   the console (slice 4 UI; until then an admin inserts the row); the invitee
   signs up with that email and calls `accept_staff_invite(token)`. Lawyers get
   a private profile to complete: title, bio, practice areas, SCN, year of
   call, NBA branch, stamp-and-seal serial.
5. **Settlement** — the operator creates a Paystack **subaccount** for the
   firm's bank account (Paystack dashboard → Subaccounts, or `POST
   /subaccount`) and stores its code in `firms.paystack_subaccount`. Until it
   is set, `book_appointment()` refuses prepaid bookings and the checkout
   action explains why. Every payment initialises with `subaccount` +
   `bearer: 'subaccount'`; `record_payment()` refuses a settlement elsewhere.
6. **Policies and services** — the owner replaces the `0-draft` policies
   (terms, privacy, cancellation, disclaimer) with real versions, sets the VAT
   rate, prices the consultation and activates it, adds services, sets each
   lawyer's availability. Clients cannot be asked to consent to drafts.
7. **Service of process** — the owner records the firm's address for service
   (`firms.address_for_service`: chambers, email, phone, contact user) and, if
   the firm will accept non-originating processes through Docket, sets
   `accepts_platform_service = true`.
8. **Domain** — optional custom domain mapped through the Vercel Domains API
   (slice 5) and stored in `firms.custom_domain`.

## Operator-assisted

A platform admin can open a firm for an owner who has already signed up:
`/admin` → *Create a firm for an owner* (`create_firm(..., p_owner_email)`).
The firm is pending until activated as above.

## Suspending

`set_firm_status(firm, 'suspended', note)`: the site and bookings stop
(`firm_public` filters to active), staff cannot write (`staff_w`/`admin_w`
check the status), no process can be served on or by the firm. Clients keep
read access to their own matters, documents, invoices and receipts. Data is
never deleted by suspension.

## The first platform admin

Platform admins are not created through the app. With the service role:

```sql
insert into platform_admins (user_id, note)
select id, 'founder' from profiles where email = 'ops@example.com';
```

Platform admins see `firm_admin` (lifecycle columns only), maintain `courts`
(platform rows), `public_holidays` and `court_vacations`, and never see matter
content — there is no policy that would let them.

## Reference data the platform owes each year

- National public holidays for the coming year (fixed dates are seeded through
  2027; Easter is computable; the three Eid holidays when the Federal
  Government declares them, with `observed_on` if a date is shifted).
- State-declared holidays (`state_code` set) that bind that state's courts.
- Each court's annual, Christmas and Easter vacation from its practice
  direction, with `time_runs`.
- New judicial divisions of the Court of Appeal, Federal High Court and NICN
  as they are created. `reference_data_coverage` shows how far the data goes.
