# You are grading one research report against what the person who asked for it
# actually wanted.

The report was produced by an agent given a task by a real person — a founder
about to launch. That person has since read eight reports on a *different* task
blind, ranked them, and said in his own words what made the difference. His
priorities transfer, and this rubric encodes them. Where they conflict with
generic report-quality advice, his win.

## What he told us, in his words

- On covering the options: *"It only goes into detail on the recommended one.
  That's a killer."* → here: a report that does Illinois properly and gives every
  other state a one-line stub has the same defect.
- On the decision: he complained that working out *"when I want the trainer and
  when I don't"* took too much reading. → here: which states are dangerous, and
  by what test, has to be gettable without reading the whole document.
- On deferring detail: *"I want the report to be comprehensive and THEN the
  subtasks encapsulate all that into actionable steps."* Not the other way round.
- On length: *"It's not necessarily that longer is better… I would love those
  longer ones in a more concise way — fewer words but keeping the density of
  information."* · *"One knock against the super long ones is that they're pretty
  verbose and a lot to read."*

## Two rules that override your instincts

**1. Length is not a virtue and it is not a vice.** You are given a character
count as context for the density items ONLY. A fifty-state answer is inherently
table-shaped; a report that says the same things in half the words scores higher,
not lower.

**2. Every score above zero needs a verbatim quote from the report.** The quote
is checked programmatically as a substring of the report text, and an item whose
evidence does not match is discarded and re-scored as zero. Do not paraphrase, do
not fix typos, do not stitch fragments together.

You are not told which model, settings, or configuration produced this report.
Nothing about how it was generated is relevant.

---

# The task the agent was given, verbatim

> We're shipping a consumer mobile app that scans a user's face to verify
> identity at signup, and we charge a monthly subscription. Before launch I need
> to know, state by state, which biometric privacy laws apply to us, what notice
> and written consent we have to collect, how long we're allowed to retain the
> scan, whether there's a private right of action, and what the penalties are.
> Flag the states that are genuinely dangerous to launch in.

Six things are being asked for, and five of them are *per state*: applicability,
notice and written consent, retention, private right of action, penalties — plus
the danger call across all of them. A report that answers three of the five
thoroughly has not done the job.

The facts of the product matter and are all in the prompt: **consumer** mobile
app, **face scan**, at **signup** (so once per user, not per session), a
**monthly subscription** (so an ongoing relationship, which bears on retention),
and **pre-launch** (so this is a build decision, not a remediation).

---

# The rubric — 100 points, five sections

Score each item at one of its anchored levels. Do not interpolate. Between two
anchors, take the LOWER and say why.

## A. The launch decision — 20 points

**A1 · Is there an explicit list of dangerous states? (0 / 2 / 4)**
- 4 — a named, bounded list you could act on
- 2 — danger discussed but never resolved into a list
- 0 — no danger call at all

**A2 · Is "dangerous" defined by a test, not a vibe? (0 / 3 / 6)**
- 6 — states the criteria and applies them visibly: private right of action,
  damages exposure, statutory-damages multiplication, enforcement history
- 3 — asserts which states are risky with reasons that are not a repeatable test
- 0 — a list with no stated basis

**A3 · Is it about THIS product? (0 / 3 / 6)**
The facts available: consumer app, face scan, at signup, monthly subscription,
pre-launch.
- 6 — the analysis turns on at least three of those — e.g. that signup-only
  capture is one collection per user, what the subscription means for retention,
  what being pre-launch lets him design in
- 3 — generic biometric-law summary with the product mentioned
- 0 — would read identically for any biometric product

**A4 · Can he get the danger list without reading the report? (0 / 2 / 4)**
- 4 — up top or in a table, scannable
- 2 — present but must be assembled from prose
- 0 — buried

## B. State-by-state coverage — 30 points

The section he would care about most. Read it hardest.

**B1 · Breadth (0 / 4 / 8)**
Four states have dedicated biometric statutes. A much wider set of comprehensive
consumer-privacy statutes classify biometrics as sensitive data requiring opt-in
consent, and the question asked was "state by state".
- 8 — covers the dedicated-statute states AND the wider sensitive-data layer,
  and is explicit about which states fall in which bucket
- 4 — the dedicated-statute states only, with the wider layer mentioned but not
  worked through
- 0 — Illinois plus hand-waving

**B2 · Per-state depth — the killer item (0 / 4 / 8)**
- 8 — every state it covers gets its own cells actually filled
- 4 — one or two states are done properly and the rest are stubs
- 0 — only Illinois is real

**B3 · Can he look up a state? (0 / 2 / 4)**
- 4 — a table keyed by state, with the asked-for fields as columns
- 2 — organised by state but as prose sections
- 0 — organised by concept, so answering "what about Texas" means reading it all

**B4 · Does it separate "no law" from "not researched"? (0 / 2 / 4)**
A founder acting on this needs to know where the silence is.
- 4 — states its own coverage boundary explicitly
- 2 — implies it
- 0 — presents partial coverage as if complete

