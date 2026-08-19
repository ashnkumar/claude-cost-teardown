// Head-to-head judge. Two reports in, a forced choice out.
//
//   node grader/judge/run-pairwise.mjs --task=t-dog --pairs=calibration
//   node grader/judge/run-pairwise.mjs --task=t-dog --pairs=a/rep-1:b/rep-2,...
//   node grader/judge/run-pairwise.mjs --task=t-dog --reference=cell/rep-N
//
// Why this exists: the absolute rubric saturated. Twelve of nineteen items sat at
// their top anchor on 85%+ of reports, so 60 of 100 points were a constant. On
// the two pairs the human felt strongest about, all nineteen item scores came out
// identical -- while the judge's own written verdict named four differences that
// all favoured the report he preferred. The signal was there; the scale had
// nowhere to put it. A comparison has somewhere to put it.
//
// Design notes that matter:
//  - EVERY PAIR IS JUDGED IN BOTH ORDERS. LLM judges have a known position bias,
//    and asserting it away would be exactly the sin the absolute rubric
//    committed. If the two orders disagree, that is recorded as a genuine tie
//    (or a bias flag), not silently resolved.
//  - The system block is cache_control'd, so all calls read the rubric instead of
//    re-writing it. Fix 1 applied to our own grader.
//  - THE TRANSCRIPT IS NEVER SENT. Its length varies with the treatment under
//    measurement, so it would leak the experimental condition into the verdict.
//  - Quotes are substring-checked against the report they claim to come from. A
//    dimension whose quotes do not verify is marked unusable and excluded.
//  - Reports are labelled 1 and 2, never A and B, so the labels cannot line up
//    with the human's own A/B answers by accident.
import fs from 'node:fs'
import path from 'node:path'

const repo = await import('../../scripts/experiments/repo.mjs')
const { callClaude, MODEL, THINKING, REPO } = repo

const HERE = path.join(REPO, 'grader', 'judge')
const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`))
  return hit ? hit.slice(k.length + 3) : d
}
const flag = (k) => process.argv.includes(`--${k}`)

const TASK = arg('task', 't-dog')
const CONC = Number(arg('concurrency', '4'))
const PAIRS_ARG = arg('pairs', '')
const REFERENCE = arg('reference', '')
const TIEBREAK = !flag('no-tiebreak')
const DRY = flag('dry')

// Dimension names are task-specific and must match the rubric's own headings, or
// validate() silently drops every call as an unknown dimension.
const DIMS = TASK === 't-compliance'
  ? ['STATE_COVERAGE', 'REQUIRED_FIELDS', 'LAUNCH_DECISION', 'DENSITY',
     'GROUNDING', 'OVERALL']
  : ['LOCAL_OPTIONS', 'FOUR_WEEK_PLAN', 'DECISION', 'DENSITY',
     'GROUNDING', 'OVERALL']

// ── schema: one flat array, one object shape ────────────────────────────
// The absolute grader learned this the hard way -- nineteen distinct nested
// objects with enums compiled to a grammar the API rejects as too large. One
// shape, and the constraints get enforced in validate().
function schema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['dimensions', 'deletable_1', 'deletable_2'],
    properties: {
      dimensions: {
        type: 'array',
        description: 'Exactly one entry per dimension, in this order: '
          + DIMS.join(' ') + '. OVERALL must not be EQUAL.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['dimension', 'winner', 'margin', 'quote_1', 'quote_2', 'why'],
          properties: {
            dimension: { type: 'string', description: 'One of: ' + DIMS.join(' ') },
            winner: {
              type: 'integer',
              description: '1 if report 1 is better on this dimension, 2 if '
                + 'report 2 is, 0 for EQUAL. 0 is FORBIDDEN for OVERALL.',
            },
            margin: {
              type: 'string',
              description: 'CLEAR if the gap would change what he does, SLIGHT '
                + 'if he would notice but could live with either, EQUAL if '
                + 'winner is 0.',
            },
            quote_1: {
              type: 'string',
              description: 'Verbatim substring of REPORT 1 showing what it does '
                + 'on this dimension. Checked programmatically.',
            },
            quote_2: {
              type: 'string',
              description: 'Verbatim substring of REPORT 2, same. When the point '
                + 'is that report 2 OMITS something, quote the thin passage '
                + 'that stands in its place rather than inventing an absence.',
            },
            why: {
              type: 'string',
              description: 'One sentence, in his terms, on why the winner wins.',
            },
          },
        },
      },
      deletable_1: {
        type: 'array',
        description: 'Up to three verbatim passages from REPORT 1 you would '
          + 'delete without losing a decision-relevant fact. Do this before '
          + 'judging DENSITY.',
        items: { type: 'string' },
      },
      deletable_2: {
        type: 'array',
        description: 'Same, for REPORT 2.',
        items: { type: 'string' },
      },
    },
  }
}

// ── the user message: two reports, two FACTS blocks ─────────────────────
// The two tasks carry different measured facts, so the block is task-shaped.
// Everything here is INPUT to the judgment, never a score -- the pivot away from
// deterministic scoring that the human asked for.
function factsBlock(f, n) {
  if (TASK === 't-compliance') {
    return `### REPORT ${n} — measured facts

