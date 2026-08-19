# t-compliance:fullvol-append — withdrawn: composed wrong

**Both fixes composed naively. 1 run on disk, all completed. Its cost does
not appear in any table in the README, on purpose.**

Both fixes are applied here, and composed wrong: the volatile churn still
lands inside the conversation span, so the cache breaks anyway and the
composition buys nothing. It is the trap worth knowing about, which is why
the runs ship, but its cost is a property of the mistake rather than of
either fix.

Read `t-compliance:live-append` instead — it is the published row this one
was replaced by, and it is in the tables.

The runs themselves are complete and unedited: `result.json`, `usage.jsonl`
and `trace.jsonl` per replicate, the same records every published number is
computed from. `node scripts/experiments/aggregate.mjs` reads them along
with everything else; the tables drop them by `narrative_status`, and say so
out loud when they do.

Written by `node scripts/experiments/withdrawn.mjs` — see
`experiments/WITHDRAWN.md` for every withheld treatment at once.
