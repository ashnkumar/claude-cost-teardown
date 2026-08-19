# You are choosing between two research reports, on behalf of the founder who asked for them.

Both reports answer the same question, for the same person, from the same prompt.
Your job is not to score them. It is to say **which one he would rather have
received**, dimension by dimension, and then overall.

This is a comparison, not a grading exercise, and the difference matters. An
earlier version of this task asked for absolute scores against anchored levels.
It failed in a specific, instructive way: both reports in a pair cleared every
anchor, scored identically on all nineteen items, and the comparison came out a
tie — while the same judge's written summary named four concrete differences that
all pointed the same way. **The information was there and the scale had nowhere
to put it.** So: no scores here. Pick a side.

## What he cares about, in his own words

These are verbatim from the same person, reacting to eight reports on a
*different* task that he read blind. His priorities transfer. Where they conflict
with generic report-quality instincts, his win.

- On covering the options: *"It only goes into detail on the recommended one.
  That's a killer."* → here: a report that does Illinois properly and gives every
  other state a one-line stub has exactly that defect.
- On getting to the answer: he complained that working out *"when I want the
  trainer and when I don't"* took too much reading. → here: which states are
  dangerous, and by what test, has to be gettable without reading the whole
  document.
- On deferring substance: *"I want the report to be comprehensive and THEN the
  subtasks encapsulate all that into actionable steps."* Not the other way round.
- On length: *"It's not necessarily that longer is better. I would love those
  longer ones in a more concise way — fewer words but keeping the density of
  information."* · *"One knock against the super long ones is that they're pretty
  verbose and a lot to read."*
- On formatting: *"It uses tables that make info clear."* · and he twice praised
  a consolidated block of next actions.

## Four rules that override your instincts

**1. Length is neither a virtue nor a vice.** You are given both character counts
as context for the density dimension ONLY. A fifty-state answer is inherently
table-shaped. A report that says the same things in half the words wins density; a
report that is longer *because it covers more states properly* wins coverage.

**2. Every call needs a verbatim quote from each report.** The quotes are checked
programmatically as substrings. A dimension whose quotes do not match is
discarded and recorded as unusable. Do not paraphrase, do not fix typos, do not
stitch fragments together, do not put ellipses inside a quote.

**3. Count nothing. Ask what he would rather have.** "Report 1 names nineteen
states and Report 2 names twelve" is not by itself an answer — nineteen stubs are
worse than twelve filled-in rows. The question is always whether the difference
would change what he builds.

**4. EQUAL is available per dimension and forbidden overall.** On the OVERALL
call you must pick one, even when it is close, and say whether the preference is
CLEAR or SLIGHT. A tie overall is the one answer that is never useful.

You are not told which model, settings, or configuration produced either report.
Nothing about how they were generated is relevant, and speculating about it is a
failure. Neither position (1 or 2) carries any meaning — the order is arbitrary
and gets swapped on a second pass to check you for position bias.

---

# The task both reports were answering, verbatim

> We're shipping a consumer mobile app that scans a user's face to verify
> identity at signup, and we charge a monthly subscription. Before launch I need
> to know, state by state, which biometric privacy laws apply to us, what notice
> and written consent we have to collect, how long we're allowed to retain the
> scan, whether there's a private right of action, and what the penalties are.
> Flag the states that are genuinely dangerous to launch in.

Six things are asked for and five of them are **per state**: applicability,
notice and written consent, retention, private right of action, penalties — plus
the danger call across all of them. A report that does three of the five
thoroughly has not done the job.

The product facts are all in the prompt and they all bear on the answer:
**consumer** app, **face scan**, at **signup** (so once per user, not per
session), a **monthly subscription** (an ongoing relationship, which bears on
retention), and **pre-launch** (a build decision, not a remediation).

---

# The five dimensions

For each one, name the winner, say whether the gap is CLEAR or SLIGHT, and quote
both sides.

## 1 · STATE_COVERAGE — the analogue of the dimension he weighted most heavily

- **Per-state depth is the killer.** Every state the report covers should have its
  cells actually filled. One state done properly with the rest as stubs is the
  defect he called a killer on the other task.
- **Breadth, honestly bounded.** Four states have dedicated biometric statutes —
  Illinois, Texas, Washington, and Colorado since its amendment took effect
  2025-07-01. A much wider set of comprehensive consumer-privacy statutes treat
  biometrics as sensitive data requiring opt-in consent, and the question asked
  was "state by state". A report that works through the dedicated four AND is
  explicit about the wider layer beats one that stops at four silently.
- **Lookupable by state.** He should be able to answer "what about Texas" without
  reading the whole thing. A table keyed by state with the asked-for fields as
  columns is the shape that does this.
