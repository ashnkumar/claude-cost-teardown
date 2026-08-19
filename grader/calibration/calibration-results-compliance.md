# Compliance grader calibration — rubric-compliance v1.0.0

Second rubric, for `t-compliance` ("Research compliance across 50 states").
Same axes and weights as the t-dog rubric (A 60 / B 20 / C 20), same judge
protocol, same B and C machinery. Content items re-authored from the brief.

Reproduce: `node grader/calibration/build_controls.mjs` then

```
node scripts/experiments/grade.mjs grader/calibration/compliance \
  --rubric=grader/rubric-compliance.json --label=compliance
node scripts/experiments/grade.mjs grader/calibration/compliance-degraded \
  --rubric=grader/rubric-compliance.json --label=compliance-degraded
```

## Results

| | sample | degraded |
|---|---:|---:|
| **score_total** | **80 / 80** | **71 / 80** |
| score_A_content | 60 / 60 | 54 / 60 |
| score_B_grounding | n/a | n/a |
| score_C_scope | 20 / 20 | 17 / 20 |
| judge_agreement_pct | **100%** | **100%** |
| contested | — | — |
| report chars | 12,842 | 5,417 |
| agent subtasks | 10 | 4 |

Only two items moved: **A8** (penalties, 6 → 0) and **C1** (coverage of the
six asks, 6 → 3).

| # | Criterion | Result |
|---|---|---|
| 1 | Sample lands 65–90 | **PASS** — 80/80, though see the ceiling note. |
| 2 | Degraded ≥12 below sample | **FAIL** — −9. Structural; see below. |
| 3 | ≥85% unanimity | **PASS** — 100% on both. |

Axis B is **not exercised at all**: no trace or usage was ever captured for
the compliance sample, so B1–B4 are `n/a` and the score normalises over A+C.
The legal-claim definition in B2 has therefore never run against real data.

## Why the degraded control stalls at −9

Three successive cuts, each faithful to the counterfactual "the
per-jurisdiction risk research never happened", each re-graded, all landing on
exactly **−9**:

1. Cut the `## Risk tiers` section (5,448 chars) and the six risk-research
   agent subtasks, and drop the closing comment (which restates the whole risk
   analysis). → 71/80.
2. Also cut `## The short answer` (whose table names three jurisdictions with
   the mechanism that makes each dangerous) and `## Watch list`. Report down to
   5,417 chars, 58% of it gone. → **71/80, unchanged.**
3. Checked the tree before cutting further. That is where it stops being
   principled.

The evidence quotes say exactly why. With the entire risk analysis removed
from the report, A7, A9 and A10 still pass — on **subtask descriptions**:

- **A7** (private right of action) passes on *"No private right of action
  anywhere except California's narrow breach-only PRA"* — from the surviving
  **comprehensive state privacy laws** subtask. That finding is genuinely not
  risk-derived; deleting it would be tuning the control, not modelling it.
- **A9** (dangerous jurisdictions + mechanism) passes on *"If it is a business
  choice, we are exposed to $1,000/day per user plus attorneys' fees"* — from
  a **human decision subtask**.
- **A10** (differentiated risk) passes on *"our Illinois exposure — by far the
  largest single risk"* — from the **counsel-question subtask**.

Scanning every subtask description for a risk assertion (a penalty figure, a
private right of action, a named danger) matches **11 of 12**. The phrase
"exposure" appears in the retention and consent-flow subtasks, which are not
risk-research outputs at all.

**So there is no load-bearing section here.** The compliance deliverable
carries its risk analysis in at least five places — report summary table,
report tier section, watch list, agent subtask descriptions, human subtask
descriptions — and both comments. Removing enough copies to cost 12 points
means deleting most of the tree, at which point the artifact is not "a run
that did less research" but a different tree shape, which also moves C5 and
B4 and stops being a clean instrument.

