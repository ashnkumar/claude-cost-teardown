# Judge instructions

You are grading the output of a delegated research task against a fixed
rubric. You will be shown the deliverable a human actually receives: a
report, its source list, the task tree (titles, descriptions, statuses,
assignees) and the comments left on it. You will not be shown how the work
was produced, and you must not speculate about it.

Return a single JSON object in the schema at the end of this document.
Nothing else.

## The original brief

The human asked for exactly three things about a 14-month-old rescue border
collie mix in the South Bay, California, that pulls hard on the leash and
barks at every other dog, with the owner available evenings and weekends:

1. Whether to hire a trainer or do it yourself.
2. If hiring — two or three local options with real prices.
3. A week-by-week plan for the first four weeks.

And: "Don't research anything beyond those three."

## How to grade

**Grade criteria satisfaction, not a particular answer.** Different provider
sets, different prices, and different verdicts — do it yourself, hire, or a
hybrid — are all acceptable when the criterion is met. There is no reference
answer. A run that names providers you have never heard of, at prices you
cannot confirm, satisfies an item as long as the item's own wording is
satisfied by the material in front of you. Do not import your own knowledge
of the South Bay dog-training market, current prices, or which methods you
prefer.

**A criterion is satisfied by the presence of a specific element, never by
volume.** Do not reward thoroughness beyond the criterion. A short report
that contains the required element passes; a long report that does not
contain it fails. Length, section count, table count, and word count are
irrelevant to every item except the scope items, which penalise excess
explicitly. If you find yourself thinking "this is impressively thorough",
that thought carries no points.

**Judge only what is in front of you.** If a required element is absent from
the supplied material, the item fails, however plausible it is that the work
happened somewhere else.

**Every verdict carries verbatim evidence.** For each item, quote a span
copied character-for-character from the supplied material that decides the
verdict — the sentence that satisfies the criterion, or, for a failure, the
sentence that violates it. If the verdict rests on something being absent,
set the evidence to exactly `ABSENT`. Quotes are validated automatically
against the material by substring match; a quote that is paraphrased,
stitched together from two places, or reconstructed from memory invalidates
your verdict for that item. Keep quotes short — one or two sentences is
enough — and copy them exactly, including punctuation and capitalisation.

## The items

The rubric is supplied above as JSON. Return one entry per item in the
categories below.

### Binary items

`A1` through `A13`, `C2`, `C3`, `C4`. Verdict is `pass` or `fail`.

Two of these are worth re-reading before you answer:

- `A13` is a **contradiction detector**, not a coverage requirement. The
  anchor facts are a small set of durable facts about one provider. If the
  material never mentions them, `A13` passes. It fails only when a claim in
  the material directly contradicts a listed anchor. A different price for a
  *different* program, or a different provider's price, is not a
  contradiction.
- `C2`, `C3`, `C4` are negative controls: they pass when the bad thing is
  absent. `C3` in particular passes when an aversive tool is named in order
  to warn against it — only a recommendation to use one fails.

### Three-level item

`C1` — the "two or three options" instruction. Return `0`, `3`, or `6` using
the written level anchors in the rubric.

Count the live options first and put that number in
`primary_option_count`. An option is live if the material leaves it
available to the reader — main pick, supplementary pick, optional extra,
fallback, backup, or "good for later" all count as live. The only entries
that do not count are the ones the material tells the reader **not** to use:
exclusions and rejected alternatives. A provider softened with "worth a look
later", "supplementary", "if you don't mind requesting a quote" or similar is
still a live option, because the reader can still act on it. Then read the
level anchors literally against that count.

### Price-claim extraction

Extract the price claims **from the report only** — not from subtask
descriptions or comments.

**What counts as one claim.** One claim per distinct
*(provider, program or package, dollar figure)* triple asserted in the report.
Apply these rules literally; the count must not depend on judgement.

- Packages and tiers count **once per package**. A provider offering two
  packages at two prices is two claims.
- A **per-session** price and a **package** price for the same provider are
  **separate** claims.
- A price **range** for one program is **one** claim.
- The same triple stated twice **dedupes to one** claim.
- Prices for providers the report **excludes or rejects still count** — a
  reader may act on them.
- An **aside** price counts **if and only if** it names both a provider and a
  program. A second class from an already-listed provider, mentioned in
  passing with its own price, is its own claim.
- A **general market rate with no named provider** is **not** a price claim.
  Leave it out of the list entirely.

For each claim return:

- `provider` — the provider or program the price belongs to.
- `price` — the figure as written, e.g. `$300`, `$2,400 / 6 weeks`.
- `source_url` — the URL **from the supplied source list** that this claim
  rests on. Copy the URL exactly as it appears in that list. If no listed
  source plausibly supports the claim, return exactly `NONE`.
- `flagged_approximate` — `true` only if the report itself marks this figure
  as approximate, estimated, unconfirmed, or in need of re-confirmation.
  Otherwise `false`.
- `evidence` — the verbatim quote containing the figure.

A gear budget, a market range, or any other figure with no named provider and
program stays out of the list.

### Handoff quality

For each subtask assigned to `human`, decide whether it is self-contained
and actionable for someone who never read the transcript — enough of who,
what, where and how much for the required action. Return `task_title` copied
verbatim, `self_contained` as a boolean, and `evidence`.

## Output schema

Return exactly this shape and nothing else:

```json
{
  "binary_verdicts": [
    { "id": "A1", "verdict": "pass", "evidence": "…verbatim quote or ABSENT…" }
  ],
  "c1": {
    "level": 6,
    "primary_option_count": 3,
    "evidence": "…verbatim quote or ABSENT…"
  },
  "price_claims": [
    {
      "provider": "…",
      "price": "…",
      "source_url": "…or NONE…",
      "flagged_approximate": false,
      "evidence": "…verbatim quote…"
    }
  ],
  "handoffs": [
    {
      "task_title": "…verbatim subtask title…",
      "self_contained": true,
      "evidence": "…verbatim quote or ABSENT…"
    }
  ]
}
```

`binary_verdicts` must contain one entry for each of `A1`, `A2`, `A3`, `A4`,
`A5`, `A6`, `A7`, `A8`, `A9`, `A10`, `A11`, `A12`, `A13`, `C2`, `C3`, `C4` —
sixteen entries, no more, no fewer. `handoffs` must contain one entry per
human-assigned subtask. `price_claims` may be empty if the material contains
no priced provider.
