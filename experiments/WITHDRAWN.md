# Withheld treatments

17 of the treatment directories under `experiments/` — 37 runs — ship their
records but appear in no table in the README. This file says which, and why,
in one place. Every count below is read from
`experiments/results/results.csv` by `node
scripts/experiments/withdrawn.mjs`; none of it is typed.

Publishing data you chose not to report is more honest than deleting it, and
it invites exactly one question — "why isn't this in the table". Each
directory carries its own `WITHDRAWN.md` with the same answer, so the
question gets answered where it gets asked.

The classes come from `narrativeStatus()` in
`scripts/experiments/aggregate.mjs`, which is where a treatment's standing
is decided. `readme-table.mjs` prints the held-back list on every run and
refuses outright on a treatment it cannot classify.

## `deleted-halfmove` — withdrawn: the half-move

These runs moved the cache breakpoint but left the volatile run-context
block above the conversation, so the prefix still changed on every turn and
the cache still missed. It is a real measurement of an intermediate state,
and an intermediate state nobody would deliberately ship: the change costs
the same to make as the one that works. Reporting it beside the fix would
suggest a spectrum where there is a right answer.

| Treatment | Runs | Completed | Read instead |
|---|---:|---:|---|
| [`prefix-append`](prefix-append/WITHDRAWN.md) | 3 | 3 | `live-append` |
| [`prefix-compact`](prefix-compact/WITHDRAWN.md) | 1 | 1 | `live-compact` |
| [`prefix-droptools`](prefix-droptools/WITHDRAWN.md) | 3 | 3 | `live-droptools` |
| [`t-compliance:prefix-append`](t-compliance-prefix-append/WITHDRAWN.md) | 1 | 1 | `t-compliance:live-append` |

## `deleted-trap` — withdrawn: composed wrong

Both fixes are applied here, and composed wrong: the volatile churn still
lands inside the conversation span, so the cache breaks anyway and the
composition buys nothing. It is the trap worth knowing about, which is why
the runs ship, but its cost is a property of the mistake rather than of
either fix.

| Treatment | Runs | Completed | Read instead |
|---|---:|---:|---|
| [`fullvol-append`](fullvol-append/WITHDRAWN.md) | 4 | 3 | `live-append` |
| [`t-compliance:fullvol-append`](t-compliance-fullvol-append/WITHDRAWN.md) | 1 | 1 | `t-compliance:live-append` |

## `excluded-lineage` — excluded as a result, not a gap

Sliding-window trimming drops a web_search that a later web_fetch depends
on, so most of these runs 400 out. That is the finding: on this loop the
tactic is not merely expensive, it is unsafe. The runs are excluded from the
cost tables because a crashed run bills a partial conversation and would
read as cheapness — not because the tactic went unmeasured.

| Treatment | Runs | Completed | Read instead |
|---|---:|---:|---|
| [`full-window`](full-window/WITHDRAWN.md) | 1 | 0 | — |
| [`prefix-window`](prefix-window/WITHDRAWN.md) | 1 | 0 | — |
| [`t-compliance:full-window`](t-compliance-full-window/WITHDRAWN.md) | 1 | 1 | — |
| [`t-compliance:prefix-window`](t-compliance-prefix-window/WITHDRAWN.md) | 1 | 0 | — |

## `superseded` — withdrawn: the earlier naming

This is the correct composition under its earlier name, measured against a
frozen run context. The published rows re-ran it against a live one, which
is the condition an actual agent runs in. The numbers here are sound; they
are simply the earlier lineage, kept as evidence rather than printed twice
under two names.

| Treatment | Runs | Completed | Read instead |
|---|---:|---:|---|
| [`full-append`](full-append/WITHDRAWN.md) | 4 | 3 | `live-append` |
| [`full-append-fetchcap`](full-append-fetchcap/WITHDRAWN.md) | 1 | 1 | — |
| [`full-append-fetchcap8k`](full-append-fetchcap8k/WITHDRAWN.md) | 3 | 3 | `live-append-fetchcap8k` |
| [`full-compact`](full-compact/WITHDRAWN.md) | 4 | 3 | `live-compact` |
| [`full-droptools`](full-droptools/WITHDRAWN.md) | 4 | 3 | `live-droptools` |
| [`full-droptools2`](full-droptools2/WITHDRAWN.md) | 3 | 3 | `live-droptools2` |
| [`t-compliance:full-append`](t-compliance-full-append/WITHDRAWN.md) | 1 | 1 | `t-compliance:live-append` |
