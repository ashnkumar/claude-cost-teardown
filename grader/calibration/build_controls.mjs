// Builds the two synthetic calibration controls and the Aug-1 rep dir from
// banked artifacts. Deterministic and re-runnable — the controls are derived,
// never hand-edited, so what was truncated stays auditable.
//
//   node grader/calibration/build_controls.mjs
//
// degraded/ — a rep dir whose report has section 3 (the four-week plan) cut
//   to its heading AND whose tree has the plan-bearing subtasks removed.
//   Targets A8/A9/A10/A11.
// padded/   — the same cuts, with sections 1 and 2 of the report inflated by
//   verbose filler back to the original length. Adds no new
//   criterion-satisfying content: no weeks, no named method, no threshold, no
//   gear, no new option, no new price. It exists only to test whether the
//   judge pays for bulk.
//
// Why the tree is cut too: calibration iteration 2 graded a report-only
// truncation at 85.67 against the baseline's 86 — no degradation at all. The
// rubric grades the deliverable a human receives, and in this run the tree
// carries the plan independently: four "Run Week N" subtasks, a gear subtask
// and a threshold subtask satisfied A8/A9/A10/A11 on their own. A run that
// never produced a plan would not have emitted those subtasks either, so the
// control has to remove them to be the thing it claims to be.
//
// Both controls copy the baseline's trace/usage verbatim. Axis B reads the
// fetched-URL set out of that trace, which is what B1/B2/B3 need; the
// behavioural block on a synthetic is not a measurement of anything real.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const BASE = path.join(REPO, 'experiments/naive-append/rep-1/tasks-snapshot.json')

const store = JSON.parse(fs.readFileSync(BASE, 'utf8'))
const md = store.tasks.find((t) => t.id === 't-dog').report.markdown

const HEAD3 = '## 3. The four-week plan'
const start = md.indexOf(HEAD3)
const nonNeg = md.indexOf('## Non-negotiables')
const sep = md.lastIndexOf('---', nonNeg)
if (start < 0 || sep < 0) throw new Error('report shape changed — fix the cuts')

const degraded = md.slice(0, start + HEAD3.length) + '\n\n' + md.slice(sep)
const cut = md.length - degraded.length

// Filler pool. Sections 1 and 2 restated at length; every paragraph is
// deliberately empty of anything the rubric scores.
const FILLER_1 = [
  'It is worth restating that recommendation at greater length, because the shape of the decision matters as much as the decision itself. The recommendation above is not a hedge and it is not a compromise between two positions. It is a judgement that the binding constraint in this situation is the amount of consistent, repeated practice the household can supply, and that no amount of money spent on outside expertise substitutes for that practice. Everything that follows from the recommendation follows from that single observation about where the constraint actually sits.',
  'A second framing of the same point may be useful. When people ask whether to hire a trainer, they are usually asking a question about competence: is this beyond me? That is the wrong axis. The more useful axis is whether the situation is one where a professional adds information you cannot otherwise obtain, or one where a professional mostly adds accountability and structure to a process you could run yourself. This situation sits firmly on the second side of that line, and the recommendation reflects that placement rather than any judgement about the owner.',
  'It also seems worth being explicit about what the recommendation is not saying. It is not saying that professional trainers are unnecessary in general, that they are overpriced in general, or that the ones listed below are anything other than legitimate businesses doing legitimate work. It is not saying that the do-it-yourself route is easy, quick, or guaranteed. It is saying only that, given the specific profile described in the brief and the specific constraints described in the brief, the balance of value favours the route recommended above.',
  'There is a reasonable counter-argument, and honesty requires naming it. Someone could argue that paying for expert eyes early prevents mistakes that are expensive to undo later, and that the cost of a wrong turn taken confidently is higher than the cost of the professional who would have prevented it. That argument is not wrong in principle. The reason it does not carry the day here is that the safety net described above already covers most of that downside at a fraction of the cost, which is precisely why it is recommended alongside rather than instead.',
  'On the question of how much confidence to place in the recommendation: moderate, and openly so. It rests on a description of the dog rather than on an observation of the dog, and descriptions of behaviour compress a great deal. If the reality on the ground differs materially from the description in the brief, the recommendation should be expected to move with it. That is not a defect in the recommendation; it is the ordinary condition of any advice given at a distance, and it is better stated than left implicit.',
  'It is also worth dwelling for a moment on the difference between a decision and a plan, because they are frequently conflated and the conflation causes trouble. The decision is a single choice made once and then largely left alone. The plan is the thing that has to survive contact with reality week after week, and it is the plan, not the decision, that determines whether anything changes. A well-made decision attached to a plan nobody executes produces exactly the same outcome as a badly-made one.',
  'Finally, on the economics of the choice, stated at the level of principle rather than the level of arithmetic. The arithmetic is set out in the comparison above and is not repeated here. The principle is that the cheaper route is only genuinely cheaper if the effort it demands is actually supplied, and the expensive route is only genuinely expensive if the cheaper route would in fact have worked. Both of those conditions are assumptions about the future rather than facts about the present, which is why the recommendation is expressed as a judgement rather than as a calculation.',
  'None of the above modifies the recommendation as stated. It is set out at this length only because a recommendation delivered in one line invites the reader to assume it was arrived at in one line, and that assumption tends to make people either over-trust it or dismiss it. The reasoning is the same reasoning; it has simply been said more slowly, and the reader who was already convinced by the short version has lost nothing by skipping this.',
]

