# Docket_Build_Blueprint

Planning repository for the Docket build.

- [`Docket_Build_Prompts.md`](Docket_Build_Prompts.md) — the six Claude Code build prompts, one per slice of the 90-day plan. Work one slice at a time: paste a single slice into Claude Code from the app repo root, run its acceptance checks, commit, then move to the next.

The prompts assume `Docket_Build_Blueprint_v0.2.md` and the migrated `supabase/` foundation are present in the repo where they are run; add those before starting Slice 0.
