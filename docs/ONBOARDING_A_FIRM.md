# Onboarding a firm — the runbook

*For the platform operator and for a firm's IT lead. Attorneys Klinique came
in through `supabase/seed.sql` (inserted already active and verified by the
founders); every firm after it comes in this way. Klinique's first owner is
attached by the operator (service role: `insert into firm_members (firm_id,
user_id, role) values (…, 'owner')`); every further owner and lawyer joins by
invitation as in step 4.*

## Self-serve (the normal path)

1. **Register** — the owner opens `/firm/start`, creates an account (email +
   password) and enters the firm: name, web address (`{slug}.docket.app`),
   registered name, RC/BN number, state, their own Supreme Court enrolment
   number, primary colour. `create_firm()` makes them owner, opens their
   private practitioner profile with the SCN, seeds the defaults (statuses, an
   unpriced consultation, an intake form, a versioned policies skeleton) and
   leaves the firm **pending**. Brand JSON accepted by `create_firm(p_brand)`
   and `firms.brand`: `colours.{primary,accent,surface}` as `#rrggbb`,
   `fonts.{heading,body}` (letters, digits, spaces), `tagline`, `cta`,
   `logo_path`, `contact.{email,phone,address,whatsapp}` — anything else is
   dropped by `validate_brand()`.
2. **Two-factor** — the owner enrols an authenticator app at
   `/firm/security/mfa`; the console opens. Nothing is public yet.
3. **Verify and activate** — a platform admin (in an MFA session — enrol at
   `/firm/security/mfa` first) checks the RC/BN number (CAC) and the owners'
   enrolment numbers shown on `/admin` (`firm_admin.owners`) against the Roll,
   then clicks *Verify and activate* (`set_firm_status(firm, 'active')`). The
   firm now appears on `firm_public` (marked verified), its site resolves, and
   its owners are notified. `/admin` also shows whether the policies are
   published (step 6) and whether a settlement account is set (step 5).
4. **Lawyers, staff and further owners** — an owner or admin inserts a
   `staff_invites` row (email + role; only an owner may invite an owner) from
   the console (slice 4 UI; until then with the API) and sends the invitee the
   link `/firm/join?token=<token>` — the token is readable only by the firm's
   owners/admins. The invitee opens it, creates an account with (or signs in
   with) the invited email and accepts; `accept_staff_invite()` matches the
   identity provider's email, never a typed one. Lawyers get a private profile
   to complete: title, bio, practice areas, SCN, year of call, NBA branch,
   stamp-and-seal serial.
5. **Settlement** — the operator creates a Paystack **subaccount** for the
   firm's bank account (Paystack dashboard → Subaccounts, or `POST
   /subaccount`) and gives the firm its code; the firm's **owner or admin**
   stores it in `firms.paystack_subaccount` (platform admins cannot write it).
   Until it is set, `book_appointment()` refuses prepaid bookings and the
   checkout action explains why. Every payment initialises with `subaccount` +
   `bearer: 'subaccount'`; `record_payment()` applies a payment only when
   Paystack reports that subaccount — anything else is recorded as a flagged
   failure and reported to the firm.
6. **Policies and services** — the owner replaces the `0-draft` policies
   (terms, privacy, cancellation, disclaimer) with real versions: **bookings
   are refused until terms and privacy are published**, and clients are never
   shown drafts. Then: VAT rate, price and activate the consultation, add
   services, and set each lawyer's availability (`availability_rules`: weekday
   with 0 = Sunday, start/end, break, `slot_min`, `max_per_day`;
   `availability_exceptions` for days off). A booking's `starts_at` must be
   one of `available_slots()`'s values.
7. **Service of process** — the owner records the firm's address for service
   (`firms.address_for_service` JSON: `chambers`, `email`, `phone`,
   `contact_user_id` — the contact is told first when something is served)
   and, if the firm will accept non-originating processes through Docket, sets
   `accepts_platform_service = true`.
8. **Matters** — staff open matters with `open_matter(firm, title, type,
   client, cause_title, description, court_id, suit_number, judicial_division,
   originating_lawyer, handling_lawyer, status_key, note_to_client)`: it
   issues the reference, adds the client as party, the lead lawyer, the court
   and suit number, and posts the first client-visible entry. Clients without
   an account are invited with `invites` → `accept_invite(token)`.
9. **Domain** — optional custom domain mapped by the platform through the
   Vercel Domains API (slice 5) into `firms.custom_domain` (owners cannot set
   it themselves).

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
  direction, with `time_runs`. **The table ships empty**: until the operator
  enters them, `post_court_update()` refuses only weekends and holidays.
- New judicial divisions of the Court of Appeal, Federal High Court and NICN
  as they are created. `reference_data_coverage` shows how far the data goes.
