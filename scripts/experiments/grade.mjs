// Grader — deterministic behavioural metrics + a 3-pass LLM judge, written
// to <rep-dir>/grade.json. Every judge request goes through the app's own
// callClaude, so judge spend lands on runs/usage.jsonl like anything else.
//
//   node scripts/experiments/grade.mjs <rep-dir> [--passes=3]
//        [--report-file=path] [--out=path] [--label=name] [--dry] [--force]
//
// --report-file swaps the report markdown (synthetic controls) while keeping
// the rep dir's tree, sources and trace. Read-only on data/ — this script
// never touches the store.
//
// The seed check is the harness's to make, not ours: this reads
// seed_check_ok off result.json and refuses a run that failed it, because a
// tree seeded from the previous run's residue is not the tree the variant
// produced. --force overrides; the flag lands in grade.json either way.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

// repo.mjs chdirs to the repo root the moment it loads, so capture the launch
// cwd first and resolve every CLI path against it.
const LAUNCH_CWD = process.cwd()
const repo = await import('./repo.mjs')
const { callClaude, MODEL, MAX_TOKENS, THINKING, EFFORT, REPO } = repo

const GRADER_DIR = path.join(REPO, 'grader')
const DEFAULT_RUBRIC = path.join(GRADER_DIR, 'rubric.json')

// Same published rates the app's meter uses; duplicated rather than imported
// so the grader keeps working on a persisted usage.jsonl alone.
const RATES = { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 }
const SEARCH_USD = 10 / 1000

const TERMINAL = ['done', 'cancelled']

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'do', 'for',
  'from', 'how', 'if', 'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or',
  'out', 'that', 'the', 'their', 'then', 'there', 'this', 'to', 'up',
  'was', 'what', 'when', 'which', 'who', 'why', 'with', 'you', 'your',
  'my', 'me', 'i', 'we', 'find', 'check', 'write', 'decide', 'run',
])

// ── helpers ─────────────────────────────────────────────────────────────

const rd = (p) => fs.readFileSync(p, 'utf8')
const readJson = (p) => JSON.parse(rd(p))
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')
const abs = (p) => (path.isAbsolute(p) ? p : path.resolve(LAUNCH_CWD, p))

function readJsonl(p) {
  if (!fs.existsSync(p)) return null
  return rd(p)
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
}

/** normalizer_v1: lowercase scheme+host, drop www., fragment, trailing / */
function normUrl(u) {
  try {
    const x = new URL(String(u).trim())
    const host = x.host.toLowerCase().replace(/^www\./, '')
    const p = x.pathname.replace(/\/+$/, '')
    return `${x.protocol.toLowerCase()}//${host}${p}${x.search}`
  } catch {
    return String(u).trim().toLowerCase().replace(/\/+$/, '')
  }
}

const normQuery = (q) =>
  String(q).toLowerCase().replace(/\s+/g, ' ').trim()
    .replace(/[.,;:!?'"’”]+$/, '')

const tokens = (s) =>
  String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

function jaccard(a, b) {
  const A = new Set(a)
  const B = new Set(b)
  if (!A.size && !B.size) return 1
  let hit = 0
  for (const x of A) if (B.has(x)) hit++
  return hit / (A.size + B.size - hit)
}

function levSim(a, b) {
  if (a === b) return 1
  const m = a.length
  const n = b.length
  if (!m || !n) return 0
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = cur
  }
  return 1 - prev[n] / Math.max(m, n)
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  if (!s.length) return null
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Folded for substring checks — models drift on dash and quote glyphs. */
const fold = (s) =>
  String(s)
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—‒−]/g, '-')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

// ── loading a rep dir ───────────────────────────────────────────────────

/** Flattens whatever tree shape a result.json happens to carry. */
function collectTasks(node, out = []) {
  if (!node) return out
  if (Array.isArray(node)) {
    for (const n of node) collectTasks(n, out)
    return out
  }
  if (Array.isArray(node.tasks)) return collectTasks(node.tasks, out)
  if (node.id) {
    const { children, subtasks, ...rest } = node
    out.push(rest)
    collectTasks(children ?? subtasks ?? [], out)
  }
  return out
}

