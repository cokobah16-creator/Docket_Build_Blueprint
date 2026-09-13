# Docket partner API — v1

A read-only contract another system can build against: a firm's matters, invoices, clients and a
complete event feed, behind a scoped key the firm issues and can revoke.

**Base URL** `https://<project-ref>.supabase.co/functions/v1/partner-api`

**Status** v1 is live in the schema and the function is written; no partner is connected yet, and
nothing here has been exercised against a real integration. Read that as the current state, not as
modesty.

---

## What this is, and what it is not

| | |
|---|---|
| **Read only** | v1 answers questions and emits events. It changes nothing. A write API over matters and money needs decisions nobody has taken — whose reference wins, what a partial write means, how a conflicting update is resolved — and inventing them to look complete would be the wrong kind of finished. |
| **No sandbox** | The assessment asks for one and is right to. A sandbox is a second environment with its own data, and Docket has no staging project yet. Something called a sandbox that is really production with a different key would be worse than none, so there isn't one. |
| **A mapping, not a window** | The field names below are the contract. The tables underneath are not, and are renamed and reshaped as the product changes. Where the *contract* must change it becomes `/v2` **beside** `/v1`, never a change under a running integration. |
| **Not a standard** | Docket's schema is Docket's own. It is not proposed as a Nigerian legal interchange format, and a partner should map it to their own concepts rather than adopt it. |

---

## Getting a key

An **owner or administrator** of the firm, with a second factor, issues one from
**Me → Administration → Partner API**. The key is shown **once**, at that moment, and is never
retrievable again: Docket stores only its SHA-256 hash, so a database dump is not a set of working
credentials. Lose it and you issue another.

A key carries:

- **Scopes**, chosen at issue, from exactly this list: `matters:read`, `invoices:read`,
  `clients:read`, `events:read`. A call outside its scopes is refused, and the refusal names the
  scope that was missing.
- **One firm.** A key speaks for the firm that issued it and there is no parameter that changes
  that. It cannot be pointed at another firm's data by any request.
- **An optional last day.** After it, the key opens nothing — with no job having run.

Send it as a bearer token:

```
Authorization: Bearer dk_live_1a2b3c4d_<the rest>
```

### Rate limit

600 calls a minute per key. Over it you get `429` with `{"error":{"code":"too_many_requests"}}`.
That is generous for a nightly sync and bounded for a runaway loop.

---

## Resources

Every response has the same envelope:

```json
{ "version": "v1", "count": 2, "data": [ … ] }
```

### `GET /v1/matters?since=<iso>&limit=<n>`

Scope `matters:read`. `since` filters on the matter's own last activity; `limit` defaults to 100 and
is capped at 500.

```json
{
  "id": "…", "reference": "AK-M-2026-000014", "title": "Adebayo v Union Bank",
  "type": "litigation", "status": "Filed", "court": "Federal High Court",
  "suit_number": "FHC/L/CS/77/2026", "opened_on": "2026-03-02", "closed_on": null,
  "restricted": false, "updated_at": "2026-09-01T10:14:00Z"
}
```

`restricted` says the matter is walled to its team inside the firm. It is reported so a partner can
treat it carefully; the API does not withhold it, because the key belongs to the firm rather than to
a member of it. **If that is not what a firm wants, do not issue a key with `matters:read`** — this
is the one place where an API key is broader than a person, and it is stated rather than buried.

### `GET /v1/invoices?since=<iso>&limit=<n>`

Scope `invoices:read`. Drafts are never returned.

```json
{
  "id": "…", "number": "AK-INV-2026-000003", "matter_id": "…", "status": "issued",
  "currency": "NGN", "total_minor": 25000000, "paid_minor": 0,
  "issued_at": "2026-08-01T09:00:00Z", "due_on": "2026-08-15"
}
```

**Money is minor units with its currency, always together.** `total_minor` is ₦250,000.00 when
`currency` is `NGN`. Two currencies are never summed and no bare number is ever returned.
`due_on` is a calendar day, not an instant: do not shift it through a timezone.

### `GET /v1/clients?limit=<n>`

