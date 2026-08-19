// Fold every rep's result.json (+ grade.json when the grader has run) into
// the deliverables: results.csv (one row PER RUN — variance stays visible),
// results.md (per-variant mean and min–max), and the three chart CSVs.
// Cost is decomposed by token bucket — the thing the treatment actually
// manipulates; total $ is always shown next to search/fetch counts.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CELLS } from './cells.mjs'

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..',
)
const EXP = path.join(REPO, 'experiments')
const OUT = path.join(EXP, 'results')

// in, out, cacheWrite, cacheRead — $/1M tokens, LIST price. Same table and same
// deliberate choice of list-over-promo as run-cell.mjs: Sonnet 5's introductory
// $2/$10 expires 2026-08-31 and a cost claim that expires in three weeks is not
// a claim worth publishing.
//
// This table used to hold opus alone, and every cost in results.csv was computed
// at opus rates regardless of which model the run actually used. Sonnet runs came
// out with opus-priced buckets and a $0.00 total -- the total because run-cell.mjs
// wrote `cost_usd: 0` into the manifest at run time, from a RATES table that did
// not yet have sonnet in it, and `RATES[model] ?? [0,0,0,0]` fails silently to
// zero. Both halves of that are fixed here by recomputing from the persisted
// per-call usage instead of trusting either the run-time total or a single global
// model.
const RATES = {
  'claude-opus-5': [5, 25, 6.25, 0.5],
  'claude-sonnet-5': [3, 15, 3.75, 0.3],
  'claude-haiku-4-5': [1, 5, 1.25, 0.1],
}
const SEARCH_USD = 10 / 1000

/**
 * Recompute a run's cost from usage.jsonl, pricing EVERY CALL at its own model.
 *
 * This is the authoritative cost path. A run is not necessarily single-model:
 * the compact cells route a summarizer call through the same choke point, and
 * that call can be a different model than the agent's.
 *
 * Returns null when there is no usage.jsonl, so the caller can fall back and
 * say so rather than silently reporting zero.
 */
function costFromUsage(dir) {
  const f = path.join(dir, 'usage.jsonl')
  if (!fs.existsSync(f)) return null
  const out = {
    input: 0, write: 0, read: 0, output: 0, search: 0,
    models: new Set(), unpriced: new Set(), calls: 0, errors: 0,
    // raw token sums, kept so the caller can reconcile them against
    // result.json's in-memory totals -- see retryShortfall()
    tok: { input: 0, output: 0, write: 0, read: 0, search: 0 },
  }
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let rec
    try { rec = JSON.parse(line) } catch { continue }
    // Token counts sit at the TOP LEVEL of a usage.jsonl record, not nested
    // under `usage`. Accept a nested shape too so a future writer change cannot
    // silently zero every cost in the table -- which is exactly the failure mode
    // this function exists to fix.
    const u = rec.usage ?? rec
    const model = rec.model ?? 'unknown'
    const rate = RATES[model]
    out.models.add(model)
    out.calls++
    if (rec.status === 'error') out.errors++
    const searches = u.web_search_requests
      ?? u.server_tool_use?.web_search_requests ?? 0
    out.tok.input += u.input_tokens ?? 0
    out.tok.output += u.output_tokens ?? 0
    out.tok.write += u.cache_creation_input_tokens ?? 0
    out.tok.read += u.cache_read_input_tokens ?? 0
    out.tok.search += searches
    if (!rate) { out.unpriced.add(model); continue }
    const [inR, outR, cwR, crR] = rate
    out.input += (u.input_tokens ?? 0) * inR / 1e6
    out.output += (u.output_tokens ?? 0) * outR / 1e6
    out.write += (u.cache_creation_input_tokens ?? 0) * cwR / 1e6
    out.read += (u.cache_read_input_tokens ?? 0) * crR / 1e6
    out.search += searches * SEARCH_USD
  }
  out.total = out.input + out.write + out.read + out.output + out.search
  // A run that billed nothing across every call is not a cheap run, it is a
  // parsing failure. Refuse to report it as a measurement.
  if (out.calls > 0 && out.total === 0) {
    throw new Error(`costFromUsage: ${out.calls} calls priced to $0.00 in ${dir}`
      + ` -- token fields did not parse (models: ${[...out.models].join(',')})`)
  }
  return out
}

