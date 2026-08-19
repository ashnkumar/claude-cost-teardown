// The LLM judge. Opus 5, effort max, N passes per report, run in parallel.
//
//   node grader/judge/run-judge.mjs --task=t-dog [--passes=3] [--concurrency=6]
//        [--only=cell/rep,...] [--limit=N] [--dry]
//
// Every request goes through the filmed callClaude, so judge spend lands on
// runs/usage.jsonl like anything else in this repo.
//
// Design notes that matter:
//  - The system block carries the whole rubric and is marked cache_control, so
//    all N x runs calls read it instead of re-writing it. That is Fix 1 applied
//    to our own grader.
//  - The TRANSCRIPT IS NEVER SENT. Its length varies with the treatment under
//    measurement, so including it would leak the experimental condition into
//    the score.
//  - Evidence quotes are checked as verbatim substrings of the report. An item
//    whose quote does not match is zeroed, and the miss is recorded. The judge
//    is told this happens, which is most of why it holds.
//  - Scores are enum-constrained to the rubric's anchors, so "between two
//    anchors" cannot be split.
import fs from 'node:fs'
import path from 'node:path'

const LAUNCH_CWD = process.cwd()
const repo = await import('../../scripts/experiments/repo.mjs')
const { callClaude, MODEL, THINKING, REPO } = repo

const HERE = path.join(REPO, 'grader', 'judge')
const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`))
  return hit ? hit.slice(k.length + 3) : d
}
const flag = (k) => process.argv.includes(`--${k}`)

const TASK = arg('task', 't-dog')
const PASSES = Number(arg('passes', '3'))
const CONC = Number(arg('concurrency', '6'))
const ONLY = arg('only', '')
const LIMIT = Number(arg('limit', '0'))
const DRY = flag('dry')

// ── the rubric's anchors, in one place ──────────────────────────────────
const ITEMS = {
  A1: [0, 2, 4], A2: [0, 3, 6], A3: [0, 3, 6], A4: [0, 2, 4],
  B1: [0, 2, 4], B2: [0, 4, 8], B3: [0, 4, 8], B4: [0, 2, 4],
  B5: [0, 2, 4], B6: [0, 1, 2],
  C1: [0, 2, 4], C2: [0, 3, 6, 10], C3: [0, 3, 8], C4: [0, 2, 4],
  C5: [0, 2, 4],
  D1: [0, 2, 4, 6], D2: [0, 2, 3, 5], D3: [0, 2, 4],
  E1: [0, 2, 5],
}
const SECTION = (k) => k[0]
const MAXES = Object.fromEntries(
  Object.entries(ITEMS).map(([k, v]) => [k, Math.max(...v)]),
)
const FLAGS = ['FABRICATED_PRICE', 'NON_LOCAL_FALLBACK', 'AVERSIVE_UNFLAGGED',
               'DEAD_CITATION', 'OFF_SPEC']

function schema() {
  // One array of ONE object shape. Nineteen distinct nested objects with enums
  // compiled to a grammar the API rejects as too large, so the anchor
  // constraint moves into validate() instead: a score that is not one of the
  // item's anchors is snapped DOWN to the nearest one, which matches the
  // rubric's own "when between two anchors, take the lower" rule.
  return {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'deletable_passages', 'flags', 'missed_local_options',
               'verdict'],
    properties: {
      items: {
        type: 'array',
        description: 'Exactly one entry per rubric item: '
          + Object.keys(ITEMS).join(' '),
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'score', 'evidence', 'why'],
          properties: {
            id: { type: 'string' },
            score: { type: 'integer' },
            evidence: {
              type: 'string',
              description: 'Verbatim substring of the report. Empty only when '
                + 'the score is 0.',
            },
            why: { type: 'string', description: 'One sentence; name the anchor.' },
          },
        },
      },
      deletable_passages: {
        type: 'array',
        description: 'AT MOST FIVE verbatim passages you would delete without '
          + 'losing a decision-relevant fact. Do this BEFORE scoring D1.',
        items: { type: 'string' },
      },
      flags: {
        type: 'array',
        description: 'Zero or more of: ' + FLAGS.join(' ') + '. Format each as '
          + '"FLAG :: verbatim quote :: which FACT grounds this".',
        items: { type: 'string' },
      },
      missed_local_options: {
        type: 'array',
        description: 'Providers from the roster that fit and are absent.',
        items: { type: 'string' },
      },
      verdict: {
        type: 'string',
        description: 'One sentence: would the person who asked for this send '
          + 'it, and what is the single biggest thing wrong with it.',
      },
    },
  }
}

// ── the user message ────────────────────────────────────────────────────
function userMessage(f) {
  return `## FACTS — measured, not judged

