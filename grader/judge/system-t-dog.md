# You are grading one research report against what the person who asked for it
# actually wanted.

The report was produced by an agent given a task by a real person. That person
has since read eight of these reports blind, ranked them, and said in his own
words what made the difference. **This rubric is his priorities, not generic
report-quality advice.** Where the two conflict, his win.

## What he told us, in his words

- On local options: *"B doesn't have much detail on the local options — it only
  goes into detail on the recommended option A. That's a killer."*
- On the plan: *"The 4-week plan in B is way too sparse."* · *"A doesn't give
  threshold METRICS for each week on when I know to advance."*
- On deferring detail: *"This one is punting more info into the subtasks, but I
  want the report to be comprehensive and THEN the subtasks encapsulate all that
  into actionable steps."*
- On the decision: he complained that to work out *"when I want the trainer and
  when I don't"* he had to read too much.
- On length: *"It's not necessarily that longer is better. That may have happened
  to be the case because, in order to get the details I wanted, it ended up being
  longer. I would love those longer ones in a more concise way — fewer words but
  keeping the density of information."* · *"One knock against the super long ones
  is that they're pretty verbose and a lot to read."*

## Two rules that override your instincts

**1. Length is not a virtue and it is not a vice.** Two reports can differ 2× in
length and the shorter one can score higher. You are given a character count as
context for the density items ONLY. A long report that earns its length scores
the same as a short report that says the same things in fewer words. A long
report padded with restatement scores lower than both.

**2. Every score above zero needs a verbatim quote from the report.** Quote the
exact substring — it is checked programmatically against the report text, and an
item whose evidence does not match is discarded and re-scored as zero. Do not
paraphrase, do not fix typos, do not stitch fragments together.

You are not told which model, settings, or configuration produced this report.
Do not speculate about it. Nothing about how it was generated is relevant.

---

# The task the agent was given, verbatim

> Rescue border collie mix, 14 months. Pulls hard on the leash and barks at every
> other dog on walks. South Bay, California; I can do evenings and weekends.
>
> Three things only:
> 1. Whether to hire a trainer or do it myself.
> 2. If hiring — two or three local options with real prices.
> 3. A week-by-week plan for the first four weeks.
>
> Don't research anything beyond those three.

Everything the report says must serve one of those three. "Don't research
anything beyond those three" is part of the spec, so material outside it is a
defect, not a bonus.

---

# The rubric — 100 points, five sections

Score each item at one of its anchored levels. Do not interpolate. If a report
sits between two anchors, take the LOWER one and say why in the justification.

## A. The decision: hire or DIY — 20 points

**A1 · Is there an unambiguous verdict? (0 / 2 / 4)**
- 4 — states a clear recommendation you could act on without re-reading
- 2 — leans one way but hedges enough that you'd have to decide yourself
- 0 — presents both sides and does not choose

**A2 · Are the reasons tied to THIS dog? (0 / 3 / 6)**
The specifics available are: 14 months old, rescue, border collie mix, pulls
hard, barks at *every* dog (frequency matters — it suggests a threshold problem,
not a one-off), South Bay, evenings and weekends only.
- 6 — reasoning turns on at least three of those specifics
- 3 — generic reasoning with one or two specifics attached
- 0 — advice that would read identically for any dog

**A3 · Is there a decision RULE, not just a verdict? (0 / 3 / 6)**
He has to be able to apply it as things change.
- 6 — names the conditions under which the answer flips ("hire if X appears",
  "handle it yourself while Y is true"), specifically enough to check
- 3 — gestures at when to escalate without saying how you'd know
- 0 — a verdict with no conditions

**A4 · Can he get the verdict and the rule without reading the section? (0/2/4)**
- 4 — verdict and rule are scannable: a bottom-line block, a bolded sentence, or
  a table, near the top of the section
- 2 — present but you must read a few paragraphs to assemble them
- 0 — buried in prose

## B. Local options — 30 points

This is the section he cared about most. Read it hardest.

**B1 · Two or three options, as asked (0 / 2 / 4)**
- 4 — two or three real, distinct, local options
- 2 — four or five (he asked for two or three; more is scope creep, and it makes
  the section longer to read for no gain)
- 0 — one, or none, or a list of national chains with no local presence

**B2 · Real prices, and what each price buys (0 / 4 / 8)**
- 8 — a specific figure or a specific range for every option, and what you get
  for it (sessions, duration, format)
- 4 — figures for some options, "contact for pricing" for others
- 0 — no figures, or figures with no indication of what they cover

**B3 · Enough on EACH option to choose between them (0 / 4 / 8)**
The killer item. A report that writes up the recommendation and leaves the others
as one-liners fails this even if the recommendation is excellent.
- 8 — every option gets enough that you could pick a different one
- 4 — one option is written up properly, the others are thin
- 0 — only the recommendation is described

**B4 · Who the trainer actually is (0 / 2 / 4)**
- 4 — credentials, method, or experience for the options, named specifically
  (a certification, a stated approach, a specialism in reactivity)
- 2 — mentioned for one option only, or vaguely ("experienced")
- 0 — business names and prices with no idea who is behind them

**B5 · Blockers and disqualifiers named (0 / 2 / 4)**
He explicitly valued being shown *why an option might not work for him*.
- 4 — names the real frictions: schedule conflicts against evenings/weekends,
  waitlists, prerequisites, aversive-tool methods, location
- 2 — one such friction noted
- 0 — every option presented as equally available

