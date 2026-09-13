# The court-registry pilot — what is built, what it will not do, and what to ask the registry

*13 September 2026. The assessment's #22. Section 1 describes working software. Section 2 is the
boundary the software keeps, in both directions, and is the reason a registry can safely join.
Sections 3–5 are the pilot plan and the questions for the registry contact, and are not answered
here because they are not Docket's to answer.*

The programme plan said how to start: *"pick ONE narrow workflow — verified cause-list/date updates
— and start with authorised structured import plus human verification if there is no API. Model
registry permissions separately from firm roles."* Migration 38 put the provenance columns on the
diary for this day. Migration 49 is that one workflow.

---

## 1. What is built

**A registry is a principal that is not a firm.** It has its own table, its own members with their
own two roles — a *registrar* publishes and withdraws, a *clerk* stages — its own console at
`/registry`, and no standing in any firm. No firm policy asks a registry helper. A registry member
with no `firm_members` row reads zero rows of matters, firms, court events, documents, or profiles
beyond their own colleagues'. The Docket platform creates a registry against a platform-wide court
and adds its members; a registrar can remove one.

**The one workflow: cause-list listings.**

1. A clerk or registrar **stages** a cause list — a CSV with its columns mapped, or one listing at a
   time. Each row is checked on its own by the database: the good ones become *drafts* in one
   batch; the bad ones come back with the reason and are not stored. A purpose the fixed list does
   not recognise is kept as the registry's own words rather than refused. A value longer than the
   column that holds it is **refused with its length**, never trimmed to fit: a shortened cause
   title is altered court data, and reporting the row as staged would make the result a lie.
2. A registrar **publishes** the batch. Nothing is visible to any firm before this.
3. Each firm whose matter carries that suit number *at that court* sees the notice on **Sittings →
   From the court registry**, against its own matter, and its lawyers are told.
4. A lawyer on the matter **decides**: *confirm* it into the diary, or *not ours / not to be
   diarised*, with a reason. **Nothing reaches a diary until a lawyer confirms it** — and that is
   the database's rule, not the screen's: both RPCs ask for the owner, admin or lawyer role, in the
   same words `confirm_deadline()` has used since migration 38. A secretary who can see the matter
   is not that person.
5. A registry that published in error **withdraws** the notice with a reason. Every lawyer who
   confirmed it is told, the sitting is stamped as withdrawn-by-the-registry wherever it is shown,
   and an internal note goes on the file — and **the date is not vacated**, because a registry
   withdrawing a notice is not a court vacating a sitting. The lawyer decides, with the flow the
   product already has.

**What confirming does, exactly.** The listed day is a calendar day and is never shifted; the
diary's instant is built only at confirmation, at the court's own wall-clock time in the court's
own zone (every Nigerian court sits in Africa/Lagos, said in the migration rather than assumed). A
Saturday, Sunday or public holiday is refused in words — a court that lists one has made an error
and the lawyer should ask the registry, not diarise it. A day inside a court vacation is **allowed**
and recorded as such: a vacation judge's sitting is a real sitting. Then one of three things happens,
chosen by what the diary already holds for that matter:

| The diary already has… | What confirming does |
|---|---|
| the same day, from a hearing notice | **attaches** the registry's notice to that sitting rather than duplicating it; provenance becomes the registry's; judge, courtroom and purpose fill in where the diary was blank |
| a different open date, and the lawyer ticks *vacate the earlier date* | makes the new sitting, vacates the earlier one with the reason given, refixes it to the new, and tells the client — exactly as the existing vacate flow does |
| a different open date, unticked | makes the new sitting and leaves the earlier one; the matter's next date stays the **nearer** of the two |
| nothing | makes the sitting |

Every path writes the decision, a client-visible timeline entry, and an audit line.

**Provenance is kept honest.** A sitting confirmed from a registry notice carries `source =
'registry'` and the notice's id, and the cause list calls it *evidenced* — the court's own statement
is evidence in the way a typed reference is not. Two things protect that word from becoming a lie:

- A lawyer may still attach the hearing-notice PDF or a reference to a registry-sourced date, but
  cannot relabel its provenance by hand: `attach_court_event_source()` refuses.
- A lawyer who **moves or re-courts** a registry-sourced date by hand — the ordinary column grants
  allow it — gets a date that is no longer the registry's: the trigger sets `source = 'firm'`,
  clears the notice and the confirmation, and writes *"Moved by the firm; was …"* into the reference.
  The diary never says "listed by the court registry" of a date the court did not list.

**Not built, deliberately.** Vacated-date notices (a refixed date arrives as the next listing, and
the lawyer refixes with a reason the client reads); filing-status acknowledgement; e-filing; an
API pull. Each is a second workflow, and the plan's instruction was one. Section 5 says what each
would need.

## 2. The boundary, in both directions

This is the part that lets a court registry join at all, and it is asserted rather than described:
`supabase/tests/99_court_registry.sql`, 154 checks.

**Only people who are still at the firm are told.** `matter_lawyers` rows used to outlive a
`firm_members` row — `remove_member()` cleared a leaver's availability and left their matter teams
alone — so four fan-outs across the product could send a departed colleague a client's suit number,
matter id and hearing dates. Migration 49 fixes the root (a person removed from a firm is removed
from its matters, and the rows already stranded are cleared once) *and* guards the point of use:
the registry fan-out joins current `firm_members` whatever else leaves rows behind.

**What the registry learns about any firm: nothing.**

- `registry_notices` carries no `firm_id` and no `matter_id`. There is no column for it to leak.
- A registry member cannot read `registry_notice_decisions`, `court_events`, `matters`, `firms`,
  `updates` or `notifications` — the policies have no registry arm, and the suite reads each table
  as a registrar after firms have confirmed and rejected, and gets zero rows.