function loadRep(dir, reportFile) {
  const result = fs.existsSync(path.join(dir, 'result.json'))
    ? readJson(path.join(dir, 'result.json'))
    : {}
  const snapPath = path.join(dir, 'tasks-snapshot.json')
  let tasks
  if (fs.existsSync(snapPath)) tasks = collectTasks(readJson(snapPath))
  else if (result.final_task_tree) tasks = collectTasks(result.final_task_tree)
  else throw new Error(`no tasks-snapshot.json or final_task_tree in ${dir}`)

  const taskId = result.task_id || 't-dog'
  const task = tasks.find((t) => t.id === taskId)
  if (!task) throw new Error(`task ${taskId} missing from ${dir}`)
  const subtasks = tasks.filter((t) => t.parentId === task.id)

  const report = { ...(task.report || {}) }
  if (reportFile) report.markdown = rd(reportFile)
  if (!report.markdown) throw new Error(`no report attached in ${dir}`)
  report.sources = report.sources || []

  // The harness writes seed_check_ok; accept the design's name as an alias.
  const seedOk = result.seed_check_ok ?? result.seed_hash_ok ?? null

  return {
    dir,
    result,
    seedOk,
    task,
    subtasks,
    report,
    trace: readJsonl(path.join(dir, 'trace.jsonl')),
    usage: readJsonl(path.join(dir, 'usage.jsonl')),
  }
}

// ── deterministic metrics (spec §4) ─────────────────────────────────────