Length                    ${f.chars} characters, ${f.words} words
Sources cited             ${f.n_sources}
Sources actually opened   ${f.n_fetched} of those ${f.n_sources}
Web searches run          ${f.n_searches}
States named              ${f.n_states_named}
Tables in the report      ${f.tables}

States it names: ${f.states_named}

Keyword signals on the Illinois damages question. These are HINTS FOR YOU TO
CHECK, not findings -- read the report itself before concluding anything:
  reads as pre-amendment  ${f.bipa_stale_signals || '(none detected)'}
  cites the amendment     ${f.bipa_amendment_signals || '(none detected)'}`
  }
  return `### REPORT ${n} — measured facts

Length                    ${f.chars} characters, ${f.words} words
Sources cited             ${f.n_sources}
Sources actually opened   ${f.n_fetched} of those ${f.n_sources}

Price claims checked against the provider ledger. The ledger is a VERIFIED
WHITELIST, not a catalogue: "unmatched" means UNVERIFIED, never wrong.
  verified exactly        ${f.n_verified}
  unmatched (unverified)  ${f.n_unmatched}
  provider publishes no   ${f.n_unpublished}
    price at all
  claim on a dead link    ${f.n_dead}${f.dead_detail ? '  ' + f.dead_detail : ''}

Providers this report names: ${f.providers_named}`
}

function sharedBlock(f) {
  if (TASK === 't-compliance') {
    return `### The statute ledger — cells read off primary sources

Shared by both reports. A VERIFIED WHITELIST of the cells that discriminate, NOT
a fifty-state census. A claim about a state absent from this ledger is
UNVERIFIED, never wrong.

${f.statute_ledger}`
  }
  return `### Local providers verified to operate in this area

Shared by both reports. NOT an exhaustive census of the market — absence from
this list is not evidence a provider does not exist.

${f.provider_roster}`
}

function userMessage(f1, f2) {
  return `## FACTS — measured, not judged

Computed from the runs, not read out of the reports. Context for the grounding
and density dimensions. The character counts are NOT a quality signal in either
direction.

${factsBlock(f1, 1)}

${factsBlock(f2, 2)}

${sharedBlock(f1)}

---

## REPORT 1

${f1.report_markdown}

---

## REPORT 2