const FILLER_2 = [
  'Some additional commentary on the options above may help in weighing them, and none of it changes the figures already given. The options differ less in what they promise than in how the promise is packaged. One is a course, sold at a course price, with a fixed curriculum and a fixed end date. Another is bespoke coaching, sold at a coaching price, with the curriculum built around your dog. A third is sold by the session. Those are three different products, and the price gaps between them are largely explained by that difference rather than by differences in quality.',
  'It is also worth being clear about what the prices above do and do not include, at the level of what is generally true of the category rather than as a claim about any particular provider beyond what is stated. Prices quoted for a course generally cover the sessions themselves. Prices quoted for coaching generally reflect the fact that a person is allocating time to one client. Neither figure should be read as covering everything that might eventually be spent, and neither should be read as covering nothing beyond a single hour.',
  'On the question of how much weight to give the cheapest option relative to the most expensive: less than the raw ratio suggests, in both directions. The most expensive option is not eight times better than the cheapest, and the cheapest is not a lesser version of the same thing. They are different products aimed at different situations, and the right way to read the spread is as a menu of formats rather than as a quality ranking with prices attached.',
  'A further note on the process by which these options were assembled, offered for transparency rather than because it changes the result. The search was scoped to the geography named in the brief and to providers that publish enough information to be evaluated. Providers that do not publish prices were not preferred, because a recommendation that cannot be costed is not much of a recommendation. That filter is a defensible one but it is a filter, and it will have excluded businesses that are perfectly good and simply quiet about their rates.',
  'It is worth restating, because it bears on how the list above should be read, that the ordering reflects a judgement about fit rather than a judgement about competence. Every provider listed appears to be doing serious work. The ordering exists because the brief asked for a recommendation and a recommendation requires an order. Someone with different constraints — a different budget, a different schedule, a different tolerance for structure versus flexibility — could reasonably reorder the same list without any of the underlying facts changing.',
  'On the mechanics of actually engaging any of these providers, at the level of general principle: the figures above are the published or reported figures, and published figures have a way of being the beginning of a conversation rather than the end of one. Confirming a figure before committing to it is ordinary diligence and not a sign of distrust. The same applies to schedule: availability described on a website is a description of a general pattern, not a guarantee about any particular week.',
  'One last observation about the shape of this part of the answer. The brief asked for a small number of options with real prices, and the temptation in answering that kind of request is always to widen the net until the list stops being useful. A longer list is easier to produce and harder to act on. The list above is deliberately kept to a size a person can actually hold in mind and choose between, which is the whole point of having asked for a small number in the first place.',
  'For completeness: nothing in these closing paragraphs adds a provider, a price, or a consideration that was not already on the table above. They are here to say the same things at greater length, on the theory that a reader deciding how to spend a meaningful sum of money would rather see the reasoning stretched out than compressed. A reader who found the table sufficient has already got what they came for.',
]

