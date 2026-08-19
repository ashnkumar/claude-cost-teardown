# Judge instructions — compliance research task

You are grading the output of a delegated research task against a fixed
rubric. You will be shown the deliverable a human actually receives: a
report, its source list, the task tree (titles, descriptions, statuses,
assignees) and the comments left on it. You will not be shown how the work
was produced, and you must not speculate about it.

Return a single JSON object in the schema at the end of this document.
Nothing else.

## The original brief

The product is a **consumer mobile app that scans a user's face to verify
identity at signup, charging a monthly subscription**. Before launch the
requester asked, state by state:

1. Which biometric privacy laws apply to us.
2. What notice and written consent we have to collect.
3. How long we are allowed to retain the scan.
4. Whether there is a private right of action.
5. What the penalties are.
6. Which states are genuinely dangerous to launch in.

## How to grade

**Grade criteria satisfaction, not a particular answer.** There is no
reference answer. Different runs will name different states, cite different
statutes, quote different figures and rank risk differently — all of that is
acceptable when the criterion's own wording is met. **Do not import your own
knowledge of biometric privacy law to decide whether a claim is correct.** You
are not fact-checking the legal analysis; you are checking whether the
required element is present. The single exception is `A13`, which asks you to
look for direct contradictions of a short frozen anchor list, and nothing
else.

Where a criterion asks for something "named" or "concrete", the test is
whether a reader could act on it — a jurisdiction identified by name, a figure
with a number in it, a period with a unit. Where a criterion asks for a
mechanism or a reason, a bare assertion does not satisfy it.

**A criterion is satisfied by the presence of a specific element, never by
volume.** Do not reward thoroughness beyond the criterion. A short report
that contains the required element passes; a long report that does not
contain it fails. Length, section count, table count and word count are
irrelevant to every item except the scope items, which penalise excess
explicitly. Legal writing rewards itself for exhaustiveness — resist that
here. If you find yourself thinking "this is impressively comprehensive",
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

Six of these are worth re-reading before you answer:

- `A5` requires **a number with a unit** somewhere in the retention answer —
  "no more than 3 years", "within 1 year of the purpose expiring". An event
  trigger passes only when it is paired with its numeric backstop. A purely
  event-based answer with **no numeric bound anywhere fails**, however
  precisely the trigger is described and however many jurisdictions it names.
- `A9` requires the mechanism to be **named** — private right of action,
  statutory damages, an outright prohibition, a necessity test, per-day
  accrual. A paraphrase naming no mechanism ("a route for claims with
  monetary consequences", "restrictive", "notable") fails. It does **not**
  require a damages figure: *"Illinois: private right of action with statutory
  damages"* passes `A9` with no dollar amount in it. Figures are `A8`'s job,
  and an artifact should never lose both for the same gap.
- `A13` is a **contradiction detector**, not a coverage requirement. The
  anchor facts are a short list of durable facts about two statutes. If the
  material never touches them, `A13` passes. It fails only when a claim
  directly contradicts a listed anchor. A different figure for a *different*
  statute, provision or jurisdiction is not a contradiction, and neither is a
  position on a question the anchors do not settle.
- `A12` needs **both** halves — a not-legal-advice framing *and* at least one
  specific matter escalated to counsel or flagged as unresolved. One without
  the other fails.
- `C3` fails only on **unhedged legal conclusions** — a flat assertion that
  the product is compliant or that something is definitively lawful. Reasoned
  risk assessments, probability language, recommendations and rankings all
  pass. Confident analysis is not the same as an unhedged conclusion.
- `C2` and `C4` are negative controls: they pass when the bad thing is
  absent.

### Three-level item

`C1` — coverage of the six asks. Return `0`, `3`, or `6` using the written
level anchors in the rubric.

Work through the six asks in order and count how many the material answers
**substantively**. An ask is answered substantively when a reader gets a
usable answer to it, not merely a mention that the topic exists. Put that
count — a number from 0 to 6 — in `primary_option_count`, then read the level
anchors literally against it.

### Legal-claim extraction

Extract the load-bearing legal claims **from the report only** — not from
subtask descriptions or comments.

**What counts as one claim.** One claim per distinct
*(jurisdiction, legal proposition, figure or citation)* triple asserted in the
report. Apply these rules literally; the count must not depend on judgement.

- A claim counts **only if it carries a hard, checkable particular**: a dollar
  amount, a numeric period, a statute or ordinance citation, or a named case.
- **Two different figures about the same jurisdiction are two claims** — a
  damages figure and a retention deadline are separate.
- A damages figure stated as a **pair or range for one provision** is **one**
  claim.
- The same triple stated twice **dedupes to one** claim.
- Claims about jurisdictions the report **rules out or de-prioritises still
  count**.
- A **general characterisation with no figure, period, citation or case is
  not a claim** — leave it out of the list entirely.
- Forward-looking claims about **pending or proposed legislation count** if
  they carry a particular.

For each claim return:

- `provider` — the **jurisdiction or statute** the claim belongs to, e.g.
  `Illinois BIPA`, `Texas CUBI`.
- `price` — the **particular** as written, e.g. `$1,000 / $5,000 per
  violation`, `1 year after purpose expires`, `740 ILCS 14`.
- `source_url` — the URL **from the supplied source list** that this claim
  rests on. Copy the URL exactly as it appears in that list. If no listed
  source plausibly supports the claim, return exactly `NONE`.
- `flagged_approximate` — `true` only if the report itself marks this claim
  as unverified, uncertain, untested, open, or requiring confirmation.
  Otherwise `false`.
- `evidence` — the verbatim quote containing the particular.

### Handoff quality

For each subtask assigned to `human`, decide whether it is self-contained
and actionable for someone who never read the transcript — clear enough about
what to do, who to ask, or what decision is being made. Return `task_title`
copied verbatim, `self_contained` as a boolean, and `evidence`.

## Output schema

Return exactly this shape and nothing else:

```json
{
  "binary_verdicts": [
    { "id": "A1", "verdict": "pass", "evidence": "…verbatim quote or ABSENT…" }
  ],
  "c1": {
    "level": 6,
    "primary_option_count": 6,
    "evidence": "…verbatim quote or ABSENT…"
  },
  "price_claims": [
    {
      "provider": "…jurisdiction or statute…",
      "price": "…the particular…",
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
human-assigned subtask. The `price_claims` array carries the legal claims
described above; the key name is shared with the other rubric and does not
mean money — put every extracted legal claim there.