function behavioural(rep) {
  const { trace, usage, task, subtasks, report } = rep
  const m = {}
  const ev = (t) => (trace || []).filter((e) => e.type === t)

  m.report_chars = report.markdown.length
  m.sources_count = report.sources.length
  m.cite_count = (report.markdown.match(/<cite\b/g) || []).length
  m.human_subtasks = subtasks.filter((s) => s.assignee === 'human').length
  m.agent_subtasks = subtasks.filter((s) => s.assignee === 'agent').length

  // Measured, never scored. An agent subtask still not_started at run end was
  // never picked up at all — distinct from one parked at `waiting`, which the
  // agent could still address. In stage 1a only the droptools cells show it,
  // and the transcripts trace it to elided tool-result payloads carrying the
  // subtask ids away with them.
  m.abandoned_subtasks = subtasks.filter(
    (s) => s.assignee === 'agent' && s.status === 'not_started',
  ).length

  if (!trace) {
    m.trace_available = false
    return m
  }
  m.trace_available = true

  const searches = ev('web_search').map((e) => e.query ?? '')
  const fetches = ev('web_fetch').map((e) => e.url ?? '')
  const nq = searches.map(normQuery)
  const nu = fetches.map(normUrl)
  const dq = new Set(nq)
  const du = new Set(nu)

  m.searches_trace = searches.length
  m.distinct_searches = dq.size
  m.dup_search_pct = searches.length ? 1 - dq.size / searches.length : 0
  m.fetches_trace = fetches.length
  m.distinct_fetches = du.size
  m.wasted_fetch_pct = fetches.length ? 1 - du.size / fetches.length : 0

  // Near-dups are the softer signal: pairs above the Jaccard bar that the
  // exact-dup count did not already claim.
  const uniq = [...dq]
  let near = 0
  for (let i = 0; i < uniq.length; i++) {
    for (let j = i + 1; j < uniq.length; j++) {
      if (jaccard(tokens(uniq[i]), tokens(uniq[j])) >= 0.8) near++
    }
  }
  m.near_dup_searches = near

  const cited = report.sources.map((s) => normUrl(s.url))
  const fetchedSet = du
  const unfetched = cited.filter((u) => !fetchedSet.has(u))
  m.cited_sources = cited.length
  m.cited_fetched = cited.length - unfetched.length
  m.cited_unfetched_ratio = cited.length ? unfetched.length / cited.length : 0
  m.cited_unfetched = unfetched

  // recreated subtasks
  const created = ev('subtask_created').map((e) => e.title ?? '')
  const pairs = []
  for (let i = 0; i < created.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = normQuery(created[j])
      const b = normQuery(created[i])
      if (jaccard(tokens(a), tokens(b)) >= 0.9 || levSim(a, b) >= 0.85) {
        pairs.push([created[j], created[i]])
        break
      }
    }
  }
  m.subtasks_created = created.length
  m.recreated_subtasks = pairs.length
  m.recreated_pairs = pairs

  // update_task no-ops: nothing changed within 2s, or the status written was
  // the one already in force.
  const ts = (e) => Date.parse(e.ts)
  const statusEvents = ev('status_changed')
  const cur = new Map()
  for (const e of statusEvents) {
    e._redundant = cur.get(e.taskId) === e.status
    cur.set(e.taskId, e.status)
  }
  const changes = [...statusEvents, ...ev('task_updated')]
  let noops = 0
  for (const u of ev('tool_use').filter((e) => e.name === 'update_task')) {
    const near2s = changes.filter(
      (c) => ts(c) >= ts(u) - 100 && ts(c) <= ts(u) + 2000,
    )
    if (!near2s.length) noops++
    else if (near2s.every((c) => c._redundant)) noops++
  }
  m.update_task_noops = noops

  // re-research after close: the "forgot it already finished" signal.
  const words = (s) => tokens(s).filter((w) => !STOPWORDS.has(w))
  const reHits = []
  for (const st of subtasks.filter((s) => s.assignee === 'agent')) {
    const close = statusEvents
      .filter((e) => e.taskId === st.id && TERMINAL.includes(e.status))
      .map(ts)
      .sort((a, b) => a - b)[0]
    if (close == null) continue
    for (const e of ev('web_search')) {
      if (ts(e) <= close) continue
      if (jaccard(words(st.title), words(e.query ?? '')) >= 0.5) {
        reHits.push({ subtask: st.title, query: e.query })
      }
    }
  }
  m.re_research_after_close = reHits.length
  m.re_research_pairs = reHits

  m.turns = ev('turn_started').length
  m.comments = ev('comment_added').length
  const started = ev('run_started')[0]
  const finished = ev('run_finished')[0]
  m.wallclock_s =
    started && finished ? (ts(finished) - ts(started)) / 1000 : null

  const attached = ev('report_attached').length > 0
  const terminal = ['done', 'waiting', 'needs_review'].includes(task.status)
  m.completed = attached && terminal
  m.failure_mode = m.completed
    ? null
    : !attached
      ? 'no_report'
      : `parent_status_${task.status}`

  if (!usage) {
    m.usage_available = false
    return m
  }
  m.usage_available = true
  const sum = (k) => usage.reduce((a, r) => a + (r[k] || 0), 0)
  m.api_calls = usage.length
  m.tokens_uncached_input = sum('input_tokens')
  m.tokens_cache_write = sum('cache_creation_input_tokens')
  m.tokens_cache_read = sum('cache_read_input_tokens')
  m.tokens_output = sum('output_tokens')
  m.searches = sum('web_search_requests')
  m.fetches = sum('web_fetch_requests')
  m.cost_uncached_input = (m.tokens_uncached_input * RATES.input) / 1e6
  m.cost_cache_write = (m.tokens_cache_write * RATES.cacheWrite) / 1e6
  m.cost_cache_read = (m.tokens_cache_read * RATES.cacheRead) / 1e6
  m.cost_output = (m.tokens_output * RATES.output) / 1e6
  m.cost_search = m.searches * SEARCH_USD
  m.cost_usd_recomputed =
    m.cost_uncached_input + m.cost_cache_write + m.cost_cache_read +
    m.cost_output + m.cost_search
  m.cost_usd_reported = usage.reduce((a, r) => a + (r.cost_usd || 0), 0)
  m.latency_total_s = sum('latency_ms') / 1000
  m.cache_hit_call1 = (usage[0]?.cache_read_input_tokens || 0) > 0

  // A trace/usage disagreement means a logging bug, not a behaviour.
  m.search_count_mismatch = m.searches !== m.searches_trace
  m.fetch_count_mismatch = m.fetches !== m.fetches_trace

  return m
}

// ── judge context ───────────────────────────────────────────────────────

/**
 * The material the judge sees. Deliberately excludes the transcript, trace,
 * usage, cost, variant name and every timestamp — a judge that can see the
 * treatment stops producing comparable scores.
 */