/** Pads a section end with as much of the pool as the budget allows. */
function padSection(text, anchor, pool, budget) {
  const at = text.indexOf(anchor)
  if (at < 0) throw new Error(`anchor not found: ${anchor}`)
  let add = ''
  for (const p of pool) {
    if (add.length + p.length + 2 > budget) break
    add += p + '\n\n'
  }
  return { text: text.slice(0, at) + add + text.slice(at), used: add.length }
}

let padded = degraded
const p1 = padSection(padded, '## 2. Local options', FILLER_1, cut)
padded = p1.text
const p2 = padSection(padded, HEAD3, FILLER_2, cut - p1.used)
padded = p2.text

fs.writeFileSync(path.join(HERE, 'degraded.md'), degraded)
fs.writeFileSync(path.join(HERE, 'padded.md'), padded)

// Subtasks that ARE the four-week plan. Cut alongside the report section so
// the control represents a run that did not produce a plan.
const CUT_TITLES = [
  /^Write the 4-week/,
  /^Run Week [1-4]\b/,
  /^Buy the gear/,
  /^Measure the dog's threshold/,
]
const isCut = (t) => CUT_TITLES.some((re) => re.test(t.title || ''))

const REP1 = path.join(REPO, 'experiments/naive-append/rep-1')

/** Writes a full synthetic rep dir: pruned tree + the baseline's trace. */
function writeControl(name, reportMd) {
  const dir = path.join(HERE, name)
  fs.mkdirSync(dir, { recursive: true })
  const snap = JSON.parse(fs.readFileSync(BASE, 'utf8'))
  const removed = snap.tasks.filter(isCut).map((t) => t.title)
  snap.tasks = snap.tasks.filter((t) => !isCut(t))
  const dog = snap.tasks.find((t) => t.id === 't-dog')
  dog.report = { ...dog.report, markdown: reportMd }
  fs.writeFileSync(
    path.join(dir, 'tasks-snapshot.json'),
    JSON.stringify(snap, null, 1) + '\n',
  )
  for (const f of ['trace.jsonl', 'usage.jsonl']) {
    fs.copyFileSync(path.join(REP1, f), path.join(dir, f))
  }
  const result = JSON.parse(fs.readFileSync(path.join(REP1, 'result.json')))
  fs.writeFileSync(
    path.join(dir, 'result.json'),
    JSON.stringify(
      {
        ...result,
        cell: `synthetic-${name}`,
        synthetic: true,
        note: `Derived from experiments/naive-append/rep-1 by grader/calibration/build_controls.mjs. Report section 3 truncated; ${removed.length} plan-bearing subtasks removed. trace/usage copied verbatim from the baseline.`,
        removed_subtasks: removed,
      },
      null,
      1,
    ) + '\n',
  )
  return removed
}

const removed = writeControl('degraded', degraded)
writeControl('padded', padded)

// Aug-1 rep dir: tree only. No trace/usage exists for that run, so grade.mjs
// drops axis B and normalises over the remaining 80 points.
const aug1 = path.join(HERE, 'aug1')
fs.mkdirSync(aug1, { recursive: true })
fs.copyFileSync(
  path.join(REPO, 'data/example-completed.json'),
  path.join(aug1, 'tasks-snapshot.json'),
)
fs.writeFileSync(
  path.join(aug1, 'result.json'),
  JSON.stringify(
    {
      cell: 'aug1-baseline',
      rep: 1,
      task_id: 't-dog',
      run_id: 'run-aug1',
      banked: true,
      note: 'Aug 1 run, tree only. Copied verbatim from data/example-completed.json. No trace.jsonl or usage.jsonl was ever captured, so axis B is not evaluable and the score is normalised over A+C (80 points).',
    },
    null,
    1,
  ) + '\n',
)

