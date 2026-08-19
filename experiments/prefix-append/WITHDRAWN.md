# prefix-append — withdrawn: the half-move

**Cache breakpoint moved, volatile block left above. 3 runs on disk, all
completed. Its cost does not appear in any table in the README, on
purpose.**

These runs moved the cache breakpoint but left the volatile run-context
block above the conversation, so the prefix still changed on every turn and
the cache still missed. It is a real measurement of an intermediate state,
and an intermediate state nobody would deliberately ship: the change costs
the same to make as the one that works. Reporting it beside the fix would
suggest a spectrum where there is a right answer.

Read `live-append` instead — it is the published row this one was replaced
by, and it is in the tables.

The runs themselves are complete and unedited: `result.json`, `usage.jsonl`
and `trace.jsonl` per replicate, the same records every published number is
computed from. `node scripts/experiments/aggregate.mjs` reads them along
with everything else; the tables drop them by `narrative_status`, and say so
out loud when they do.

Written by `node scripts/experiments/withdrawn.mjs` — see
`experiments/WITHDRAWN.md` for every withheld treatment at once.