function buildMaterial(rep) {
  const { task, subtasks, report } = rep
  const out = []
  out.push('# REPORT\n')
  out.push(report.markdown.trim())
  out.push('\n\n# SOURCE LIST\n')
  report.sources.forEach((s, i) => {
    out.push(`${i + 1}. ${s.title || '(untitled)'} — ${s.url}`)
  })
  out.push('\n\n# TASK\n')
  out.push(`Title: ${task.title}`)
  out.push(`Status: ${task.status}`)
  out.push(`Assignee: ${task.assignee}`)
  out.push(`Description:\n${task.description || '(none)'}`)
  for (const c of task.comments || []) {
    out.push(`\nComment (${c.author}):\n${c.body}`)
  }
  out.push('\n\n# SUBTASKS\n')
  for (const s of subtasks) {
    out.push(`## [${s.assignee}] [${s.status}] ${s.title}`)
    out.push(s.description || '(no description)')
    for (const c of s.comments || []) {
      out.push(`Comment (${c.author}): ${c.body}`)
    }
    out.push('')
  }
  return out.join('\n')
}

// Items that ride a shared extraction rather than their own verdict: B2/B3
// read the claim list, C5 reads the handoff list, and anything carrying
// `levels` is the one 3-level slot. Everything else judged is binary. Holding
// to those ids is what lets a second rubric drop in without touching this
// file.
const EXTRACTION_IDS = ['B2', 'B3', 'C5']

function binaryIds(rubric) {
  return rubric.items
    .filter((i) => i.type !== 'D' && !i.levels && !EXTRACTION_IDS.includes(i.id))
    .map((i) => i.id)
}

function levelId(rubric) {
  return rubric.items.find((i) => i.levels)?.id ?? null
}

const buildSchema = (BINARY_IDS) => ({
  type: 'object',
  additionalProperties: false,
  required: ['binary_verdicts', 'c1', 'price_claims', 'handoffs'],
  properties: {
    binary_verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'verdict', 'evidence'],
        properties: {
          id: { type: 'string', enum: BINARY_IDS },
          verdict: { type: 'string', enum: ['pass', 'fail'] },
          evidence: { type: 'string' },
        },
      },
    },
    c1: {
      type: 'object',
      additionalProperties: false,
      required: ['level', 'primary_option_count', 'evidence'],
      properties: {
        level: { type: 'integer', enum: [0, 3, 6] },
        primary_option_count: { type: 'integer' },
        evidence: { type: 'string' },
      },
    },
    price_claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'provider', 'price', 'source_url', 'flagged_approximate',
          'evidence',
        ],
        properties: {
          provider: { type: 'string' },
          price: { type: 'string' },
          source_url: { type: 'string' },
          flagged_approximate: { type: 'boolean' },
          evidence: { type: 'string' },
        },
      },
    },
    handoffs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['task_title', 'self_contained', 'evidence'],
        properties: {
          task_title: { type: 'string' },
          self_contained: { type: 'boolean' },
          evidence: { type: 'string' },
        },
      },
    },
  },
})

function buildStatic(rubric, prompt) {
  return [
    prompt,
    '\n\n---\n\n# Rubric (v' + rubric.rubric_version + ')\n\n```json\n' +
      JSON.stringify(
        {
          items: rubric.items.filter((i) => i.type !== 'D'),
          anchors: rubric.anchors,
        },
        null,
        1,
      ) +
      '\n```\n',
  ].join('')
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const s = body.indexOf('{')
  const e = body.lastIndexOf('}')
  if (s < 0 || e < 0) throw new Error('no JSON object in judge reply')
  return JSON.parse(body.slice(s, e + 1))
}

async function judgeCall(staticText, material, runId, schemaMode, schema) {
  const req = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: THINKING,
    output_config: schemaMode
      ? { effort: EFFORT, format: { type: 'json_schema', schema } }
      : { effort: EFFORT },
    system: [
      { type: 'text', text: staticText, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: material }],
  }
  const msg = await callClaude(req, { taskId: 'grader', runId })
  const text = (msg.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
  return { parsed: extractJson(text), stop: msg.stop_reason }
}