console.log(`baseline ${md.length} chars`)
console.log(`degraded ${degraded.length} chars (section 3 body cut: ${cut})`)
console.log(
  `padded   ${padded.length} chars ` +
    `(+${p1.used} into §1, +${p2.used} into §2, ` +
    `${((padded.length / md.length - 1) * 100).toFixed(1)}% vs baseline)`,
)
console.log(`aug1 rep dir → ${path.relative(REPO, aug1)}`)
console.log(`subtasks removed from both controls (${removed.length}):`)
for (const t of removed) console.log(`  - ${t}`)

// ── t-compliance ────────────────────────────────────────────────────────
//
// Same two artifacts for the compliance task: the finished sample, and a
// degraded control with the load-bearing section cut. As with t-dog, the cut
// has to reach past the report — the closing comment restates the entire risk
// story (Portland's per-day ban, Colorado and Maryland's necessity tests,
// California's breach PRA), so a report-only truncation would degrade nothing.
// A run that never did the risk research would not have written that comment
// or those subtasks either.

const SAMPLE = path.join(REPO, 'data/example-completed.json')
const all = JSON.parse(fs.readFileSync(SAMPLE, 'utf8')).tasks
const cmp = all.filter((t) => t.id === 't-compliance' || t.parentId === 't-compliance')

// The rule: the control models "the per-jurisdiction risk research never
// happened", so every output of that research goes wherever it lives — report
// sections, subtasks, comments. Outputs of the OTHER research streams
// (applicability thresholds, retention, consent flow, comprehensive privacy
// laws) stay, even where they answer the same question. That is why the
// surviving comprehensive-laws subtask still says there is no private right of
// action outside California and still carries a $7,500 figure: that finding is
// genuinely not risk-derived, and cutting it would be tuning the control
// rather than modelling the counterfactual.
//
// Section-level only. Picking individual bullets out of Recommendations would
// be choosing the number instead of applying the rule.
const CMP_CUT_SECTIONS = [
  ['## The short answer', '## The structural point'],
  ['## Risk tiers', '## Retention: one national rule'],
  ['## Watch list', null],
]
const CMP_CUT_TITLES = [
  /^Illinois BIPA/,
  /^Texas CUBI/,
  /^Washington HB 1493/,
  /^Colorado biometric amendment/,
  /^Other traps:/,
  /^Rank the states by launch risk/,
]

function writeCompliance(name, { degrade }) {
  const dir = path.join(HERE, name)
  fs.mkdirSync(dir, { recursive: true })
  let tasks = JSON.parse(JSON.stringify(cmp))
  const parent = tasks.find((t) => t.id === 't-compliance')
  let removed = []
  if (degrade) {
    let md = parent.report.markdown
    for (const [from, to] of CMP_CUT_SECTIONS) {
      const a = md.indexOf(from)
      if (a < 0) throw new Error(`compliance report shape changed: ${from}`)
      const b = to == null ? md.length : md.indexOf(to)
      if (b < 0) throw new Error(`compliance report shape changed: ${to}`)
      md = md.slice(0, a + from.length) + '\n\n---\n\n' + md.slice(b)
    }
    parent.report = { ...parent.report, markdown: md }
    removed = tasks.filter((t) => CMP_CUT_TITLES.some((re) => re.test(t.title)))
      .map((t) => t.title)
    tasks = tasks.filter((t) => !CMP_CUT_TITLES.some((re) => re.test(t.title)))
    // The closing comment is a second copy of the risk analysis.
    parent.comments = (parent.comments || []).slice(0, 1)
  }
  fs.writeFileSync(
    path.join(dir, 'tasks-snapshot.json'),
    JSON.stringify({ tasks }, null, 1) + '\n',
  )
  fs.writeFileSync(
    path.join(dir, 'result.json'),
    JSON.stringify({
      cell: name, rep: 1, task_id: 't-compliance', run_id: `run-${name}`,
      banked: true, synthetic: degrade,
      note: degrade
        ? `Derived from data/example-completed.json by build_controls.mjs. Models "the per-jurisdiction risk research never happened": report sections ${CMP_CUT_SECTIONS.map((s) => s[0]).join(", ")} cut, ${removed.length} risk-research subtasks removed, closing comment (which restates the risk analysis) dropped. Other research streams left intact.`
        : 'The finished t-compliance sample, copied verbatim from data/example-completed.json. No trace/usage was ever captured, so axis B is not evaluable and the score normalises over A+C (80 points).',
      removed_subtasks: removed,
    }, null, 1) + '\n',
  )
  return { chars: parent.report.markdown.length, removed }
}