This is the third time the same property has shown up (t-dog's plan lived in
the tree; t-dog's controls needed subtask cuts; now this). For a 90-minute
deep-research deliverable the redundancy is a **feature** — the human gets the
answer whichever surface they read — and it makes section-removal a weak
degradation instrument.

## Recommended fix: a shallow control, not a subtractive one

Rather than cutting more, build the compliance control **subtractively on
particulars instead of on sections**: the same six asks, the same structure,
the same subtask tree — with every hard particular removed. No dollar figures,
no statutory citations, no named cases, no numeric periods, no per-jurisdiction
mechanisms. "Illinois is the most dangerous state and penalties there are
significant" instead of "$1,000/$5,000 per violation plus fees".

That targets A8, A9, A10 and B2 directly, and it is a better model of the
degradation we actually expect from trimmed and compacted variants — which
produce content that is **thinner, not missing**. It also connects to the
axis-A ceiling finding on t-dog: absence is easy to detect, thinness is what
the rubric has not yet been shown to catch.

Not built unilaterally — it changes what the control *is*, which is the
designer's call.

## The sample scores 80/80

Every item passes. The band criterion is satisfied, but there is **no
demonstrated headroom**: this rubric has not been shown to distinguish a good
compliance run from an excellent one, only from a degraded one. Same shape as
the t-dog axis-A ceiling, but across both scored axes.

With n=1 real artifact there is no way to tell "the rubric is too easy" from
"the sample is excellent" — and it is a strong memo. The items were authored
from the brief before any score was seen, and several are demanding on their
face (A8 needs concrete figures for ≥3 named jurisdictions each tied to a
cited source; A12 needs both a disclaimer *and* a specific escalation; A9
needs the mechanism, not just the name). Flagged rather than tightened:
harshening after seeing the only artifact max it out is the overfit this
design exists to prevent.

## Judge cost

Compliance calibration: 3 gradings (sample, degraded, degraded re-cut),
12 calls, **$5.41**. Cumulative grader spend across both rubrics: **$26.73**
over 100 calls.

---

## The particulars-stripped control (approved second attempt)

Section-cutting was the wrong instrument, so the approved control models
**thinner, not missing**: same six asks, same structure, same tree, with every
hard particular replaced by its vague form — no dollar figures, no statutory
citations, no named cases, no numeric periods, no per-jurisdiction mechanisms
— applied to the report, the subtask descriptions **and** the comments.

Built deterministically by `build_controls.mjs`: lexical particulars are
regex strips, and the mechanism clauses (which are semantic and cannot be
regexed) are an explicit listed set of replacements, auditable in the script
rather than hidden in a hand-edited file. Residual after stripping: one italic
case name (`*Cisneros*`) in the watch list — immaterial to every scored item,
and blanket-stripping bare `*Word*` italics would have mangled the emphasis
markup.

| | sample | section-cut | **particulars-stripped** |
|---|---:|---:|---:|
| **total (/80)** | **80** | 71 | **74** |
| score_A_content | 60 | 54 | **54** |
| score_C_scope | 20 | 17 | **20** |
| unanimity | 100% | 100% | 94.44% |
| report chars | 12,842 | 5,417 | 13,116 |

**−6. Further from the gate than the section cut.** And **exactly one item
moved: A8.**

### Why only A8 fired

A8 is the only content item whose wording demands a *particular*: "concrete
figures — statutory damages, per-violation amounts or a stated exposure range
— for at least three named jurisdictions". It failed unanimously, quoting
*"a substantial sum per violation, counted per capture and per disclosure"*.

Every other item asks for the presence of a **topic**, and the topic survives
vagueness intact:

| Item | Passed on |
|---|---|
| A5 retention | *"'purpose satisfied' is the operative trigger in IL, TX and CO alike"* — my own wording allows "a defined trigger" as an alternative to a deadline, and a trigger needs no number. |
| A9 dangerous + mechanism | *"The dominant variable is a route for claims with monetary consequences and cost consequences"* — the mechanism *structure* survives when the mechanism's content is vague. |
| A2 thresholds | *"dedicated biometric statutes. No thresholds. Live from user one, day one."* |
| A4 written consent | *"CUBI does not require a signed written release (informed consent suffices)"* |
| A6 destruction | *"Deletion must reach backups and vendors."* |

**The content axis rewards saying the right kind of thing, not saying it with
verifiable specificity.** For a deliverable whose entire value *is*
specificity, that is a real weakness — and it is precisely the
thinner-not-missing blind spot the control was built to probe. The control
worked; the rubric did not pass it.

### Axis B does not rescue it

Tested directly, because the judge extracts legal claims on every run whether
or not axis B is scored:

| | claims extracted per pass |
|---|---|
| sample | 36 / 33 / 37 |
| section-cut | 10 / 12 / 10 |
| particulars-stripped | **9 / 7 / 7** |

Stripping cuts extractable claims by **~78%** — but **B2 is a ratio, not a
count**. A run making 8 vague claims all resting on fetched sources scores
B2 = 6/6, identical to a run making 35 precise ones. B1 is text-independent
entirely.

So **the density of verifiable specificity is unmeasured anywhere in the
rubric.** That is the gap, and it is a design question rather than a wording
fix, so it goes to the rubric's author rather than being patched here.

### Redundancy as a named finding

Third occurrence across two tasks: **the two-wave tree pattern makes the
deliverable robust to single-surface loss — and makes naive section-cutting a
weak degradation model.** The plan lived in t-dog's tree; t-dog's controls
needed subtask cuts; the compliance risk analysis lives on five surfaces at
once. For the human this is a feature. For anyone building a degradation
control it means the counterfactual has to be applied to every surface, and
even then the deliverable degrades gracefully rather than falling over.

---

# v1.1.0 — the version of record

A5 and A9 tightened to demand a checkable particular, per the rubric author's
ruling, after the particulars-stripped control produced a false PASS on both.
A2, A4 and A6 deliberately unchanged: their passes on the stripped artifact
are *correct* — "No thresholds. Live from user one", "informed consent
suffices", "deletion must reach backups and vendors" are themselves checkable
particulars that survived only because there was no number in them to strip.

- **A5** now requires a numeric period with a unit tied to a named
  jurisdiction — a deadline, a maximum, or an event trigger *paired with its
  numeric backstop*. A purely event-based answer fails however precisely the
  trigger is described. (Task-derived: the statutes themselves pair every
  trigger with a numeric backstop, and a retention rule with no number cannot
  be scheduled against.)
- **A9** now requires the mechanism to be **named** — private right of action,
  statutory damages, an outright prohibition, a necessity test, per-day
  accrual. It deliberately does **not** require a figure; that is A8's job, so
  no artifact loses both for the same gap.

## Gate

| | sample | particulars-stripped | section-cut |
|---|---:|---:|---:|
| **total (/80)** | **80** | **60** | 71 |
| score_A_content | 60 | 43 | 54 |
| score_C_scope | 20 | 17 | 17 |
| unanimity | **100%** | 94.44% | 88.89% |
| extracted_claims (median) | **39** | **7** | — |

**Particulars-stripped lands at −20**, against a gate of ≤ −12.

| Criterion | Result |
|---|---|
| 1. Sample re-passes 80/80, A5/A8/A9 unanimous, evidence cites real numbers/mechanisms | **PASS** — A5 on *"TX 1 year after purpose expires, CO 24 months after last interaction, IL 3 years"*; A8 on *"$1,000 negligent / $5,000 reckless per person"*; A9 on *"The only unrestricted PRA"*. |
| 2. Stripped ≤ −12, A5/A8/A9 failing | **PASS at −20.** A5 0/5 unanimous, A8 0/6 unanimous, A9 0/6 on a 2–1 majority, plus C1 6→3. |
| 3. Unanimity ≥85% including tightened items | **PASS** — 100% / 94.44% / 88.89%. |
| 4. Section-cut re-graded for the record | −9, unchanged. The tightened items do **not** move it: A5 stays 5/5 (the retention section survives that cut with its numbers intact) and A9 stays 6/6. Correct — that control removes sections, not particulars, and the two instruments probe different failure modes. |

## The first run exposed a gap in the control, not the rubric

The initial 1.1.0 grade of the stripped control landed at −14 with **A9
passing**. The evidence showed why, and it was not a rubric problem: A9 was
passing on genuine mechanism names the strip had missed —

- *"the **conditioning prohibition** — we may not refuse service…"* — markdown
  bold split the phrase out of reach of a plain-text regex;
- *"per day, per violation"* — per-day accrual was never in the mechanism list;
- plus `accrual`, `strictly necessary`, `unless the biometric is necessary`.

Five replacements added, control rebuilt, re-graded: **−14 → −20**, with A9
now failing. The tightened wording was doing its job the whole time; the
control was under-testing it.

One mechanism name still survives — A9's single remaining PASS quotes *"it is
a flat BAN, not a consent regime — no consent flow cures it"*, which is a
correctly-identified prohibition. The item fails 2–1 regardless and the gate
clears by 8 points, so the control is left as-is: it under-tests in the
conservative direction, which is the safe direction for a gate.

## extracted_claims — measured, never scored

Added as an unscored behavioural column for both tasks, per ruling. The
stripped control drops from **39 claims to 7** (−82%).

It earned its place immediately on real stage-1a data. `full-compact` makes
**one** extractable price claim and scores **B2 = 6/6**; `full-append` makes
**13**, grounds 12 of them, and scores **5.54/6** — *lower*. B2 is a ratio, so
it rewards saying less. That is the density blind spot on live experimental
data rather than a synthetic control, and it is the case for promoting the
column to a scored measure in stage 2 with a data-derived floor.

`abandoned_subtasks` was added alongside it on the same measure-first basis.
Both backfill onto every existing grade from persisted artifacts, so no
re-grading was needed to populate them.

**Caveat for readers of the symptoms panel:** a crashed run trivially leaves
subtasks `not_started`, so both window cells show `abandoned_subtasks: 1`
without the elision mechanism being involved. Read the column next to
`completed`.
