# The grader

This directory is the quality instrument, and the record of the one before it
that had to be thrown away.

The cost numbers in the top-level README are arithmetic on billing data — you
can recompute them from the run artifacts without trusting anything here. The
quality numbers all come from this directory, so this is where you should look
if you want to decide whether to believe them.

**In:** two finished reports for the same task, plus the task's reference
material. **Out:** a signed quality index for the pair, on a ±8 scale, and a
set of deterministic flags.

The judge never sees the transcript — only the finished report. That is
deliberate: transcript length varies systematically with the treatment, so a
judge that could see it could infer which arm it was looking at and grade the
process instead of the product.

---

## The short version

An absolute scoring rubric was built, measured against a human blind ranking,
and **retired for cause.** A head-to-head forced-choice instrument replaced it.
Every quality figure published anywhere in this repo comes from the
replacement. The retired rubric's files are still here, on purpose.

You are welcome to conclude that the first instrument was a bad idea. The point
of leaving it in the repo is that "we measured our measurement and it failed"
is the part that usually gets deleted before publication, and it is the part
that tells you whether the surviving number means anything.

---

## Four stages, not two

The arc is easy to compress wrongly, so here it is in order:

| | Stage | What it was |
|---|---|---|
| 1 | judge-partial | 22 items, of which 13 were LLM-judged and the rest mechanical |
| 2 | **judge-free** | `deterministic.py` — the LLM removed entirely, scoring only what could be checked mechanically |
| 3 | judge-first absolute | 19 anchored items, 100 points, the judge given the whole call |
| 4 | **head-to-head** | forced choice per dimension, no absolute score at all |

Two things people get wrong about this arc, including people who worked on it:

- **The LLM judge was not the failure, and it was not the fix.** An LLM judge
  was present at stage 1, deliberately *removed* at stage 2 to see how far
  mechanical checks alone could go, and brought back at stage 3. What changed
  between stages 3 and 4 is the **question it was asked**, not whether it was
  used.
- **"Only the question changed" is true for 3 → 4 and false for the whole
  arc.** Stage 2 exists precisely because the judge-free option was tested
  rather than assumed.

---

## What actually failed, and how it was proven

Round-1 calibration: 8 blind pairs on the open-ended task. A/B randomised, every
label stripped. It is the only signal in this project that is not downstream of
a rubric written by the same person who built the agent.

**The absolute rubric agreed with the human ranking 4 times out of 8** — a coin
flip — and three of the four misses were ties where the human had a clear
direction.

The diagnosis, from `compare-judge.py`:

```
agreement: 4/8   (judge called 3 tie(s) where he had a direction)
12 of 19 items are at max on >=85% of reports, worth 60 of 100 points.
score distribution over 14 reports: 76 .. 97, mean 92.3, sd 5.5
```

**Sixty of the hundred points were a constant.** An item at its top anchor
everywhere raises every score and separates nothing. On the pair the human
called *clearly* decided, both reports scored **97.0 — every one of the
nineteen item scores identical.**

The obvious response is to reweight. That was tested before anything was
rebuilt, from `reweight-test.py`:

```
searched 11,466 weightings over the 7 live items
best agreement reachable: 6/8
weightings achieving 8/8: 0
```

**It was not a weights problem.** No reweighting of the items that still moved
could reach the human's ranking.

The finding that decided the rebuild is subtler, and it is the reason the
replacement is shaped the way it is: on that same pair, **the judge's own
free-text verdict named four differences, all favouring the report the human
preferred**, while all nineteen item scores came out identical. The judge could
see it. The anchors were compressing it away.

So the failure was not "the judge is blind" and not "the rubric is missing
dimensions." It was that **an absolute anchored scale destroys signal the judge
already has.** Re-anchoring would have been treating the symptom.

---

## What replaced it

Forced choice, per dimension, on the finished reports only:

- **No overall ties.** The judge must pick.
- **A verbatim quote from each report**, substring-validated against the source,
  for every dimension it decides.
- **Every pair judged in both orders**, so position bias is *measured* rather
  than asserted.

On the same 8 calibration pairs it moved the human's strong calls from 2/4 to
3/4, eliminated all 3 ties, matched his stated confidence on 3 of the 4 correct
calls, and measured position bias at 1 pair in 8. The pair that flips on order
is recorded as EQUAL with a bias flag rather than as a confident wrong answer.

That calibration run is `judge/out/t-dog-calibration/results.json`, and
`score-pairwise.py --calibration` recomputes all five figures from it.

---

## The limits, stated up front

These are properties of the instrument, not caveats bolted on afterwards.

**The noise floor was measured before anything was compared.** Running an
identical configuration against itself yields a non-zero spread: **3.83 index
points on the open-ended task, 3.46 on the compliance task.** Any gap smaller
than that is not a quality difference, and is reported as *no measurable
change* — never as an improvement.