const cs = writeCompliance('compliance', { degrade: false })
const cd = writeCompliance('compliance-degraded', { degrade: true })
console.log(`\ncompliance sample   ${cs.chars} chars`)
console.log(`compliance degraded ${cd.chars} chars (cut ${cs.chars - cd.chars})`)
console.log(`subtasks removed (${cd.removed.length}):`)
for (const t of cd.removed) console.log(`  - ${t}`)

// ── compliance: the particulars-stripped control ────────────────────────
//
// The approved degraded control for compliance. Section-cutting proved a weak
// instrument here (see calibration-results-compliance.md): the deliverable
// carries its risk analysis on five surfaces, so removing one changed almost
// nothing. This control instead models THINNER, not missing — which is what
// trimmed and compacted variants actually produce, and what the axis-A ceiling
// has never been shown to catch.
//
// Same six asks, same structure, same tree. Every hard particular replaced by
// its vague form: no dollar figures, no statutory citations, no named cases,
// no numeric periods, no per-jurisdiction mechanisms. Applied to the report,
// the subtask descriptions AND the comments, because particulars live on all
// three surfaces.
//
// Lexical strips are regexes. Mechanism clauses are semantic and cannot be
// regexed, so they are an explicit listed set of replacements — auditable in
// full here rather than hidden in a hand-edited file.

