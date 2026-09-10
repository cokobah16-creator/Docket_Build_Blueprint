# Decision 0001 — Document storage: Supabase Storage, not Google Drive

**Status:** Decided · **Date:** 2026-09-09 · **Gates:** slice 3 (client portal
documents) and slice 4 (staff console documents)
**Supersedes:** master prompt §16 (Google Drive embedded)

## Decision

Supabase Storage is the **system of record** for every client and matter
document. Google Drive is not part of the access path. An optional one-way
**Drive mirror** (below) may be enabled later for partner convenience; it is
a convenience copy, never an upload target and never the source of truth.

## Why (in plain terms, for the partners)

The platform has one non-negotiable rule: **the database decides who can see
what.** Every screen, file and API call answers to the same row-level
security. That is what makes "a client can never see another client's file"
a property of the system rather than a promise.

Google Drive as the document backbone would break that rule in four ways:

1. **A second permission system.** Drive has its own sharing model. Every
   time a party joins or leaves a matter, a lawyer is reassigned, or a
   document is toggled client-visible, the platform would have to mirror the
   change into Drive ACLs — and a missed or failed sync is silently either a
   leak (client keeps access) or an outage (lawyer loses it). With Storage,
   there is nothing to sync: a file is visible **iff** its
   `document_versions` row is visible to you, enforced by the same RLS the
   52-check suite proves.
2. **Files leave the audit trail.** Anyone with Drive access can open, move,
   reshare or delete files from Drive's own UI, outside the portal and
   outside `audit_log`. §16's own requirement — track uploader and timestamp
   per file for audit — is exactly what `document_versions` records natively.
3. **Custody and NDPA.** Client files would sit in a Google Workspace tenant
   under a partner-managed account, adding Google as a processor for the most
   sensitive data the firm holds, with retention/deletion workflows (§30)
   running through a second system.
4. **Operational coupling.** Uploads and previews would depend on Workspace
   quotas, a service account, and the Picker's auth flow — heavier on the
   modest phones and connections the master prompt says to design for.

## What the partners keep from the Drive idea

Everything §16 actually asks for is delivered natively in slices 3–4:
in-portal upload and preview (PDF/images via short-lived signed URLs),
versioning (`document_versions`, one row per version), folder-like
organisation by matter and category, file size/type limits at upload,
uploader + timestamp on every file, and tenant-scoped paths
(`documents/{firm_id}/{document_id}/{version_id}.{ext}`) enforced by the
storage policies from migration 4.

## The optional Drive mirror (middle path — Phase 2, off by default)

If the partners want documents visible in a familiar Drive window:

- A scheduled job (Edge Function, nightly) exports **new client-visible
  document versions** into a firm-owned Workspace Drive, laid out
  `Matters/<matter reference>/<category>/<title> (v<n>).<ext>`.
- **One-way, read-only.** The mirror folder is shared to partners as
  viewers/commenters only. Files added or edited in Drive are ignored by the
  platform; the portal is the only upload path.
- Scope is a policy choice: mirror client-visible files only, or also
  internal ones — decided per firm in `firms.policies`, off by default.
- Plainly labelled in the folder description as a convenience copy; access
  in Drive is not individually audited, which is acceptable only because
  every mirrored file is one the whole partnership may already see in the
  portal.
- Needs: a Workspace service account, `GOOGLE_*` env vars from the master
  prompt §48, and a `drive_exports` bookkeeping table (version id → Drive
  file id) — scheduled with the rest of Phase 2, built only if asked for.

## Consequences

- Slice 3 and slice 4 proceed on Supabase Storage as designed; no schema or
  policy changes needed — migration 4's buckets and policies stand.
- `StorageProvider` remains an adapter (blueprint §403) so this decision is
  reversible in code, though reversing it re-imports every problem above.
- The remaining open provider decision is video (Google Meet vs Daily),
  tracked in `docs/MASTER_PROMPT_RECONCILIATION.md` — it gates slice 2.