/**
 * Reconcile the per-call sum against result.json's in-memory totals.
 *
 * usage.jsonl is not guaranteed to hold one complete line per call, and two
 * distinct ways of losing one were found in the corpus:
 *
 *  - `live-droptools2/rep-22` -- a call errored after 150s and was retried inside
 *    callClaude, but only ONE line is written per request slot and it recorded the
 *    FAILED attempt (all four token fields zero, `status:"error"`). The retry's
 *    tokens reached the accumulator and nothing else.
 *  - `fullvol-append/rep-3` -- `api_calls` is 15 against 12 lines, every one `ok`.
 *    Three server-tool continues never got a line at all.
 *
 * In both cases result.json's totals are the complete record, so treat a positive
 * shortfall as real usage that the writer dropped and price it. Measured, not
 * estimated: those tokens came off real API responses.
 *
 * Attribution needs one rate card, so a multi-model run (the compact cells route
 * a summarizer through the same choke point) is flagged and left alone rather
 * than guessed at.
 *
 * Returns null when the two agree, which is 101 of 103 rows.
 */
function usageShortfall(U, T) {
  if (!U) return null
  const short = {
    input: (T.input_tokens ?? 0) - U.tok.input,
    output: (T.output_tokens ?? 0) - U.tok.output,
    write: (T.cache_creation_input_tokens ?? 0) - U.tok.write,
    read: (T.cache_read_input_tokens ?? 0) - U.tok.read,
    search: (T.web_search_requests ?? 0) - U.tok.search,
  }
  if (!Object.values(short).some((v) => v > 0)) return null
  const priced = [...U.models].filter((m) => RATES[m])
  if (priced.length !== 1) return { short, usd: null, models: priced }
  const [inR, outR, cwR, crR] = RATES[priced[0]]
  const pos = (v) => Math.max(0, v)
  const usd = {
    input: pos(short.input) * inR / 1e6,
    output: pos(short.output) * outR / 1e6,
    write: pos(short.write) * cwR / 1e6,
    read: pos(short.read) * crR / 1e6,
    search: pos(short.search) * SEARCH_USD,
  }
  usd.total = usd.input + usd.output + usd.write + usd.read + usd.search
  return { short, usd, models: priced }
}

function loadRuns() {
  const runs = []
  // Scan cell dirs on disk: bare names are t-dog; task-prefixed dirs
  // (e.g. t-compliance-off-append) belong to other tasks.
  const dirs = fs.readdirSync(EXP).filter((d) =>
    d !== 'results' && !d.endsWith('.jsonl') &&
    fs.statSync(path.join(EXP, d)).isDirectory())
  for (const dirName of dirs) {
    const cellDir = path.join(EXP, dirName)
    for (const rep of fs.readdirSync(cellDir).sort()) {
      const dir = path.join(cellDir, rep)
      const resultFile = path.join(dir, 'result.json')
      if (!fs.existsSync(resultFile)) continue
      const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'))
      if (result.dry_run) continue
      const gradeFile = path.join(dir, 'grade.json')
      const grade = fs.existsSync(gradeFile)
        ? JSON.parse(fs.readFileSync(gradeFile, 'utf8'))
        : null
      let tree = result.final_task_tree
      if (!tree) {
        const snap = path.join(dir, 'tasks-snapshot.json')
        if (fs.existsSync(snap)) {
          const db = JSON.parse(fs.readFileSync(snap, 'utf8'))
          const t = db.tasks.find((x) => x.id === result.task_id)
          if (t) {
            tree = {
              ...t,
              subtasks: db.tasks.filter((x) => x.parentId === t.id),
            }
          }
        }
      }
      // canonical cell name comes from result.json; grouping key carries
      // the task so cross-task cells never merge
      const cell = result.cell ?? dirName
      const variant = result.task_id === 't-dog'
        ? cell : `${result.task_id}:${cell}`
      runs.push({ cell, variant, rep, dir, result, grade, tree })
    }
  }
  assertOneRubric(runs)
  return runs
}