const STRIP_LEXICAL = [
  // dollar figures, incl. ranges, per-unit and billions
  [/\$[\d,]+(?:\.\d+)?(?:\s*(?:billion|million|B\b|M\b))?(?:\s*[–—-]\s*\$[\d,]+(?:\.\d+)?)?/g,
    'a substantial sum'],
  // statutory + ordinance citations
  [/\b\d+\s+ILCS\s+[\d/]+/g, 'the relevant statute'],
  [/\bRCW\s+[\d.]+/g, 'the relevant statute'],
  [/\b(?:Bus\.\s*&\s*Com\.\s*Code\s*)?ch\.\s*[\d.]+/g, 'the relevant statute'],
  [/§\s*\d+[a-z]*(?:\([a-z0-9]+\))?/gi, 'the relevant provision'],
  [/\b(?:HB|SB)\s*[\d-]+/g, 'the relevant bill'],
  // named cases (italicised or bare "X v. Y")
  [/\*[A-Z][A-Za-z.'’-]+ v\.? [A-Z][A-Za-z.'’&\s-]*?\*/g, 'relevant case law'],
  [/\b[A-Z][A-Za-z.'’-]+ v\.? [A-Z][A-Za-z.'’-]+\b/g, 'relevant case law'],
  [/\(\*[A-Z][A-Za-z’'-]+\*\)/g, '(relevant case law)'],
  [/\*[A-Z][A-Za-z’'-]+\*'s\b/g, "relevant case law's"],
  // numeric periods
  [/\b\d+\s*[–—-]\s*\d+\s*(?:year|month|week|day|hour)s?\b/gi, 'a limited period'],
  [/\b\d+\s*(?:-|\s)\s*(?:year|month|week|day|hour)s?\b/gi, 'a limited period'],
  [/\b(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty-four)\s+(?:year|month|week|day|hour)s?\b/gi,
    'a limited period'],
  [/\bfirst anniversary\b/gi, 'a set deadline'],
  [/\b\d{2,3}k\b/g, 'a threshold number'],
  [/\b\d+%\b/g, 'a threshold share'],
]

// Per-jurisdiction mechanisms — the "why this one is dangerous" clauses.
const STRIP_MECHANISM = [
  [/The only unrestricted PRA[^.]*\./g, 'Enforcement here is notable.'],
  [/the only statute with an unrestricted private right of action/gi,
    'a statute of note'],
  [/It is a \*\*ban\*\*, not a consent regime\./g, 'It is restrictive.'],
  [/A flat \*\*ban\*\* on face recognition/g, 'A restrictive regime'],
  [/No consent cures a prohibition/g, 'Difficult to address'],
  [/consent is expressly not a cure/gi, 'the rules are demanding'],
  [/\*\*consent is not a cure\*\*/g, 'the rules are demanding'],
  [/Consent is irrelevant by statute/g, 'The rules are demanding'],
  [/We must prove the scan is necessary, not just disclosed/g,
    'The requirements are stricter'],
  [/\*\*"?Necessary"?\*\*\s*test[^|]*/g, 'A stricter standard '],
  [/\*\*"?Strictly necessary"?\*\*\s*test[^|]*/g, 'A stricter standard '],
  [/Per-day accrual is worse than BIPA[^.]*\./g, 'Accrual differs.'],
  // The 1.1.0 gate exposed five mechanism names that survived the first pass:
  // markdown bold split "the **conditioning prohibition**" out of reach of a
  // plain-text regex, and per-day accrual / necessity tests were never listed.
  // A9 was passing on genuine mechanism names the strip had missed — a control
  // gap, not a rubric gap.
  [/the \*{0,2}conditioning prohibition\*{0,2}/gi, 'an additional restriction'],
  [/\*{0,2}per day,? per violation\*{0,2}/gi, 'with further consequences'],
  [/\baccrual\b/gi, 'treatment'],
  [/unless the biometric is \*?necessary\*?/gi, 'in certain circumstances'],
  [/\*{0,2}strictly necessary\*{0,2}/gi, 'appropriate'],
  [/the definition of face recognition technology expressly includes[^.]*\./gi,
    'the definition is broad.'],
  [/no injury required/gi, 'fewer preconditions'],
  [/plus attorneys'? fees/gi, 'plus other costs'],
  [/fee-shifting/gi, 'cost consequences'],
  [/statutory damages/gi, 'monetary consequences'],
  [/private right of action/gi, 'a route for claims'],
  [/\bPRA\b/g, 'that route'],
]

const strip = (s) => {
  if (typeof s !== 'string') return s
  let out = s
  for (const [re, to] of [...STRIP_MECHANISM, ...STRIP_LEXICAL]) {
    out = out.replace(re, to)
  }
  return out
}

{
  const dir = path.join(HERE, 'compliance-vague')
  fs.mkdirSync(dir, { recursive: true })
  const tasks = JSON.parse(JSON.stringify(cmp))
  for (const t of tasks) {
    t.description = strip(t.description)
    if (t.comments) t.comments = t.comments.map((c) => ({ ...c, body: strip(c.body) }))
    if (t.report) t.report = { ...t.report, markdown: strip(t.report.markdown) }
  }
  fs.writeFileSync(
    path.join(dir, 'tasks-snapshot.json'),
    JSON.stringify({ tasks }, null, 1) + '\n',
  )
  fs.writeFileSync(
    path.join(dir, 'result.json'),
    JSON.stringify({
      cell: 'compliance-vague', rep: 1, task_id: 't-compliance',
      run_id: 'run-compliance-vague', banked: true, synthetic: true,
      note: 'Particulars-stripped control. Same six asks, same structure, same tree; every dollar figure, statutory citation, named case, numeric period and per-jurisdiction mechanism replaced by a vague form, across report, subtask descriptions and comments. Models thinner-not-missing.',
    }, null, 1) + '\n',
  )
  const parent = tasks.find((t) => t.id === 't-compliance')
  console.log(`\ncompliance vague    ${parent.report.markdown.length} chars ` +
    `(sample ${cs.chars})`)
}