${f2.report_markdown}`
}

// ── validation ──────────────────────────────────────────────────────────
const squash = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase()

function validate(parsed, md1, md2) {
  const h1 = squash(md1)
  const h2 = squash(md2)
  const dims = {}
  const unusable = []
  for (const row of parsed.dimensions || []) {
    const d = (row.dimension || '').trim().toUpperCase().replace(/[ -]/g, '_')
    if (!DIMS.includes(d)) continue
    const w = Number(row.winner)
    const q1 = squash(row.quote_1)
    const q2 = squash(row.quote_2)
    const ok1 = q1.length >= 12 && h1.includes(q1)
    const ok2 = q2.length >= 12 && h2.includes(q2)
    const rec = {
      winner: w === 1 || w === 2 ? w : 0,
      margin: (row.margin || '').trim().toUpperCase(),
      why: row.why || '',
      quote_1_ok: ok1,
      quote_2_ok: ok2,
    }
    // A call resting on a quote that isn't in the report is not a call.
    if (!ok1 || !ok2) {
      unusable.push({ dimension: d, quote_1_ok: ok1, quote_2_ok: ok2 })
      rec.unusable = true
    }
    // OVERALL may not be EQUAL. If the judge returns 0 anyway, that is a
    // protocol violation and gets recorded rather than papered over.
    if (d === 'OVERALL' && rec.winner === 0) rec.forced_tie_violation = true
    dims[d] = rec
  }
  for (const d of DIMS) {
    if (!(d in dims)) dims[d] = { winner: 0, margin: 'MISSING', missing: true }
  }
  const badDel = [...(parsed.deletable_1 || []).filter((x) => !h1.includes(squash(x))),
                  ...(parsed.deletable_2 || []).filter((x) => !h2.includes(squash(x)))]
  return { dims, unusable, deletable_unverifiable: badDel.length }
}

// ── one call ────────────────────────────────────────────────────────────
const SYS = fs.readFileSync(path.join(HERE, `system-${TASK}-pairwise.md`), 'utf8')
const SCHEMA = schema()
const factsDir = path.join(HERE, 'facts', TASK)

const loadFacts = (run) =>
  JSON.parse(fs.readFileSync(
    path.join(factsDir, run.replace('/', '__') + '.json'), 'utf8'))

/**
 * Retry on the errors that are the API telling us to slow down, not that the
 * request is wrong. At high concurrency a 429 would otherwise silently cost us a
 * pair -- and a missing pair in a reference sweep is a missing row in the chart,
 * which is worse than waiting.
 *
 * A 400 is never retried: it means the request is malformed, and hammering it
 * just spends money to get the same answer.
 */
const RETRYABLE = /\b(429|500|502|503|529)\b|rate.?limit|overloaded|timeout|ECONNRESET|socket hang up/i

async function withRetry(fn, label, tries = 5) {
  let wait = 20_000
  for (let i = 1; ; i++) {
    try {
      return await fn()
    } catch (err) {
      const msg = String(err?.message ?? err)
      if (i >= tries || !RETRYABLE.test(msg)) throw err
      // Jitter so N workers backing off together do not re-collide.
      const sleep = wait + Math.floor((i * 3137) % 7000)
      console.error(`  retry ${i}/${tries - 1} ${label} in ${Math.round(sleep / 1000)}s`
        + ` -- ${msg.slice(0, 90)}`)
      await new Promise((r) => setTimeout(r, sleep))
      wait = Math.min(wait * 2, 180_000)
    }
  }
}

async function judgePair(runA, runB, order, runId) {
  // order 'AB' puts runA in slot 1; order 'BA' puts runB in slot 1.
  const [first, second] = order === 'AB' ? [runA, runB] : [runB, runA]
  const f1 = loadFacts(first)
  const f2 = loadFacts(second)
  const req = {
    model: MODEL,
    // 64k, not 32k: three compliance calls truncated mid-JSON at 32k and were
    // lost. A truncated response is a wasted max-effort call, so the ceiling is
    // cheaper to raise than to hit.
    max_tokens: 64_000,
    thinking: THINKING,
    output_config: {
      effort: 'max',
      format: { type: 'json_schema', schema: SCHEMA },
    },
    system: [{ type: 'text', text: SYS, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userMessage(f1, f2) }],
  }
  const msg = await callClaude(req, { taskId: 'judge-pairwise', runId })
  const text = (msg.content || [])
    .filter((b) => b.type === 'text').map((b) => b.text).join('')
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) throw new Error('no JSON in response')
    parsed = JSON.parse(m[0])
  }
  const v = validate(parsed, f1.report_markdown, f2.report_markdown)
  // Translate slot winners (1/2) back into A/B, which is what we actually want.
  const toAB = (w) => {
    if (w !== 1 && w !== 2) return 'EQUAL'
    if (order === 'AB') return w === 1 ? 'A' : 'B'
    return w === 1 ? 'B' : 'A'
  }
  const dims = {}
  for (const [d, rec] of Object.entries(v.dims)) {
    dims[d] = { ...rec, winner_ab: toAB(rec.winner) }
  }
  return {
    order,
    dims,
    unusable: v.unusable,
    deletable_unverifiable: v.deletable_unverifiable,
    deletable_1: parsed.deletable_1,
    deletable_2: parsed.deletable_2,
    stop_reason: msg.stop_reason,
  }
}

// ── assemble the pair list ──────────────────────────────────────────────
function pairList() {
  if (PAIRS_ARG === 'calibration') {
    const key = JSON.parse(fs.readFileSync(
      path.join(REPO, 'grader', 'calibration-key-round1.json'), 'utf8'))
    return key.pairs.map((p) => ({ id: `pair${p.pair}`, A: p.A, B: p.B }))
  }
  if (REFERENCE) {
    // Reference-anchored sweep: every graded report vs one fixed reference.
    // O(n) calls, and it yields a common scale instead of only an ordering.
    const all = fs.readdirSync(factsDir).filter((x) => x.endsWith('.json'))
      .map((x) => x.replace('.json', '').replace('__', '/'))
    return all.filter((r) => r !== REFERENCE)
      .map((r) => ({ id: `ref:${r}`, A: r, B: REFERENCE }))
  }
  if (PAIRS_ARG) {
    return PAIRS_ARG.split(',').map((s, i) => {
      const [A, B] = s.split(':')
      return { id: `pair${i + 1}`, A, B }
    })
  }
  throw new Error('need --pairs=calibration | --pairs=a:b,... | --reference=cell/rep')
}

const allPairs = pairList()
const outDir = path.join(HERE, 'out', `${TASK}-pairwise`)
const pairDir = path.join(outDir, 'pairs')
fs.mkdirSync(pairDir, { recursive: true })

// ── resume ──────────────────────────────────────────────────────────────
// Each pair is written to disk the moment both of its orders land, so a kill, a
// crash, or a concurrency change costs only the calls in flight. Without this the
// whole sweep was all-or-nothing at the end, which is what made raising
// concurrency mid-run expensive.
const safeName = (id) => id.replace(/[^A-Za-z0-9._-]/g, '_') + '.json'
const FORCE = flag('force')
const cached = new Map()
if (!FORCE) {
  for (const p of allPairs) {
    const f = path.join(pairDir, safeName(p.id))
    if (fs.existsSync(f)) {
      try { cached.set(p.id, JSON.parse(fs.readFileSync(f, 'utf8'))) } catch {}
    }
  }
}
const pairs = allPairs.filter((p) => !cached.has(p.id))
if (cached.size) {
  console.log(`pairwise: resuming -- ${cached.size} pair(s) already on disk, `
    + `${pairs.length} to run`)
}

console.log(`pairwise: ${MODEL} effort=max thinking=${THINKING.type} `
  + `concurrency=${CONC}`)
console.log(`pairwise: ${allPairs.length} pairs x 2 orders = ${allPairs.length * 2} `
  + `calls${TIEBREAK ? ' (+ tiebreaks where the orders disagree)' : ''}`)

if (DRY) {
  const p = allPairs[0]
  const f1 = loadFacts(p.A)
  const f2 = loadFacts(p.B)
  const u = userMessage(f1, f2)
  console.log(`\n--- system: ${SYS.length} chars ---`)
  console.log(`--- user for ${p.id} (${p.A} vs ${p.B}): ${u.length} chars ---\n`)
  console.log(u.slice(0, 3000))
  console.log('\n[...reports continue...]')
  process.exit(0)
}

// ── drive it ────────────────────────────────────────────────────────────
const jobs = []
for (const p of pairs) {
  jobs.push({ ...p, order: 'AB' })
  jobs.push({ ...p, order: 'BA' })
}

const byPair = new Map()
let done = 0
let failed = 0
const started = Date.now()

/**
 * Persist a pair as soon as its verdict is final, so nothing in flight is ever
 * the only copy. "Final" = both orders in and agreeing, or the tiebreak pass has
 * already run (>=4 calls). A pair whose orders disagree is deliberately NOT
 * written yet -- it is about to be tiebroken, and writing it now would persist a
 * verdict we are in the middle of revising.
 */
function flushPair(id, force = false) {
  const rec = byPair.get(id)
  if (!rec || rec.calls.length < 2) return
  const ws = new Set(rec.calls.map((c) => c.dims.OVERALL.winner_ab))
  if (!force && ws.size > 1 && rec.calls.length < 4) return
  const out = { ...resolve(rec), _detail: rec }
  fs.writeFileSync(path.join(pairDir, safeName(id)),
    JSON.stringify(out, null, 1))
}

async function worker() {
  while (jobs.length) {
    const job = jobs.shift()
    if (!job) return
    const runId = `pairwise-${TASK}-${job.id}-${job.order}`
      + (job.tb ? `-tb${job.tb}` : '')
    try {
      const r = await withRetry(
        () => judgePair(job.A, job.B, job.order, runId),
        `${job.id} ${job.order}`)
      if (!byPair.has(job.id)) {
        byPair.set(job.id, { id: job.id, A: job.A, B: job.B, calls: [] })
      }
      byPair.get(job.id).calls.push(r)
      done++
      const ov = r.dims.OVERALL
      console.log(`[${done}/${done + jobs.length + failed}] ${job.id} `
        + `${job.order}${job.tb ? ' tb' + job.tb : ''} -> ${ov.winner_ab} `
        + `(${ov.margin})`)
      flushPair(job.id)
    } catch (err) {
      failed++
      console.error(`FAIL ${job.id} ${job.order}: ${err.message}`)
    }
  }
}

await Promise.all(Array.from({ length: CONC }, () => worker()))

// ── tiebreak the pairs whose two orders disagreed ───────────────────────
if (TIEBREAK) {
  const need = []
  for (const rec of byPair.values()) {
    const ws = rec.calls.map((c) => c.dims.OVERALL.winner_ab)
    if (new Set(ws).size > 1) {
      need.push({ ...rec, order: 'AB', tb: 1 }, { ...rec, order: 'BA', tb: 2 })
    }
  }
  if (need.length) {
    console.log(`\npairwise: ${need.length / 2} pair(s) disagreed across orders `
      + `-- running ${need.length} tiebreak calls`)
    jobs.push(...need)
    await Promise.all(Array.from({ length: CONC }, () => worker()))
  }
}

// ── resolve each pair ───────────────────────────────────────────────────
function resolve(rec) {
  const out = { id: rec.id, A: rec.A, B: rec.B, calls: rec.calls.length }
  for (const d of DIMS) {
    const votes = rec.calls.map((c) => c.dims[d]).filter((x) => x && !x.unusable)
    const tally = { A: 0, B: 0, EQUAL: 0 }
    for (const v of votes) tally[v.winner_ab] = (tally[v.winner_ab] || 0) + 1
    const clear = votes.filter((v) => v.margin === 'CLEAR').length
    let winner = 'EQUAL'
    if (tally.A > tally.B && tally.A > tally.EQUAL) winner = 'A'
    else if (tally.B > tally.A && tally.B > tally.EQUAL) winner = 'B'
    out[d] = {
      winner,
      tally,
      clear_votes: clear,
      usable_votes: votes.length,
      // Position bias: did the answer depend on which slot the report sat in?
      order_consistent: new Set(rec.calls.map((c) => c.dims[d].winner_ab)).size === 1,
    }
  }
  out.position_bias = !out.OVERALL.order_consistent
  return out
}

// Anything still unwritten (a pair that ran out of tiebreaks, or whose second
// order failed) gets forced to disk so the run leaves no work stranded.
for (const id of byPair.keys()) flushPair(id, true)

// Assemble from the pair files, so resumed and fresh pairs are treated
// identically and the order follows the original pair list.
const resolved = []
const detail = []
for (const p of allPairs) {
  const f = path.join(pairDir, safeName(p.id))
  if (!fs.existsSync(f)) continue
  const rec = JSON.parse(fs.readFileSync(f, 'utf8'))
  const { _detail, ...clean } = rec
  resolved.push(clean)
  if (_detail) detail.push(_detail)
}

fs.writeFileSync(path.join(outDir, 'results.json'),
  JSON.stringify({
    task: TASK, model: MODEL, effort: 'max',
    mode: REFERENCE ? `reference:${REFERENCE}` : (PAIRS_ARG || 'explicit'),
    pairs: resolved,
    detail,
  }, null, 1))

const pad = (s, n) => String(s).slice(0, n).padEnd(n)
const lpad = (s, n) => String(s).slice(0, n).padStart(n)

console.log('\n' + '='.repeat(74))
console.log(pad('pair', 10) + pad('A  /  B', 32) + lpad('overall', 8)
  + lpad('clear', 8) + '  order')
console.log('-'.repeat(74))
for (const r of resolved) {
  const ov = r.OVERALL
  console.log(pad(r.id, 10) + pad(r.A, 32) + lpad(ov.winner, 8)
    + lpad(`${ov.clear_votes}/${ov.usable_votes}`, 8)
    + (r.position_bias ? '  FLIPPED' : '  ok'))
  console.log(' '.repeat(10) + pad(r.B, 32))
}
const biased = resolved.filter((r) => r.position_bias).length
const mins = ((Date.now() - started) / 60000).toFixed(1)
console.log('-'.repeat(72))
console.log(`${resolved.length} pairs, ${done} calls ok, ${failed} failed, ${mins} min`)
console.log(`position bias: ${biased} of ${resolved.length} pairs flipped when `
  + `the order was swapped`)
console.log(`wrote ${path.join(outDir, 'results.json')}`)