/**
 * Scores from two rubric versions are not comparable, and a table that mixes
 * them looks fine right up until someone reads a variant difference that is
 * really a rubric difference. Refuse rather than warn.
 *
 * Scoped per task: t-dog and t-compliance run different rubrics by design, so
 * the invariant is one rubric per task, not one rubric overall.
 */
function assertOneRubric(runs) {
  const byTask = new Map()
  for (const r of runs) {
    if (!r.grade) continue
    const task = r.grade.task_id ?? r.result.task_id ?? 'unknown'
    const key = `${r.grade.rubric_version}@${r.grade.rubric_sha256}`
    if (!byTask.has(task)) byTask.set(task, new Map())
    const seen = byTask.get(task)
    if (!seen.has(key)) seen.set(key, [])
    seen.get(key).push(`${r.cell}/${r.rep}`)
  }
  let bad = false
  for (const [task, seen] of byTask) {
    if (seen.size <= 1) continue
    bad = true
    console.error(`${task}: graded reps span more than one rubric —`)
    for (const [key, where] of seen) {
      console.error(`  ${key}\n    ${where.join(', ')}`)
    }
  }
  if (bad) process.exit(4)
}

const r4 = (x) => (x == null ? null : Math.round(x * 1e4) / 1e4)

// The app's own defaults. A cell that does not override these ran as shipped.
const DEFAULT_MODEL = 'claude-opus-5'
const DEFAULT_EFFORT = 'high'

/**
 * Which story a row belongs to, so downstream tooling never has to maintain its
 * own exclude list against a taxonomy that lives here.
 *
 *   headline          the six-row staircase in FINDINGS-REPORT-DRAFT.md
 *   fix3              context-engineering tactics measured on top of fix 1
 *   deleted-halfmove  prefix-*: cached the static block but left the volatile
 *                     block above the conversation. Superseded and cut.
 *   deleted-trap      fullvol-*: both fixes applied but composed wrong, so the
 *                     churn still killed the conversation span. Cut.
 *   superseded        full-*: the earlier naming of the correct composition,
 *                     kept as evidence but not a headline row.
 *   excluded-lineage  *-window: sliding-window trimming drops a web_search a
 *                     later web_fetch depends on, so most runs 400. Excluded as
 *                     a RESULT, not a gap.
 *
 * Anything unrecognised returns 'unclassified' rather than a guess -- a new cell
 * should show up as unlabelled, not get silently published as headline.
 */
const HEADLINE = new Set([
  'off-append', 'naive-append', 'live-append',
  'live-append-effort-low', 'live-append-effort-medium',
  'live-append-sonnet', 'live-append-sonnet-effort-low',
  'live-append-sonnet-effort-medium',
])
const FIX3 = new Set([
  'live-droptools', 'live-droptools2', 'live-compact',
  'live-append-fetchcap8k',
])

function narrativeStatus(cell) {
  const c = cell.replace(/^t-compliance-/, '')
  if (c.endsWith('-window')) return 'excluded-lineage'
  if (c.startsWith('prefix-')) return 'deleted-halfmove'
  if (c.startsWith('fullvol-')) return 'deleted-trap'
  if (HEADLINE.has(c)) return 'headline'
  if (FIX3.has(c)) return 'fix3'
  if (c.startsWith('full-')) return 'superseded'
  return 'unclassified'
}

const medianOf = (xs) => {
  const v = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b)
  if (!v.length) return null
  const m = v.length >> 1
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