These were computed from the run, not read out of the report. They are context
for scoring, not scores. The character count exists ONLY to inform the density
items — it is not a quality signal in either direction.

Report length             ${f.chars} characters, ${f.words} words
Sources cited             ${f.n_sources}
Sources actually opened   ${f.n_fetched} of those ${f.n_sources}
Web searches run          ${f.n_searches}
Pages fetched             ${f.n_fetches}

Price claims checked against the provider ledger — read the E-section note on
what "unmatched" does and does not mean:
  verified exactly        ${f.n_verified}
  unmatched (UNVERIFIED,  ${f.n_unmatched}
    not "wrong")          ${f.unmatched_detail}
  provider publishes no   ${f.n_unpublished}
    price at all          ${f.unpublished_detail}
  claim resting on a      ${f.n_dead}
    citation that 404s    ${f.dead_detail}

Local providers verified to operate in this area. NOT an exhaustive census of the
market — absence from this list is not evidence a provider does not exist:
${f.provider_roster}

Providers this report names: ${f.providers_named}

## THE SUBTASK TREE the agent wrote back

For scoring C5 — whether the report is self-contained or defers its substance to
these. Do not score the subtasks' own quality. Descriptions are truncated.

${f.subtask_tree}

## SOURCES the report cites

${f.sources_list}

## THE REPORT