Scope `clients:read`. Who the firm acts for — and **no matter is named**, because which matters a
person has is decided by the firm's own walls and a key is not a way round them.

```json
{ "id": "…", "name": "Bisi Adebayo", "kind": "individual", "email": "…", "phone": "…" }
```

### `GET /v1/events?after=<seq>&limit=<n>`

Scope `events:read`. The feed, in order.

```json
{ "id": "…", "seq": 4711, "type": "matter.stage_changed",
  "occurred_at": "2026-09-01T10:14:00Z", "data": { "id": "…", "reference": "AK-M-2026-000014", "status": "Filed" } }
```

Page on **`seq`**, not on time: it is monotonic and unique, so asking for everything after your last
processed sequence is complete by construction. Two events can share a timestamp; they cannot share
a `seq`. The `id` is stable for ever and is the same id a pushed webhook carries, so a partner using
both never processes one twice.

Types in v1: `matter.opened`, `matter.stage_changed`, `matter.closed`, `invoice.issued`,
`invoice.paid`.

An event's `data` is the mapped shape **as it was when the event happened** — replaying the feed a
year later gives what was true then, not what the tables say today. No event carries privileged
content: a reference, a stage, a number and an amount, never a note, a message or a document.

---

## Webhooks

A firm may register an endpoint (**Me → Administration → Partner API**) and have events pushed
instead of polled. The signing secret is shown once, at registration, exactly like the key.

Each delivery is a `POST` of one event:

```
Docket-Event:     3f9c…            the event's stable id
Docket-Timestamp: 1789012345       unix seconds
Docket-Signature: v1=<hex>         HMAC-SHA256 of "<timestamp>.<raw body>" with your secret
Content-Type:     application/json
```

**Verify before you trust.** Recompute the HMAC over `"<Docket-Timestamp>.<the exact raw body>"`
with your secret and compare in constant time. Reject a timestamp far from now, and treat a repeated
`Docket-Event` as a duplicate — retries are expected.

Retries: eight attempts over roughly a day and a half, with a growing gap. Answer `2xx` to stop
them. After the eighth the delivery is marked failed and shows as failed on the firm's own screen —
a queue that retries for ever is a queue nobody looks at. Nothing is lost either way: the pull feed
still has every event.

---

## Refusals

One shape, always:

```json
{ "error": { "code": "insufficient_scope", "detail": "this key does not carry the clients:read scope" } }
```

| Status | Code | Means |
|---|---|---|
| 400 | `bad_request` | `since` was not an ISO 8601 instant |
| 401 | `unauthorized` | No bearer token |
| 403 | `unauthorized` | The key is unknown, revoked, expired, or its firm is suspended — **deliberately one message**, so a caller learns whether their key works and never which part was wrong |
| 403 | `insufficient_scope` | The key is fine; it does not carry this scope |
| 404 | `unknown_version` / `unknown_resource` | |
| 405 | `method_not_allowed` | v1 is read only |
| 429 | `too_many_requests` | Over 600 a minute on this key |
| 500 | `internal_error` | Ours. The detail is in the function's logs, not in the response |

---

## How the authorization actually works

Worth knowing if you are reviewing this rather than integrating with it.

The HTTP function holds **no rule**. It reads the bearer token and passes it to a database function;
it never names a firm and has no firm id to pass. `api_authorize(key, scope)` hashes the presented
key, finds the credential, and checks — in the database — that it exists, is not revoked, has not
expired, belongs to an active firm, and carries the scope. Every `api_v1_*` function calls it before
reading a row, and all of them are executable by the service role alone.

So rewriting the HTTP layer badly produces a broken route, not a wider answer. That is the same rule
the rest of Docket follows (`docs/DOCKET_PLATFORM_MODEL.md` §2), applied where it matters most,
because an API key is a credential somebody will eventually paste into a script and forget about.

---

## Related

- `supabase/migrations/20260910000046_partner_api.sql` — the credentials, the scopes, the feed and the gate
- `supabase/functions/partner-api/index.ts` — the pipe
- `supabase/functions/partner-webhooks/index.ts` — the signed push
- `supabase/tests/99_partner_api.sql` — what is asserted about all of it