/** Cheap probe: does streaming tolerate output_config.format on this SDK? */
async function probeSchema(runId) {
  try {
    await callClaude(
      {
        model: MODEL,
        max_tokens: 4096,
        thinking: THINKING,
        output_config: {
          effort: EFFORT,
          format: {
            type: 'json_schema',
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['ok'],
              properties: { ok: { type: 'boolean' } },
            },
          },
        },
        system: [{ type: 'text', text: 'Reply with {"ok": true}.' }],
        messages: [{ role: 'user', content: 'ok?' }],
      },
      { taskId: 'grader', runId },
    )
    return true
  } catch (err) {
    console.error(`  structured output probe failed: ${err.message}`)
    return false
  }
}

// ── validation + aggregation ────────────────────────────────────────────

function validatePass(raw, hay, humanTitles, BINARY_IDS) {
  const ok = (e) => {
    const t = fold(e ?? '')
    return t === 'ABSENT' || (t.length > 0 && hay.includes(t))
  }
  const binary = new Map()
  for (const v of raw.binary_verdicts || []) {
    if (!BINARY_IDS.includes(v.id)) continue
    binary.set(v.id, {
      verdict: v.verdict === 'pass' ? 1 : 0,
      evidence: v.evidence,
      voided: !ok(v.evidence),
    })
  }
  const c1 = raw.c1
    ? {
        level: [0, 3, 6].includes(raw.c1.level) ? raw.c1.level : null,
        count: raw.c1.primary_option_count,
        evidence: raw.c1.evidence,
        voided: !ok(raw.c1.evidence),
      }
    : { level: null, voided: true }

  const claims = (raw.price_claims || []).map((c) => ({
    ...c,
    voided: !ok(c.evidence),
  }))

  const byTitle = new Map(humanTitles.map((t) => [fold(t).toLowerCase(), t]))
  const handoffs = (raw.handoffs || []).map((h) => ({
    ...h,
    matched: byTitle.get(fold(h.task_title ?? '').toLowerCase()) ?? null,
    voided: !ok(h.evidence),
  }))
  return { binary, c1, claims, handoffs }
}

function majority(votes) {
  if (!votes.length) return { verdict: null, agreement: 0, contested: true }
  const pass = votes.filter((v) => v === 1).length
  const verdict = pass * 2 >= votes.length ? 1 : 0
  const agree = votes.filter((v) => v === verdict).length
  return {
    verdict,
    agreement: agree / votes.length,
    contested: agree !== votes.length,
    votes,
  }
}

// ── main ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const flags = Object.fromEntries(
  args.filter((a) => a.startsWith('--')).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  }),
)
const repDirArg = args.find((a) => !a.startsWith('--'))
if (!repDirArg) {
  console.error('usage: grade.mjs <rep-dir> [--passes=3] [--report-file=…]')
  process.exit(1)
}
const repDir = abs(repDirArg)
const passes = Number(flags.passes ?? 3)
const reportFile = flags['report-file'] ? abs(flags['report-file']) : null
const label = flags.label || path.basename(repDir)
const outPath = flags.out
  ? abs(flags.out)
  : path.join(
      repDir,
      reportFile
        ? `grade-${path.basename(reportFile).replace(/\.[^.]+$/, '')}.json`
        : 'grade.json',
    )

const rubricPath = flags.rubric ? abs(flags.rubric) : DEFAULT_RUBRIC
const rubricText = rd(rubricPath)
const rubric = JSON.parse(rubricText)
// The prompt is versioned with the rubric that names it, so a second task's
// rubric brings its own instructions without a flag of its own.
const promptPath = path.join(GRADER_DIR, rubric.judge_prompt ?? 'judge_prompt.md')
const promptText = rd(promptPath)
const BINARY_IDS = binaryIds(rubric)
const LEVEL_ID = levelId(rubric)
const SCHEMA = buildSchema(BINARY_IDS)