function row(run, order) {
  const { result: R, grade: G, tree } = run
  const T = R.totals ?? {}
  // grade.json spells it "behavioural" and names the subscores per the spec's
  // results.csv columns; accept either spelling so a future rename can't
  // silently empty six columns again.
  const B = G?.behavioural ?? G?.behavioral ?? {}
  // Per-call, per-model recompute is authoritative. Fall back to the run-time
  // total only when usage.jsonl is absent, and mark the row so nobody mistakes a
  // fallback for a measurement.
  const U = costFromUsage(run.dir)
  const cost = U ?? {
    input: 0, write: 0, read: 0, output: 0, search: 0,
    total: T.cost_usd ?? T.computed_cost_usd ?? null,
  }
  // Add back usage the per-call writer dropped. Without this the row
  // under-reports, and the CSV's own token columns (which come from the totals)
  // do not reconcile against its cost buckets.
  const RS = usageShortfall(U, T)
  if (RS?.usd) {
    cost.input += RS.usd.input
    cost.output += RS.usd.output
    cost.write += RS.usd.write
    cost.read += RS.usd.read
    cost.search += RS.usd.search
    cost.total += RS.usd.total
  }
  const subtasks = tree?.subtasks ?? []
  return {
    run_id: R.run_id, variant: run.variant, rep: run.rep,
    task_id: R.task_id, order_index: order,
    // model and effort travel WITH the number so the table is self-describing
    // and nobody has to join against a config the reader cannot see. Taken from
    // result.json's own config snapshot, which is what the run actually used --
    // not from cells.mjs, which can drift after the fact.
    model: R.config?.model ?? DEFAULT_MODEL,
    effort: R.config?.effort ?? DEFAULT_EFFORT,
    // observed_model is what the API was actually asked for, read back off the
    // billed usage records. If it ever disagrees with `model`, trust this one and
    // treat the row as suspect.
    observed_model: U && U.models.size ? [...U.models].sort().join('+') : null,
    narrative_status: narrativeStatus(run.cell),
    started_at: R.started_at, status: R.status,
    stop_reason: R.stop_reason,
    score_total: G?.score_total ?? null,
    score_A: G?.score_A_content ?? G?.score_A ?? null,
    score_B: G?.score_B_grounding ?? G?.score_B ?? null,
    score_C: G?.score_C_scope ?? G?.score_C ?? null,
    contested_items: G?.contested_items ?? null,
    judge_agreement_pct: G?.judge_agreement_pct ?? null,
    // cost_usd_total ALREADY INCLUDES the summarizer's own calls: it is the sum
    // over every record in usage.jsonl, and the compact cells route their
    // summarizer through the same choke point, so those calls are in there.
    // summarizer_cost_usd below is a BREAKDOWN of this total, not an addend --
    // adding it back double-counts and inflates compaction by 8-15%.
    cost_usd_total: r4(cost.total),
    cost_source: U
      ? (RS?.usd ? 'usage.jsonl+recovered' : 'usage.jsonl')
      : 'manifest-fallback',
    // true when the per-call sum and the run's own totals agree, i.e. every call
    // got a complete usage line. False is a flag, not a refusal: the shortfall is
    // priced above when the run is single-model, and left UNATTRIBUTED when not.
    cost_reconciles: RS === null,
    cost_recovered_usd: RS?.usd ? r4(RS.usd.total) : (RS ? 'UNATTRIBUTED' : 0),
    // api_calls (from the totals) vs usage_lines (what got written) localises the
    // loss: unequal means whole lines vanished; equal with an error line means a
    // retry was overwritten.
    usage_lines: U ? U.calls : null,
    usage_error_lines: U ? U.errors : null,
    cost_models: U ? [...U.models].sort().join('+') : null,
    cost_unpriced_models: U && U.unpriced.size ? [...U.unpriced].join('+') : null,
    cost_usd_runtime: r4(T.cost_usd ?? T.computed_cost_usd),
    cost_uncached_input: r4(cost.input),
    cost_cache_write: r4(cost.write),
    cost_cache_read: r4(cost.read),
    cost_output: r4(cost.output),
    cost_search_fees: r4(cost.search),
    summarizer_cost_usd: r4(T.summarizer_cost_usd ?? 0),
    tokens_uncached_input: T.input_tokens ?? null,
    tokens_cache_write: T.cache_creation_input_tokens ?? null,
    tokens_cache_read: T.cache_read_input_tokens ?? null,
    tokens_output: T.output_tokens ?? null,
    api_calls: T.api_calls ?? null,
    summarizer_calls: T.summarizer_calls ?? 0,
    turns: R.turns,
    searches: T.web_search_requests ?? null,
    dup_search_pct: B.dup_search_pct ?? null,
    fetches: T.web_fetch_requests ?? null,
    wasted_fetch_pct: B.wasted_fetch_pct ?? null,
    cited_sources: tree?.report?.sources?.length ?? null,
    cited_unfetched_ratio: B.cited_unfetched_ratio ?? null,
    subtasks_created: R.behavior?.subtasks_created ?? null,
    recreated_subtasks: B.recreated_subtasks ?? null,
    update_task_noops: B.update_task_noops ?? null,
    re_research_events: B.re_research_after_close ?? null,
    // Both measured, never scored. Derived here rather than read straight off
    // grade.json so grades written before these columns existed still report
    // them — no re-grading needed to backfill an unscored measure.
    abandoned_subtasks: B.abandoned_subtasks ??
      (subtasks.length
        ? subtasks.filter(
          (s) => s.assignee === 'agent' && s.status === 'not_started').length
        : null),
    extracted_claims: B.extracted_claims ?? medianOf(
      (G?.raw_passes ?? []).map((r) => (r.price_claims ?? []).length)),
    human_subtasks:
      subtasks.filter((s) => s.assignee === 'human').length || null,
    report_chars: tree?.report?.markdown?.length ?? null,
    wallclock_s: R.wall_ms != null ? Math.round(R.wall_ms / 1000) : null,
    completed:
      R.status === 'ok' && R.stop_reason === 'end_turn' &&
      !!tree?.report,
    prefix_clean_append: R.prefix_diff?.clean_append ?? null,
    prefix_cache_busting: R.prefix_diff?.cache_busting ?? null,
    cache_hit_call1: R.cache_hit_call1 ?? null,
    seed_check_ok: R.seed_check_ok ?? null,
  }
}