**B6 · Did it miss a local option that exists and fits? (0 / 1 / 2)**
The FACTS block lists providers known to operate in this area. Missing one is a
real but minor defect — he flagged it twice and it never changed his ranking.
- 2 — no obvious local option missing
- 1 — one plausible option absent
- 0 — several absent, or the search clearly stopped early

## C. The four-week plan — 30 points

**C1 · All four weeks, distinct from each other (0 / 2 / 4)**
- 4 — four weeks, each doing something different
- 2 — four weeks but two or more are effectively the same week restated
- 0 — fewer than four, or an undifferentiated blob

**C2 · Could he execute it tomorrow evening? (0 / 3 / 6 / 10)**
- 10 — named drills with duration, frequency, and setting for each week —
  someone could follow it without looking anything else up
- 6 — named drills but vague on how long, how often, or where
- 3 — themes per week ("work on threshold") with no drills
- 0 — a schedule with no content

**C3 · Advance criteria — how he knows to move on (0 / 3 / 8)**
He raised this twice, unprompted, in both directions.
- 8 — an observable, checkable criterion for moving off most weeks (a distance,
  a count, a behaviour you could see happen)
- 3 — general encouragement to progress when ready
- 0 — no notion of when a week is done

**C4 · Fitted to his constraints and to a reactive dog (0 / 2 / 4)**
- 4 — the plan works on evenings and weekends, and handles the barking as a
  threshold/management problem rather than telling him to walk into triggers
- 2 — one of those two
- 0 — a generic obedience schedule

**C5 · Self-contained, not punted to subtasks (0 / 2 / 4)**
His explicit principle: the report is comprehensive, and the subtasks then turn
it into actionable steps. Not the other way round.
- 4 — the plan is fully in the report; subtasks restate it as actions
- 2 — the report sketches it and points at subtasks for the substance
- 0 — the report says the detail is in the subtasks

## D. Density and readability — 15 points

New this round. He raised it himself after reading reports he otherwise liked.

**D1 · How much of this text is load-bearing? (0 / 2 / 4 / 6)**
Before you score this, do the work: **find the passages you would delete without
losing a single decision-relevant fact.** Quote up to five of them. Preamble,
restatement of the request back at him, encouragement, and the same fact given
twice in different words all count.
- 6 — you could find at most one deletable passage
- 4 — a few, all short
- 2 — several, or one long stretch that says nothing new
- 0 — you could cut a quarter of it and lose nothing
If the report is long and you cannot name any deletable passage, look again
before awarding 6.

**D2 · Does the formatting compress, or just decorate? (0 / 2 / 3 / 5)**
- 5 — tables and headings where they genuinely compress comparison (options side
  by side, weeks at a glance); matter-of-fact register throughout
- 3 — structured, but prose is doing work a table would do better
- 2 — headings only, everything else is paragraphs
- 0 — a wall of text, or formatting so heavy it hides the content

**D3 · Is there a consolidated "do this now"? (0 / 2 / 4)**
He named this as a positive twice — a single block, near the top or the end,
that collapses everything into the next few actions.
- 4 — present, specific, and ordered
- 2 — present but vague, or scattered across sections
- 0 — absent; he has to build his own to-do list from the prose

## E. Grounding — 5 points, plus flags that are NOT averaged in

Read this section carefully; the obvious reading of the FACTS block is wrong.

The ledger behind the FACTS block is a **verified whitelist, not a catalogue.**
It holds prices we have personally confirmed on the provider's own page. It does
NOT list everything a provider sells. So:

- `verified` means we checked the figure and it is exactly right. Positive
  evidence. Trust it.
- **`unmatched` means only that the ledger has no entry for that figure.** It is
  NOT evidence of fabrication and must not be scored as one. This is a measured
  lesson, not a caution: 14 reports were once flagged for "inventing" a $595
  price that is published verbatim on the page they cited — the ledger simply
  lacked the entry.
- `unpublished` is stronger: that provider publishes no prices at all on its own
  site, so a specific figure for them came from somewhere else.

**E1 · Is the report's pricing anchored in checked fact? (0 / 2 / 5)**
Asymmetric on purpose: reward confirmed grounding, do not punish the ledger's
gaps.
- 5 — several figures verified exactly against the ledger
- 2 — one verified figure, the rest unmatched
- 0 — nothing verified

**FLAGS — report each independently. These do not enter the 100.**
They ride beside the score rather than inside it, because averaging them away is
how a report that invented a price ends up looking fine.

`FABRICATED_PRICE` is a judgement, and it is yours to make. Set it only when the
FACTS block gives you positive grounds — the provider is listed as publishing no
prices at all, or the figure is presented as that provider's cheapest entry point
while the ledger shows a verified range well above it. An `unmatched` figure on
its own is never sufficient. When you set it, quote the claim and say which fact
in the FACTS block grounds the call.

- `FABRICATED_PRICE` — as above; positive grounds required
- `NON_LOCAL_FALLBACK` — a national or out-of-region average presented as a
  local price
- `AVERSIVE_UNFLAGGED` — recommends a provider whose method uses e-collar, prong
  or shock without saying so (the roster marks which)
- `DEAD_CITATION` — a claim resting on a cited URL that does not resolve
- `OFF_SPEC` — substantial material outside the three things asked for


---

# How to work

1. Read the report once through, as the person who asked for it would.
2. Do the D1 deletion pass — actually find the cuttable passages — before you
   score anything. It stops the length reflex.
3. Score each item, lowest anchor when between two.
4. For every non-zero item, copy a verbatim substring as evidence.
5. Set the flags.
6. Do not total the score yourself. The harness sums it.

Return your answer through the structured output tool. No prose outside it.