// A crashed run has no deliverable to score. Say so and exit 3 rather than
// throwing a stack trace at whoever is grading cells in bulk — the run still
// counts, as a failure, in whatever aggregates over these dirs.
let rep
try {
  rep = loadRep(repDir, reportFile)
} catch (err) {
  const res = fs.existsSync(path.join(repDir, 'result.json'))
    ? readJson(path.join(repDir, 'result.json'))
    : {}
  if (res.status === 'error' || /no report attached/.test(err.message)) {
    console.error(`not gradeable: ${path.basename(repDir)} — ${err.message}`)
    if (res.error) console.error(`  run error: ${String(res.error).slice(0, 200)}`)
    process.exit(3)
  }
  throw err
}
const det = behavioural(rep)
const material = buildMaterial(rep)
const hay = fold(material)
const humanTitles = rep.subtasks
  .filter((s) => s.assignee === 'human')
  .map((s) => s.title)
const fetchedRaw = (rep.trace || [])
  .filter((e) => e.type === 'web_fetch')
  .map((e) => e.url)
const fetchedSet = new Set(fetchedRaw.map(normUrl))
const hasB = det.trace_available === true

console.log(
  `grading ${label} (${passes} passes, axis B ${hasB ? 'on' : 'N/A'})`,
)
console.log(`  report ${det.report_chars} chars, ${det.sources_count} sources`)

// Residue from a previous run makes the tree unattributable to this variant.
if (rep.seedOk === false && !flags.force) {
  console.error('  seed_check_ok is false — refusing to grade. --force to override.')
  process.exit(2)
}
if (rep.seedOk == null) {
  console.log('  seed_check_ok absent (banked or pre-harness run) — recorded as null')
}

if (flags.dry) {
  console.log(JSON.stringify(det, null, 1))
  console.log(`material: ${material.length} chars`)
  process.exit(0)
}

const runBase = `grade-${label}`.replace(/[^a-zA-Z0-9-]/g, '-')
const schemaMode = await probeSchema(`${runBase}-probe`)
console.log(`  structured output: ${schemaMode ? 'json_schema' : 'in-prompt'}`)

const staticText = buildStatic(rubric, promptText) +
  (schemaMode ? '' : '\n\nReturn ONLY the JSON object. No prose, no fences.\n')

const rawPasses = []
for (let p = 1; p <= passes; p++) {
  let attempt = 0
  for (;;) {
    try {
      const r = await judgeCall(
        staticText, material, `${runBase}-p${p}`, schemaMode, SCHEMA,
      )
      rawPasses.push(r.parsed)
      console.log(`  pass ${p}: ok (${r.stop})`)
      break
    } catch (err) {
      attempt++
      console.error(`  pass ${p} attempt ${attempt} failed: ${err.message}`)
      if (attempt >= 2) throw err
    }
  }
}

const validated = rawPasses.map(
  (r) => validatePass(r, hay, humanTitles, BINARY_IDS),
)

// ── per-item scoring ────────────────────────────────────────────────────

const byId = Object.fromEntries(rubric.items.map((i) => [i.id, i]))
const items = {}
const record = (id, extra) => {
  const spec = byId[id]
  items[id] = {
    axis: spec.axis, points: spec.points, type: spec.type, ...extra,
  }
}

for (const id of BINARY_IDS) {
  const votes = []
  const evidence = []
  let voided = 0
  for (const v of validated) {
    const e = v.binary.get(id)
    if (!e) continue
    evidence.push({
      evidence: e.evidence, verdict: e.verdict, voided: e.voided,
    })
    if (e.voided) voided++
    else votes.push(e.verdict)
  }
  const agg = majority(votes)
  record(id, {
    verdict: agg.verdict,
    score: (agg.verdict ?? 0) * byId[id].points,
    agreement: agg.agreement,
    contested: agg.contested,
    votes: agg.votes ?? [],
    voided_passes: voided,
    evidence,
  })
}

// C1 — median of the three anchored levels.
const c1Levels = validated
  .filter((v) => v.c1 && !v.c1.voided && v.c1.level != null)
  .map((v) => v.c1.level)