- **"No law" separated from "not researched".** A founder acting on this needs to
  know where the silence is. A report that states its own coverage boundary beats
  one that presents partial coverage as complete.
- **Named statutes and sections**, not "Illinois has a biometric law".

## 2 · REQUIRED_FIELDS — the five things asked for, per state

- **Private right of action is the highest-stakes field** — it decides the danger
  call, and it is the one most often got wrong. Illinois is the only state
  biometric statute with a broad private right of action. Check both reports
  against the ledger.
- **Notice and written consent, implementably.** He has to build a signup screen
  from this: what it must say, when it must appear relative to capture, whether it
  must be a separate writing, and whether an electronic signature counts.
- **Applicability** — including thresholds and exemptions that decide whether this
  company is in scope at all.
- **Retention** — actual limits with their triggers, per state where they differ.
- **Penalties with the unit.** Per violation, per person, or per scan changes the
  number by orders of magnitude. A figure without its unit is nearly useless.

## 3 · LAUNCH_DECISION

- **An explicit, bounded list of dangerous states** he could act on.
- **"Dangerous" defined by a test, not a vibe** — private right of action,
  damages exposure, whether statutory damages multiply, enforcement history — and
  applied visibly.
- **About THIS product**: consumer app, face scan, at signup, subscription,
  pre-launch. An analysis that turns on three or more of those beats a generic
  biometric-law summary with the product mentioned.
- **Gettable without reading the report** — up top or in a table.

Note: on the other task this dimension separated reports least. If they are
genuinely level, say EQUAL rather than manufacturing a difference — but read the
*test* and the *product fit* carefully first, because those vary much more than
the list of states does.

## 4 · DENSITY — information gleaned per unit of reading

Not "which is shorter".

- **Load-bearing text.** Before deciding this one, find the passages in each
  report you would delete without losing a decision-relevant fact. Quote up to
  three from each. Boilerplate legal hedging repeated per state, restating his own
  question, and the same rule given twice all count.
- **Formatting that compresses** — a state × field matrix doing the work a table
  should, rather than prose carrying it.
- **A consolidated "before launch, do this"**, ordered and specific.
- **Matter-of-fact register.** He used "verbose" as a criticism.

## 5 · GROUNDING — and currency

The FACTS block carries a statute ledger: cells read off primary sources, with
effective dates.

**Read the ledger's meaning correctly, because the obvious reading is wrong.** It
is a **verified whitelist of the cells that discriminate, not a fifty-state
census.** A claim about a state absent from the ledger is UNVERIFIED — it is *not*
wrong. This distinction was learned expensively on the sibling task, where
fourteen reports were flagged for inventing a price that was published verbatim on
the page they cited.

In order of what matters:

- **The single most consequential error available on this task** is describing
  Illinois damages as accruing per scan, or citing *Cothron v. White Castle* as
  current, **without** the August 2024 amendment (P.A. 103-0769 / SB 2979,
  effective 2024-08-02) that caps recovery at one per person per method. It makes
  a per-login face scan look like unbounded liability when the statute no longer
  works that way. A report that gets this right beats one that doesn't, and the
  gap is CLEAR, not slight.
- **Getting the private right of action wrong** in either direction — asserting
  one where the ledger shows none, or denying Illinois's.
- **A cited statute, section or case that does not exist**, or a provision
  attributed to the wrong statute.
- **A claim resting on a citation that does not resolve.**
- **Telling him he is clear to launch** on the strength of the document, with no
  indication that a fifty-state biometric position needs counsel.
- More independently verified cells is better grounding. Unverified cells are
  neutral — do not penalise them.

## OVERALL

Which report would he rather have received? **You must pick one.** Say whether the
preference is CLEAR or SLIGHT.

Weight it the way he does: state coverage and the required fields carry the most,
grounding matters more here than on the sibling task because a wrong legal cell
changes what he builds, density matters but is a tiebreaker, and the launch
decision separates least. This is a judgment, not an average — a single
launch-changing legal error can decide it on its own.

Give your reasoning as the single sentence you would say to him if he asked why.

---

# How to work

1. Read both reports as the founder would: looking for his own states and what he
   has to build into the signup flow.
2. Do the deletable-passage pass on both BEFORE judging density. It is what stops
   the length reflex.
3. Check every ledger-verified cell each report touches, and note what each got
   right, not only what it got wrong.
4. Judge the five dimensions. Quote both sides on every one.
5. Make the overall call. No ties.
6. Do not mention scores, points, or percentages anywhere. There is no scale here.

Return your answer through the structured output tool. No prose outside it.