**On the compliance task the instrument resolves nothing.** The runs are too
alike for the judge to separate them against that floor. That task therefore
carries cost figures and no quality column anywhere in this repo. It is a
limit of the measurement, not a finding about the runs.

**Density anti-predicts, so it is excluded from the score.** It is still
computed and still reported. In this corpus the reports carrying the detail the
human wanted are the longer ones, so scoring conciseness would point the wrong
way. Dropping a dimension after seeing the data is a real degree of freedom;
it is disclosed here rather than quietly applied.

**The per-dimension results are not claims.** Ordering 8 pairs one dimension at
a time, grounding reaches 6/8. Thirty-one subsets against eight pairs is more
than enough freedom to find noise, which is the same trap as the weight search
above. Round 2 was cancelled, so this stayed unvalidated and nothing is built
on it.

**One calibration pair discloses that it is the control.** Pair 4's header
tells the ranker that an identical configuration produced both reports. That
reveals which pair is the noise-floor control; it does not identify any
treatment arm. Noted here because a reader will find it.

---

## What you can re-run from this clone, and what you cannot

Two files this instrument depends on are deliberately not published, so parts
of this directory are a record rather than a reproduction. That is stated here
instead of being discovered.

**`calibration-key-round1.json` — never ships.** It maps each blind pair to the
runs behind it. Publishing it would retroactively unblind the only
label-free signal in the project.

**`data/example-completed.json` — not in the repo.** The calibration controls in
`calibration/` were built from it. They are provided **as built** and cannot be
regenerated from a fresh clone.

**So four scripts here say what they cannot do, instead of doing it.**
`compare-judge.py`, `reweight-test.py`, `calibration-analysis.py` and
`fit-round1.py` each need the withheld key, and each exits with one line saying
so. **Their outputs are quoted verbatim above, so the evidence is here even
though the command is not runnable.** The other five that ship —
`deterministic.py`, `score-sweep.py`, `score-pairwise.py`,
`judge/build-facts.py` and `calibration_shim.py` itself — run from a clean
clone with no key and no network.

*That used to be worse, and it is worth recording how.* `calibration_shim.py`
loaded the key at *import* time, so all six scripts that import it died on a
`FileNotFoundError` traceback before printing anything — including three that
only ever wanted the inline blind-ranking constants and never needed the key at
all. Two of the six then carried their own loader and kept crashing after the
shim was guarded. Nothing caught either round: the ship-set audit asks whether
anything forbidden got *in*, which is a different question from whether what
got in still runs.

**Half the head-to-head validation is checkable without the key, and half is
not.** The judge's own output ships in full, so **zero ties and the 1-in-8
position bias can be verified directly from
`judge/out/t-dog-calibration/results.json`** — count `OVERALL` and
`position_bias` across the eight pairs. Agreement with the human ranking (4/8
overall, 3/4 on his strong calls, 3/4 on margin) compares that file against the
withheld key, so it can be recomputed by anyone holding the key and not by a
public reader.

*Provenance note, because this was nearly published as a limitation that does
not exist:* the production sweep once overwrote the calibration run in place.
The original output was recovered and restored to its own directory —
`judge/out/t-dog-calibration/` — so the two cannot collide again; that
restored directory is the record.

**What survives as evidence:** the retired rubric and its anchors, the judge
prompts for both instruments, the deterministic scorer, the reweighting search,
the calibration run above, and the full production sweeps the published quality
columns are computed from.

---

## `score_total` is the retired instrument's output

`experiments/results/results.csv` and `cost_quality.csv` still carry a
`score_total` column, `scripts/experiments/grade.mjs` still computes it, and
`hero-chart.mjs` still plots it. **That column is the absolute rubric's score —
the instrument this document is about.**

It is retained deliberately. Deleting measurements because they were superseded
is the habit this repo is arguing against, and the same reasoning keeps the
withdrawn treatment runs in `experiments/`. But it is **cited nowhere**, and
nothing in either README is computed from it — `readme-table.mjs` does not read
it. If you are looking for the quality numbers, they come from the pairwise
results, not from this column.

---

## Files

| | |
|---|---|
| `judge/system-t-*-pairwise.md` | the live instrument's prompts |
| `judge/run-pairwise.mjs` · `score-pairwise.py` | run it · score it (`--calibration` for the 8 blind pairs) |
| `judge/out/t-dog-calibration/` | the 8-pair validation run behind the figures above |
| `judge/system-t-*.md` · `rubric*.json` | the retired absolute rubric |
| `compare-judge.py` | the diagnosis: where the rubric agreed and where it saturated |
| `reweight-test.py` | the exhaustive search that ruled out reweighting |
| `deterministic.py` | the judge-free scorer from stage 2 |
| `calibration/` · `calibration-round1.html` | the blind-ranking materials |
| `price-ledger.json` · `statute-ledger.json` | pricing and the compliance task's ground truth |