const c1Med = median(c1Levels)
if (LEVEL_ID) record(LEVEL_ID, {
  level: c1Med,
  score: c1Med ?? 0,
  agreement: c1Levels.length
    ? c1Levels.filter((l) => l === c1Med).length / c1Levels.length
    : 0,
  contested: new Set(c1Levels).size > 1,
  votes: c1Levels,
  voided_passes: validated.filter((v) => v.c1?.voided).length,
  evidence: validated.map((v) => ({
    level: v.c1?.level, count: v.c1?.count,
    evidence: v.c1?.evidence, voided: v.c1?.voided,
  })),
})

// C5 — fraction of human subtasks that stand on their own. Unreported
// subtasks count against the run, so a judge cannot lift the score by
// listing only the good ones.
const c5Fracs = []
const c5Detail = []
for (const v of validated) {
  const good = v.handoffs.filter(
    (h) => h.matched && !h.voided && h.self_contained === true,
  ).length
  const frac = humanTitles.length ? good / humanTitles.length : 0
  c5Fracs.push(frac)
  c5Detail.push({
    fraction: frac,
    numerator: good,
    denominator: humanTitles.length,
    reported: v.handoffs.length,
    matched: v.handoffs.filter((h) => h.matched).length,
    entries: v.handoffs,
  })
}
const c5Med = median(c5Fracs) ?? 0
record('C5', {
  fraction: c5Med,
  score: c5Med * byId.C5.points,
  agreement: c5Fracs.length
    ? c5Fracs.filter((f) => f === c5Med).length / c5Fracs.length
    : 0,
  contested: new Set(c5Fracs).size > 1,
  votes: c5Fracs,
  human_subtasks: humanTitles.length,
  evidence: c5Detail,
})

if (hasB) {
  // B1 — deterministic source-verification ratio.
  const v1 = det.cited_sources ? det.cited_fetched / det.cited_sources : 0
  record('B1', {
    ratio: v1,
    numerator: det.cited_fetched,
    denominator: det.cited_sources,
    score: v1 * byId.B1.points,
    agreement: 1,
    contested: false,
    // Raw and normalized, both persisted: the normalizer is versioned and a
    // future version has to be re-runnable against what was actually seen.
    inputs: {
      sources_raw: rep.report.sources.map((s) => s.url),
      sources_normalized: rep.report.sources.map((s) => normUrl(s.url)),
      fetched_raw: fetchedRaw,
      fetched_normalized: [...fetchedSet],
      unfetched_normalized: det.cited_unfetched,
    },
  })

  // B2 / B3 — one extraction, two readings. B3 is hybrid rather than a pure
  // judge item: the judge is deliberately blind to the trace, so only the
  // script can know which claims rest on an unfetched source.
  const b2Fracs = []
  const b3Votes = []
  const claimDetail = []
  for (const v of validated) {
    const cs = v.claims.filter((c) => !c.voided)
    const marked = cs.map((c) => ({
      provider: c.provider,
      price: c.price,
      source_url: c.source_url,
      normalized: normUrl(c.source_url),
      fetched: fetchedSet.has(normUrl(c.source_url)),
      flagged_approximate: c.flagged_approximate === true,
      evidence: c.evidence,
    }))
    const verified = marked.filter((c) => c.fetched).length
    b2Fracs.push(marked.length ? verified / marked.length : 0)
    b3Votes.push(
      marked.every((c) => c.fetched || c.flagged_approximate) ? 1 : 0,
    )
    claimDetail.push({
      numerator: verified,
      denominator: marked.length,
      unflagged_unverified: marked
        .filter((c) => !c.fetched && !c.flagged_approximate)
        .map((c) => `${c.provider} ${c.price}`),
      claims: marked,
      voided: v.claims.filter((c) => c.voided).length,
    })
  }
  const b2Med = median(b2Fracs) ?? 0
  record('B2', {
    fraction: b2Med,
    score: b2Med * byId.B2.points,
    agreement: b2Fracs.length
      ? b2Fracs.filter((f) => f === b2Med).length / b2Fracs.length
      : 0,
    contested: new Set(b2Fracs).size > 1,
    votes: b2Fracs,
    evidence: claimDetail,
  })
  const b3 = majority(b3Votes)
  record('B3', {
    verdict: b3.verdict,
    score: (b3.verdict ?? 0) * byId.B3.points,
    agreement: b3.agreement,
    contested: b3.contested,
    votes: b3.votes ?? [],
  })

  // B4 — subtask hygiene, straight off the tree.
  const agents = rep.subtasks.filter((s) => s.assignee === 'agent')
  const allTerminal =
    agents.length > 0 &&
    agents.every((s) => TERMINAL.includes(s.status))
  const parentOk = ['waiting', 'needs_review', 'done'].includes(rep.task.status)
  const justified =
    (rep.task.comments || []).length > 0 || !!rep.task.report?.markdown
  const b4 = allTerminal && parentOk && justified ? 1 : 0
  record('B4', {
    verdict: b4,
    score: b4 * byId.B4.points,
    agreement: 1,
    contested: false,
    inputs: {
      agent_subtasks: agents.map((s) => ({ title: s.title, status: s.status })),
      parent_status: rep.task.status,
      justified,
    },
  })
}