${f.report_markdown}`
}

// ── validation: the evidence has to be real ─────────────────────────────
const squash = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase()

function snap(id, raw) {
  const allowed = ITEMS[id]
  if (!allowed) return null
  if (allowed.includes(raw)) return { score: raw, snapped: false }
  // Lower anchor, per the rubric's own tie-break rule.
  const below = allowed.filter((a) => a <= raw)
  return { score: below.length ? Math.max(...below) : 0, snapped: true }
}

function validate(parsed, reportMd) {
  const hay = squash(reportMd)
  const items = {}
  const zeroed = []
  const snapped = []
  const missing = []
  for (const row of parsed.items || []) {
    const id = (row.id || '').trim().toUpperCase()
    const sn = snap(id, row.score)
    if (!sn) continue
    if (sn.snapped) snapped.push({ item: id, raw: row.score, to: sn.score })
    const rec = { score: sn.score, evidence: row.evidence || '', why: row.why || '' }
    if (rec.score > 0) {
      const q = squash(rec.evidence)
      if (q.length < 12 || !hay.includes(q)) {
        zeroed.push({ item: id, was: rec.score, quote: rec.evidence.slice(0, 80) })
        rec.score = 0
        rec.evidence_rejected = true
      }
    }
    items[id] = rec
  }
  for (const id of Object.keys(ITEMS)) {
    if (!(id in items)) {
      missing.push(id)
      items[id] = { score: 0, evidence: '', why: 'ITEM MISSING FROM RESPONSE' }
    }
  }
  const badDel = (parsed.deletable_passages || [])
    .filter((d) => !hay.includes(squash(d))).length
  return { items, zeroed, snapped, missing, badDel }
}

function total(items) {
  return Object.entries(items).reduce((n, [, v]) => n + v.score, 0)
}
function sections(items) {
  const out = {}
  for (const [k, v] of Object.entries(items)) {
    const s = SECTION(k)
    out[s] = (out[s] || 0) + v.score
  }
  return out
}

// ── one call ────────────────────────────────────────────────────────────
const SYS = fs.readFileSync(path.join(HERE, `system-${TASK}.md`), 'utf8')
const SCHEMA = schema()

async function judgeOnce(f, pass, runId) {
  const req = {
    model: MODEL,
    max_tokens: 32_000,
    thinking: THINKING,
    output_config: {
      effort: 'max',
      format: { type: 'json_schema', schema: SCHEMA },
    },
    system: [{ type: 'text', text: SYS, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userMessage(f) }],
  }
  const msg = await callClaude(req, { taskId: 'judge', runId })
  const text = (msg.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) throw new Error(`pass ${pass}: no JSON in response`)
    parsed = JSON.parse(m[0])
  }
  const check = validate(parsed, f.report_markdown)
  return {
    pass,
    total: total(check.items),
    sections: sections(check.items),
    items: check.items,
    deletable_passages: parsed.deletable_passages,
    flags: parsed.flags,
    missed_local_options: parsed.missed_local_options,
    verdict: parsed.verdict,
    evidence_zeroed: check.zeroed,
    scores_snapped: check.snapped,
    items_missing: check.missing,
    deletable_unverifiable: check.badDel,
    stop_reason: msg.stop_reason,
  }
}

// ── drive it ────────────────────────────────────────────────────────────
const factsDir = path.join(HERE, 'facts', TASK)
const outDir = path.join(HERE, 'out', TASK)
fs.mkdirSync(outDir, { recursive: true })

let files = fs.readdirSync(factsDir).filter((x) => x.endsWith('.json')).sort()
if (ONLY) {
  const want = new Set(ONLY.split(',').map((s) => s.replace('/', '__') + '.json'))
  files = files.filter((x) => want.has(x))
}
if (LIMIT) files = files.slice(0, LIMIT)

console.log(`judge: ${MODEL} effort=max thinking=${THINKING.type} `
  + `passes=${PASSES} concurrency=${CONC}`)
console.log(`judge: ${files.length} reports x ${PASSES} passes = `
  + `${files.length * PASSES} calls  (task ${TASK})`)
if (!files.length) { console.error('nothing to grade'); process.exit(1) }
if (DRY) {
  const f = JSON.parse(fs.readFileSync(path.join(factsDir, files[0]), 'utf8'))
  const u = userMessage(f)
  console.log(`\n--- system: ${SYS.length} chars ---`)
  console.log(`--- user for ${files[0]}: ${u.length} chars ---\n`)
  console.log(u.slice(0, 2600))
  console.log('\n[...report continues...]')
  process.exit(0)
}

const jobs = []
for (const file of files) {
  for (let p = 1; p <= PASSES; p++) jobs.push({ file, pass: p })
}

const results = new Map()
let done = 0
let failed = 0
const started = Date.now()

async function worker(id) {
  while (jobs.length) {
    const job = jobs.shift()
    if (!job) return
    const f = JSON.parse(fs.readFileSync(path.join(factsDir, job.file), 'utf8'))
    const runId = `judge-${TASK}-${job.file.replace('.json', '')}-p${job.pass}`
    try {
      const r = await judgeOnce(f, job.pass, runId)
      if (!results.has(job.file)) results.set(job.file, [])
      results.get(job.file).push(r)
      done++
      const zs = r.evidence_zeroed.length
      console.log(`[${done}/${done + jobs.length + failed}] ${job.file} p${job.pass}`
        + ` = ${r.total}` + (zs ? `  (${zs} evidence rejected)` : ''))
    } catch (err) {
      failed++
      console.error(`FAIL ${job.file} p${job.pass}: ${err.message}`)
    }
  }
}

await Promise.all(Array.from({ length: CONC }, (_, i) => worker(i)))

// ── write one file per report, with the pass spread ─────────────────────
for (const [file, passes] of results) {
  const f = JSON.parse(fs.readFileSync(path.join(factsDir, file), 'utf8'))
  const totals = passes.map((p) => p.total)
  const mean = totals.reduce((a, b) => a + b, 0) / totals.length
  const itemSpread = {}
  for (const k of Object.keys(ITEMS)) {
    const vals = passes.map((p) => p.items[k].score)
    itemSpread[k] = {
      mean: vals.reduce((a, b) => a + b, 0) / vals.length,
      min: Math.min(...vals), max: Math.max(...vals), max_possible: MAXES[k],
      unanimous: new Set(vals).size === 1,
    }
  }
  const flagCounts = {}
  for (const p of passes) {
    for (const fl of p.flags || []) {
      flagCounts[fl.flag] = (flagCounts[fl.flag] || 0) + 1
    }
  }
  fs.writeFileSync(
    path.join(outDir, file),
    JSON.stringify({
      task: TASK, cell: f.cell, rep: f.rep,
      model: MODEL, effort: 'max', passes: passes.length,
      score_mean: Number(mean.toFixed(2)),
      score_min: Math.min(...totals), score_max: Math.max(...totals),
      sections_mean: Object.fromEntries(
        ['A', 'B', 'C', 'D', 'E'].map((s) => [
          s, Number((passes.reduce((n, p) => n + (p.sections[s] || 0), 0)
            / passes.length).toFixed(2)),
        ]),
      ),
      item_spread: itemSpread,
      unanimous_items: Object.values(itemSpread).filter((x) => x.unanimous).length,
      flag_counts: flagCounts,
      evidence_rejections: passes.reduce((n, p) => n + p.evidence_zeroed.length, 0),
      chars: f.chars, words: f.words,
      passes_detail: passes,
    }, null, 1),
  )
}

const mins = ((Date.now() - started) / 60000).toFixed(1)

console.log(`\njudge: wrote ${results.size} reports to ${outDir}`)
console.log(`judge: ${done} calls ok, ${failed} failed, ${mins} min`)
