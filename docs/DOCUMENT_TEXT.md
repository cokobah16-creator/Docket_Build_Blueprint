# Reading the words inside a file — what is built, and the OCR decision that is not mine

*13 September 2026. The extraction half of the assessment's #15b. Sections 1–3 describe working
software; section 4 is a decision with a price on it and is nobody's to take quietly.*

---

## 1. What is built

Migration 43 built search and said in its own header what it did not do: *"a document matches on its
name and nothing else."* It no longer does. `src/lib/extract.ts` reads the words out of an uploaded
file, and `search_docket()` matches on them.

| Kind of file | What happens | How good it is |
|---|---|---|
| `.txt`, `.md`, `.csv`, `.json`, `.log` | Decoded, UTF-8 first and Windows-1252 second | **Exact** |
| `.html` | Tags, scripts and stylesheets removed; entities decoded | **Exact** |
| `.docx` | The zip's `word/document.xml` inflated with `DecompressionStream`, runs joined | **Exact**, and with no library at all — which is why `.docx` is here and `.doc` is not |
| `.pdf` with a text layer | Every stream inflated, content streams kept, text-showing operators read, WinAnsi decoded | **Best effort**, with a guard (below) |
| **A scan, a photograph, any image** | Recorded `no_text_layer`. Found by its name; **not** by its contents | Section 4 |
| Anything else | Recorded `unsupported`. Found by its name | |

**The guard is the honest part.** A PDF using a two-byte font with no `ToUnicode` map yields a string
of plausible-looking characters that are not words. `looksLikeProse()` throws that away and records
`no_text_layer` instead. Indexing it would be worse than indexing nothing: the firm gets hits on
gibberish and stops trusting the search box.

**A round trip proves it, not a fixture.** `scripts/check-extract.ts` has `src/lib/pdf.ts` write a
PDF and `src/lib/extract.ts` read the words back out — an em dash, a euro sign, `café`, escaped
parentheses, a comma inside a number, a suit number. Seventy-four assertions, run by CI rather than
compiled.

## 2. Where the text lives, and why that is the whole security design

On `document_versions`, as ordinary columns of the row it belongs to — beside the checksum and the
storage path.

`document_versions_select using (can_access_document_version(id))` already decides who may see that
row, and it is the **same function the Storage policies call** before any byte of the file moves. So
the text of a document is readable by exactly the people who may open the document, by construction.

The two alternatives were both worse:

- **A `document_text` table with its own RLS** is a second statement of who may read a document. The
  day migration 29's wall or migration 45's collaboration arm changes, one of the two is stale — and
  a wall stated twice is a wall with a hole in it in six months.
- **A denormalised index written by a definer trigger** is the classic way an access model leaks: one
  table, no policy of its own, and every wall in the product is gone behind a text box.

And `search_docket()` stays **SECURITY INVOKER**, so its join to `document_versions` reads that table
as the caller. Nothing about the wall is restated in the search; it is inherited.

`supabase/tests/99_document_text.sql` asserts this from both sides — 51 checks, and the ones that
matter are negative:

- A colleague inside the firm and outside a walled matter's team **finds it before the wall goes up
  and does not find it after** — by the word, by the phrase, and with no kind filter at all. Without
  that first half the section would be equally true of a search that had simply broken.
- A client finds the words in the document their firm shared with them, and **not one word** of the
  internal advice on the same matter.
- Nothing crosses a firm.
- Only the **current** version is searched: a superseded draft's words are not what comes back.

## 3. Nothing can write it but the extractor

`update` and `delete` on `document_versions` were revoked from `anon` and `authenticated` in
migration 24, and migration 40 narrowed the `insert` grant to a named list of columns these are not
in. `claim_document_text()` and `record_document_text()` are executable by neither role, and refuse
any caller with an `auth.uid()` at all.

So there is no door beside the door — the defect class this codebase has found four times
(`firm_members`, `invoices`, `documents`, `court_events`) and now checks for by habit. The suite
asserts the closed table as well as the guarded functions, because the guard is only the rule when
it is the only way in.

The reader itself is `supabase/functions/extract-text/index.ts`, run by `pg_cron` every five minutes
over a batch of five. It **does not write a `document_read`**: migration 30 requires one before bytes
reach a *person*, and a machine indexing a file for the firm's own search is not a person. A receipt
naming nobody would be a fabricated reading. The storage manifest works the same way for the same
reason.

---

## 4. Not built: OCR. The decision, and what it costs

**A scan is a picture of words.** Much of what a Nigerian registry hands a firm — a stamped writ, an
endorsed hearing notice, a certified true copy — arrives as a photograph. Docket records those
`no_text_layer` and says so on the screen. It does not pretend to have read them.

Making them searchable needs a recognition engine, and there are three ways to get one. None is an
implementation detail:

| Way | What it costs | What it discloses |
|---|---|---|
| **A cloud OCR API** (Google Vision, AWS Textract, Azure) | A few US cents a page, per page, for ever | **Every scanned page of every client's file is sent to a third party.** That is a larger disclosure than Docket currently makes anywhere, in a different jurisdiction, and it belongs in the privacy notice and in the firm's own retainer before one page is sent |
| **Tesseract compiled to WebAssembly**, in the Edge Function | No per-page cost; a ~10 MB model to load per cold start, and English-only accuracy on a stamped, skewed photocopy that is well short of good | Nothing leaves. This is the only option that discloses nothing |
| **A self-hosted OCR service** | A machine to run and pay for, and somebody to keep it running | Nothing leaves, but Docket currently has no server of its own to put it on |

> **Q1.** Is scanned-document search worth a per-page fee to a third party who then holds copies of
> clients' documents — and if so, is that a decision each firm makes for itself, or the platform's?
>
> **Q2.** If the answer is "nothing leaves", is WASM Tesseract's real accuracy on a Nigerian court
> stamp good enough to be worth the cold-start cost — and who tests that against real documents
> before it ships?
>
> **Q3.** Whatever is chosen: is OCR'd text labelled as **recognised rather than read**? A search hit
> on a machine's guess at a smudged page is not the same fact as a hit on a PDF's own text layer,
> and a lawyer relying on it should be able to tell which they have.

**My recommendation.** Q3 is not optional whatever else is decided — the label costs one column and
one line of copy, and without it the product quietly asserts a certainty it does not have. On Q1 and
Q2: **wait.** The cheap half is built and covers the firm's own generated documents, its Word
drafts, and every PDF anybody produced from a word processor, which is most of what a firm writes.
Scans are most of what a firm *receives*, and they are also where the accuracy is worst and the
disclosure largest. That is the wrong place to start, and the right place to start is knowing how
many of them there are — which `/firm/admin/documents` now says, per firm, from real rows.

Until one of these is chosen, nothing about OCR appears anywhere in the product. A scan is counted
as *no words to find*, on a screen that explains what that means.

---

## Related

- `supabase/migrations/20260910000048_document_text.sql` — the columns, the two doors, the schedule, the changed search arm
- `src/lib/extract.ts` · `scripts/check-extract.ts` — the reader, and the 74 assertions about it
- `supabase/functions/extract-text/index.ts` — what runs it
- `supabase/tests/99_document_text.sql` — the wall, from both sides
- `docs/CONNECTORS_DESIGN.md` — the same shape of document, for the same reason
