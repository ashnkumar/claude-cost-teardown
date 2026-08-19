# full-window — excluded as a result, not a gap

**Fix 3 — sliding window (on frozen context). 1 run on disk, 0 completed and
1 failed. Its cost does not appear in any table in the README, on purpose.**

Sliding-window trimming drops a web_search that a later web_fetch depends
on, so most of these runs 400 out. That is the finding: on this loop the
tactic is not merely expensive, it is unsafe. The runs are excluded from the
cost tables because a crashed run bills a partial conversation and would
read as cheapness — not because the tactic went unmeasured.

There is no published row that replaces this one; the exclusion is the
result.

The runs themselves are complete and unedited: `result.json`, `usage.jsonl`
and `trace.jsonl` per replicate, the same records every published number is
computed from. `node scripts/experiments/aggregate.mjs` reads them along
with everything else; the tables drop them by `narrative_status`, and say so
out loud when they do.

Written by `node scripts/experiments/withdrawn.mjs` — see
`experiments/WITHDRAWN.md` for every withheld treatment at once.