const csv = (rows) => {
  const cols = Object.keys(rows[0])
  const esc = (v) =>
    v == null ? '' : /[",\n]/.test(String(v))
      ? `"${String(v).replaceAll('"', '""')}"` : String(v)
  return [cols.join(','),
    ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n'
}

const mean = (xs) => xs.length
  ? xs.reduce((a, b) => a + b, 0) / xs.length : null
const fmt = (x, d = 2) => (x == null ? '—' : x.toFixed(d))

function main() {
  const runs = loadRuns()
  if (!runs.length) throw new Error('no runs found under experiments/')
  runs.sort((a, b) =>
    (a.result.started_at ?? '').localeCompare(b.result.started_at ?? ''))
  const rows = runs.map((r, i) => row(r, i + 1))
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, 'results.csv'), csv(rows))

  // per-variant aggregation, in CELLS order.
  //
  // A crashed run stops mid-conversation, so its cost is a partial bill and
  // its score is null. Averaging that against completed runs reads as "this
  // variant was cheap" when it actually means "this variant died" — so every
  // statistic below is computed over status=='ok' runs only. results.csv
  // still carries every run (it has a status column); the aggregate keeps a
  // `failed` count so the drops are visible rather than silent, and a variant
  // whose runs ALL failed still gets a row — that outcome is a result.
  const byVariantAll = new Map()
  const byVariant = new Map()
  for (const r of rows) {
    if (!byVariantAll.has(r.variant)) {
      byVariantAll.set(r.variant, [])
      byVariant.set(r.variant, [])
    }
    byVariantAll.get(r.variant).push(r)
    if (r.status === 'ok') byVariant.get(r.variant).push(r)
  }
  // t-dog cells in matrix order first, then other tasks' variants sorted
  const variants = [
    ...Object.keys(CELLS).filter((c) => byVariantAll.has(c)),
    ...[...byVariantAll.keys()].filter((v) => v.includes(':')).sort(),
  ]
  // CSVs feed charts, so an all-null row would plot as zero — drop those
  // variants there, but say so out loud.
  const charted = variants.filter((v) => byVariant.get(v).length)
  for (const v of variants) {
    if (!byVariant.get(v).length) {
      console.error(
        `note: ${v} has 0 ok runs (${byVariantAll.get(v).length} failed) — ` +
        'listed in results.md, omitted from the chart CSVs')
    }
  }

  const md = ['# Delegate Cost Lab — results', '',
    `${rows.length} runs · generated ${new Date().toISOString()}`, '',
    'Every statistic below is over `status == ok` runs only — a crashed run ' +
    'bills a partial\nconversation and scores null, so averaging it in reads ' +
    'as cheapness. The `failed`\ncolumn keeps those runs visible.', '',
    '| variant | n | failed | $ total | uncached | cache W | cache R | ' +
    'output | score | searches | fetches | calls | completed |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|']
  for (const v of variants) {
    const g = byVariant.get(v)
    const nFailed = byVariantAll.get(v).length - g.length
    if (!g.length) {
      md.push(`| ${v} | 0 | ${nFailed} | — | — | — | — | — | — | — | — | ` +
        '— | 0/0 |')
      continue
    }
    const m = (f) => mean(g.map((x) => x[f]).filter((x) => x != null))
    const range = (f) => {
      const xs = g.map((x) => x[f]).filter((x) => x != null)
      return xs.length > 1
        ? ` (${Math.min(...xs).toFixed(2)}–${Math.max(...xs).toFixed(2)})` : ''
    }
    md.push(
      `| ${v} | ${g.length} | ${nFailed} | $${fmt(m('cost_usd_total'))}` +
      `${range('cost_usd_total')} | $${fmt(m('cost_uncached_input'))} | ` +
      `$${fmt(m('cost_cache_write'))} | $${fmt(m('cost_cache_read'))} | ` +
      `$${fmt(m('cost_output'))} | ${fmt(m('score_total'), 1)} | ` +
      `${fmt(m('searches'), 1)} | ${fmt(m('fetches'), 1)} | ` +
      `${fmt(m('api_calls'), 1)} | ` +
      `${g.filter((x) => x.completed).length}/${g.length} |`,
    )
  }
  fs.writeFileSync(path.join(OUT, 'results.md'), md.join('\n') + '\n')

  const stacked = [['variant', 'uncached_input', 'cache_write', 'cache_read',
    'output', 'search_fees', 'summarizer'].join(',')]
  for (const v of charted) {
    const g = byVariant.get(v)
    const m = (f) => fmt(mean(g.map((x) => x[f]).filter((x) => x != null)), 4)
    stacked.push([v, m('cost_uncached_input'), m('cost_cache_write'),
      m('cost_cache_read'), m('cost_output'), m('cost_search_fees'),
      m('summarizer_cost_usd')].join(','))
  }
  fs.writeFileSync(path.join(OUT, 'cost_stacked.csv'),
    stacked.join('\n') + '\n')

  const okRows = rows.filter((r) => r.status === 'ok')
  fs.writeFileSync(path.join(OUT, 'cost_quality.csv'), csv(okRows.map((r) => ({
    run_id: r.run_id, variant: r.variant, rep: r.rep,
    cost_usd_total: r.cost_usd_total, score_total: r.score_total,
    completed: r.completed,
  }))))

  fs.writeFileSync(path.join(OUT, 'symptoms.csv'), csv(charted.map((v) => {
    const g = byVariant.get(v)
    const m = (f) => r4(mean(g.map((x) => x[f]).filter((x) => x != null)))
    return {
      variant: v, dup_search_pct: m('dup_search_pct'),
      wasted_fetch_pct: m('wasted_fetch_pct'),
      cited_unfetched_ratio: m('cited_unfetched_ratio'),
      re_research_events: m('re_research_events'),
      recreated_subtasks: m('recreated_subtasks'),
      update_task_noops: m('update_task_noops'),
      abandoned_subtasks: m('abandoned_subtasks'),
      extracted_claims: m('extracted_claims'),
    }
  })))

  console.log(`aggregated ${rows.length} runs -> experiments/results/`)
  const head = md.findIndex((l) => l.startsWith('| variant'))
  console.log(md.slice(head).join('\n'))
}

main()