**B5 · Named statutes (0 / 2 / 4)**
- 4 — the specific act and section for each covered state
- 2 — statute names for the big ones only
- 0 — "Illinois has a biometric law"

**B6 · A state that clearly matters and is missing (0 / 1 / 2)**
Judge against the ledger's verified states plus any obviously in-scope
jurisdiction. The ledger is not a 50-state census, so do not treat its silence as
evidence.
- 2 — nothing important missing · 1 — one gap · 0 — several

## C. The five required fields — 30 points

**C1 · Which laws apply, and to whom (0 / 2 / 6)**
- 6 — applicability worked out, including thresholds and exemptions that decide
  whether this company is in scope at all
- 2 — names the laws without saying whether they reach this company
- 0 — absent

**C2 · Notice and written consent, implementably (0 / 3 / 8)**
He has to build a signup flow from this.
- 8 — what the screen must say, when it must appear relative to capture, whether
  it must be a separate writing, and whether an electronic signature counts
- 3 — "get written consent"
- 0 — absent

**C3 · Retention (0 / 2 / 4)**
- 4 — actual limits with their triggers, per state where they differ
- 2 — a general "delete when done"
- 0 — absent

**C4 · Private right of action — the highest-stakes field (0 / 4 / 8)**
This is the field that decides the danger call, and it is the one most often got
wrong. Check it against the ledger.
- 8 — correct per state, and the consequence drawn out
- 4 — right about Illinois, vague or unstated elsewhere
- 0 — absent, or wrong about any ledger-verified state

**C5 · Penalties, with the unit (0 / 2 / 4)**
Per violation, per person, or per scan changes the number by orders of magnitude.
- 4 — figures with the unit, and what multiplies them
- 2 — figures without the unit
- 0 — absent

## D. Density and readability — 15 points

**D1 · How much of this text is load-bearing? (0 / 2 / 4 / 6)**
Before scoring, do the work: **find the passages you would delete without losing
a single decision-relevant fact.** Quote up to five. Boilerplate legal hedging
repeated per state, restatement of the request, and the same rule given twice all
count.
- 6 — at most one deletable passage · 4 — a few, all short · 2 — several, or one
  long stretch saying nothing new · 0 — a quarter could go
If the report is long and you cannot name any deletable passage, look again.

**D2 · Does the formatting compress? (0 / 2 / 3 / 5)**
- 5 — a state × field matrix doing the work a table should; matter-of-fact
- 3 — structured, but prose is carrying what a table would carry better
- 2 — headings only
- 0 — a wall of text, or so much formatting the content hides

**D3 · A consolidated "before launch, do this" (0 / 2 / 4)**
- 4 — present, specific, ordered · 2 — vague or scattered · 0 — absent

## E. Grounding and currency — 5 points, plus flags NOT averaged in

The FACTS block carries a statute ledger: cells read off primary sources, with
effective dates. It is a **verified whitelist of the cells that discriminate, not
a 50-state census.** A claim about a state absent from the ledger is UNVERIFIED —
never "wrong".

**E1 · Does it hold up where we can check it? (0 / 2 / 5)**
- 5 — every ledger-verified cell it touches is right, and it is current
- 2 — one verified cell wrong or out of date
- 0 — more than one wrong

**FLAGS — report each independently; they do not enter the 100.**
They ride beside the score because averaging them away is how a report with a
launch-changing legal error ends up looking fine. Format each as
`FLAG :: verbatim quote :: which FACT grounds it`.

- `STALE_BIPA` — describes Illinois damages as accruing per scan, or cites
  *Cothron v. White Castle* as current, **without** the August 2024 amendment
  that caps recovery at one per person per method. This is the single most
  consequential error available on this task: it makes a per-login face scan look
  like unbounded liability when the statute no longer works that way. Set it only
  on positive grounds from the FACTS block.
- `PRA_WRONG` — asserts a private right of action in a state the ledger shows has
  none, or denies Illinois's
- `FABRICATED_STATUTE` — cites an act, section or case that does not exist, or
  attributes a provision to the wrong statute
- `DEAD_CITATION` — a claim resting on a cited URL that does not resolve
- `NO_COUNSEL_CAVEAT` — tells him he is clear to launch on the strength of this
  document, with no indication that a 50-state biometric position needs counsel
- `OFF_SPEC` — substantial material outside the six things asked for

---

# How to work

1. Read the report once as the founder would, looking for his own state.
2. Do the D1 deletion pass before scoring anything. It stops the length reflex.
3. Check every ledger-verified cell the report touches. Note what it got right,
   not only what it got wrong.
4. Score each item, lower anchor when between two.
5. For every non-zero item, copy a verbatim substring as evidence.
6. Set the flags, with grounds.
7. Do not total the score. The harness sums it.

Return your answer through the structured output tool. No prose outside it.
