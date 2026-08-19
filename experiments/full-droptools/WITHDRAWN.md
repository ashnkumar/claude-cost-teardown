# full-droptools — withdrawn: the earlier naming

**Fix 3 — drop tool payloads (on frozen context). 4 runs on disk, 3
completed and 1 failed. Its cost does not appear in any table in the README,
on purpose.**

This is the correct composition under its earlier name, measured against a
frozen run context. The published rows re-ran it against a live one, which
is the condition an actual agent runs in. The numbers here are sound; they
are simply the earlier lineage, kept as evidence rather than printed twice
under two names.

Read `live-droptools` instead — it is the published row this one was
replaced by, and it is in the tables.

The runs themselves are complete and unedited: `result.json`, `usage.jsonl`
and `trace.jsonl` per replicate, the same records every published number is
computed from. `node scripts/experiments/aggregate.mjs` reads them along
with everything else; the tables drop them by `narrative_status`, and say so
out loud when they do.

Written by `node scripts/experiments/withdrawn.mjs` — see
`experiments/WITHDRAWN.md` for every withheld treatment at once.