- Publishing returns the same thing whether a notice matched every firm on Docket or none.
- The only lookup a registry could have used as an oracle — adding a member by email — is the
  platform's alone.

**What a firm learns: the court's notices about suit numbers it has entered on its own matters.**

- A firm with a different suit at the same court sees nothing. A firm with the same suit number at a
  *different* court sees nothing — a suit number means nothing without its court.
- Opposing counsel both on Docket each see the notice against their own matter, and neither learns
  the other exists.
- Drafts are the registry's alone, always.
- Said plainly rather than overclaimed: a cause list is a public document posted at the court, and
  a firm that types a suit number onto a matter will see that suit's listings. Docket does not treat
  the cause list as a secret; it treats *who holds which suit* as one.

**Inside a firm, the wall holds.** Matching goes through `can_see_matter()`, so a colleague outside a
restricted matter's team does not see its notice — and the suite proves the negative is not
vacuous by showing the same colleague *does* see it before the wall goes up.

**Once decided, always on the record.** A firm keeps reading a notice it has decided through its
own decision row, whatever later happens to the suit number on the matter. Correcting a typo does
not make "we confirmed this" disappear.

## 3. Two things that will bite in the first week

Neither is a defect; both are consequences of how matching works, and a pilot that meets one
without warning will conclude the connector is broken.

**A registry speaks for one court row, not for a judiciary.** `registries.court_id` is unique, and
Docket's directory holds the Federal High Court as *one row per judicial division*, and the State
High Courts likewise. So "the Lagos State High Court registry" is not one registry here — it is one
per division the pilot covers, each with its own members and its own cause list. For a single
division that is exactly right; for a state judiciary wanting one account for everything, it is not
what this builds, and pretending otherwise would mean a registry publishing listings for courts it
does not sit in.

**A firm that made its own court row will match nothing.** A matter matches on `(court_id,
suit_number)`, and any firm may add a private court entry of its own (`courts.firm_id` set) — an
ordinary thing to have done before the platform's directory covered a court. A matter pointed at
that private row carries a different `court_id` from the registry's, so the registry's notices for
the very same court pass it by in silence. Before a pilot firm starts, check:

```sql
select m.reference, c.name from matters m join courts c on c.id = m.court_id
 where m.firm_id = '<firm>' and c.firm_id is not null and m.deleted_at is null;
```

Anything that comes back should be repointed at the platform-wide court row. Docket does not merge
the two automatically: a firm's own court entry is its own note, and deciding which court a matter
is in is not a thing software should do on a firm's behalf.

## 4. The pilot, as proposed

One registry. One court. Listings only. A term.

- **Who:** the registry contact named in the programme plan, at one court whose registry produces a
  cause list it is willing to hand over in structured form.
- **In:** a CSV per cause list, staged by a clerk, published by the registrar — or typed one listing
  at a time on days there is no file.
- **Verified by:** the lawyers at the firms concerned, one decision per notice per matter, on the
  record.
- **Measured:** how many notices were published, how many matched a Docket matter, how many were
  confirmed, rejected (and why), withdrawn (and why); how often a firm's diary already had the date
  (the *attach* path), which is the number that says whether the registry is ahead of the firms or
  behind them. All of it from real rows.
- **Ends:** with a written note from the registry and from each firm on what it was worth, and the
  decision on section 5.

## 5. What to ask the registry contact before creating the registry

The platform screen at **Administration → Registries** creates a registry only when these are
answered — and after the two checks in §3. None of them is technical.

1. **What can you export, and how often?** A cause list as a spreadsheet or CSV, weekly or daily? If
   the answer is "a photocopy on the noticeboard", the pilot is a clerk retyping it, and that is
   still a pilot — but it should be called that.
2. **Who at the registry holds the account?** Named people, with their own Docket accounts and a
   second factor. A shared login is not a registrar.
3. **Is "we listed it" a statement the registry is willing to make through Docket?** A published
   notice is the registry saying, in its own name, that a suit is listed. If it is not authorised to
   say that except on paper, it should not say it here.
4. **What are your own rules about the data?** A cause list names parties. The registry already
   publishes it; Docket shows it only to firms that hold the suit. If the registry's rules are
   narrower than its noticeboard, say so now.
5. **What happens when you get it wrong?** Withdrawal with a reason is the only correction. Is the
   registry content to have its corrections on the record?

## 6. What would come next, and what each needs

| Workflow | Needs, before it is built |
|---|---|
| Vacated-date notices from the registry | A decision that a registry's "vacated" is the court's act (it is) and therefore *may* vacate a firm's sitting without a lawyer's hand — the opposite of this pilot's rule — or that it may not, and is only a prompt. Not a technical question. |
| Filing-status acknowledgement ("we received your process on …") | A filing to acknowledge: Docket does not yet file. It records service. |
| An API pull rather than a CSV | A registry with an API. None of the contacts has one. |
| E-filing | Everything above, and the state judiciary's e-filing platform, which is its own project. |

Everything in this table stays unbuilt until the question in its second column is answered.

---

## Related

- `supabase/migrations/20260910000049_court_registry.sql` — the tables, the two roles, the one workflow, the provenance guard
- `supabase/tests/99_court_registry.sql` — the boundary, from both sides
- `app/registry/` · `app/admin/registries/` · `src/components/firm/registry-notices-card.tsx` — the three screens
- `docs/CONNECTORS_DESIGN.md`, `docs/DOCUMENT_TEXT.md` — the same shape of document, for the same reason