// ── totals ──────────────────────────────────────────────────────────────

const axisPoints = { A: 0, B: 0, C: 0 }
const axisScore = { A: 0, B: 0, C: 0 }
for (const it of Object.values(items)) {
  axisPoints[it.axis] += it.points
  axisScore[it.axis] += it.score
}
const scored = Object.values(items)
const total = scored.reduce((a, i) => a + i.score, 0)
const available = scored.reduce((a, i) => a + i.points, 0)
const judged = scored.filter((i) => i.type !== 'D')
const unanimous = judged.filter((i) => !i.contested).length
const contestedItems = Object.entries(items)
  .filter(([, i]) => i.contested)
  .map(([id]) => id)

const grade = {
  label,
  rep_dir: path.relative(REPO, repDir),
  report_source: reportFile ? path.relative(REPO, reportFile) : 'tree',
  graded_at: new Date().toISOString(),
  rubric_version: rubric.rubric_version,
  rubric_sha256: sha256(rubricText),
  judge_prompt: path.relative(REPO, promptPath),
  judge_prompt_sha256: sha256(promptText),
  // Hash of exactly what the judge was shown. The file hashes move for any
  // edit at all — a changelog line, a comment — but only this one moving can
  // invalidate a grade, so this is the one to compare across a rubric edit.
  judge_payload_sha256: sha256(staticText),
  normalizer_version: rubric.normalizer_version,
  seed_check_ok: rep.seedOk,
  run_id: rep.result.run_id ?? null,
  task_id: rep.result.task_id ?? rep.task.id,
  judge: {
    model: MODEL,
    effort: EFFORT,
    passes,
    structured_output: schemaMode ? 'json_schema' : 'schema_in_prompt',
  },
  axes_evaluated: hasB ? ['A', 'B', 'C'] : ['A', 'C'],
  score_total: round(total),
  points_available: available,
  score_normalized_100: round((total / available) * 100),
  score_A_content: round(axisScore.A),
  score_B_grounding: hasB ? round(axisScore.B) : null,
  score_C_scope: round(axisScore.C),
  judge_agreement_pct: judged.length
    ? round((unanimous / judged.length) * 100)
    : null,
  contested_items: contestedItems,
  items,
  behavioural: {
    ...det,
    // Measured, never scored: how many load-bearing claims the deliverable
    // actually makes. A vague run and a precise one can score identically on
    // B2 (a ratio), so density needs its own column. No floor until the data
    // can justify one — measure first, score later, same as dup_search_pct.
    extracted_claims: median(
      rawPasses.map((r) => (r.price_claims || []).length),
    ),
  },
  raw_passes: rawPasses,
}

function round(x) {
  return x == null ? null : Math.round(x * 100) / 100
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify(grade, null, 1) + '\n')

console.log(
  `  total ${grade.score_total}/${available}` +
    ` (A ${grade.score_A_content}/${axisPoints.A}` +
    (hasB ? `, B ${grade.score_B_grounding}/${axisPoints.B}` : ', B n/a') +
    `, C ${grade.score_C_scope}/${axisPoints.C})`,
)
console.log(
  `  unanimity ${grade.judge_agreement_pct}%` +
    (contestedItems.length ? ` contested: ${contestedItems.join(',')}` : ''),
)
console.log(`  → ${path.relative(REPO, outPath)}`)
