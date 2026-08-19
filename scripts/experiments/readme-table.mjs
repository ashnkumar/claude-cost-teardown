/**
 * Generates the README permutation tables from the results CSV.
 *
 *   node scripts/experiments/readme-table.mjs            # rewrite README
 *   node scripts/experiments/readme-table.mjs --stdout   # print, touch nothing
 *   node scripts/experiments/readme-table.mjs --check    # fail if stale
 *
 * No figure in the README is ever typed by hand. Every cell here is read out
 * of the CSV, so the published table is traceable to the runs that produced
 * it and the final regeneration is one command rather than an editing pass.
 *
 * Every column is self-describing: model, effort and the narrative status of
 * a treatment all travel with the row. Nothing is joined in from cells.mjs,
 * because the numbers may be aggregated by a script that never imported it —
 * and a label looked up separately from its number can drift from it.
 */
import fs from 'node:fs'
import path from 'node:path'
import { REPO } from './repo.mjs'
import { tokenCost, SEARCH_USD } from './rates.mjs'

const CSV = arg('csv', path.join(REPO, 'experiments/results/results.csv'))
// The README with the markers is `README.public.md` here and `README.md` in
// the public copy, which renames it. Default to whichever one exists so a
// bare invocation works in both trees; `--readme` still wins.
const DEFAULT_README = ['README.public.md', 'README.md']
  .map((n) => path.join(REPO, n))
  .find((p) => fs.existsSync(p)) ?? path.join(REPO, 'README.md')
const README = arg('readme', DEFAULT_README)
const LABELS = arg('labels', path.join(REPO, 'scripts/experiments/labels.json'))
const QDIR = arg('quality', path.join(REPO, 'experiments/results'))
const NO_QUALITY = process.argv.includes('--no-quality')

/**
 * What the quality column is measured against.
 *
 * The delta, the verdict that decides whether to print it, and the words in
 * the header all come from this one choice. They were separate once, and the
 * table published a number headed "vs as-built" whose right-to-exist had been
 * decided against Fix 1 — a cell inside the noise floor of the thing it
 * claimed to be compared to. Reading all three from one place is what makes
 * that unrepresentable rather than merely fixed.
 */
const ANCHORS = {
  baseline: {
    delta: 'vs_baseline', verdict: 'differs_from_baseline', label: 'as-built',
  },
  fix1: { delta: 'vs_fix1', verdict: 'differs_from_fix1', label: 'Fix 1' },
}
// Fix 1 is the default because it is what the README publishes: a reader
// already has Fix 1, so a delta against the as-built config describes a
// world nobody ships. Leaving the default on `baseline` meant every
// documented regenerate command silently rewrote the tables to the other
// anchor, which is a footgun the --check step would only catch afterwards.
const ANCHOR = ANCHORS[arg('anchor', 'fix1')]
if (!ANCHOR) {
  console.error(`--anchor must be one of: ${Object.keys(ANCHORS).join(', ')}`)
  process.exit(1)
}

/**
 * Which treatments a published table is allowed to contain. Rows carry their
 * own `narrative_status`, so this is a list of kinds rather than a list of
 * names — a treatment added later lands in the right table without touching
 * this file, and one nobody classified lands in none of them.
 */
const STATUSES = (arg('status', 'headline,fix3')).split(',').filter(Boolean)

/** Which task lands between which markers. */
const TABLES = [
  { marker: 'DOG', taskId: 't-dog' },
  { marker: 'COMPLIANCE', taskId: 't-compliance' },
]

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  const head = rows.shift()
  const ragged = rows.filter((r) => r.length && r.length !== head.length)
  if (ragged.length) {
    // Dropping malformed rows silently is how a table quietly loses a
    // treatment and still reads as complete.
    console.error(`Refusing to read a ragged CSV: ${ragged.length} row(s) ` +
      `do not have ${head.length} fields.`)
    process.exit(1)
  }
  return rows
    .filter((r) => r.length === head.length)
    .map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])))
}

const num = (v) => (v === '' || v == null ? null : Number(v))

/** A treatment's identity, with the task prefix the harness adds stripped. */
const canon = (v, taskId) => {
  for (const p of [`${taskId}:`, `${taskId}-`]) {
    if (v.startsWith(p)) return v.slice(p.length)
  }
  return v
}

const BUCKETS = [
  'cost_uncached_input', 'cost_cache_write', 'cost_cache_read',
  'cost_output', 'cost_search_fees',
]

const tokensOf = (r) => ({
  input: num(r.tokens_uncached_input) ?? 0,
  output: num(r.tokens_output) ?? 0,
  cacheWrite: num(r.tokens_cache_write) ?? 0,
  cacheRead: num(r.tokens_cache_read) ?? 0,
})

/**
 * What the run cost, whole.
 *
 * `cost_usd_total` already sums every record in the run's usage log, and a
 * compaction cell's summarizer goes through the same choke point as the
 * agent — so `summarizer_cost_usd` is a breakdown line of this figure, not
 * something to add to it. Adding it inflated the compaction rows 8-15%, and
 * compaction is the worst-performing tactic, so the error read as evidence.
 */
const runCost = (r) => num(r.cost_usd_total)

/**
 * A published number has to reconcile twice: against its own parts, and
 * against the tokens it claims to be pricing.
 *
 * The second check is the one that matters, and it is worth keeping now that
 * the aggregator prices each call at its own model's rate — this arrives at
 * the same figure by a different route, from the same raw tokens. Agreement
 * is evidence; disagreement means one of the two is wrong and we find out
 * before it is published rather than after.
 */
function reconcile(runs) {
  const bad = []
  for (const r of runs) {
    const total = runCost(r)
    const parts = BUCKETS.reduce((a, k) => a + (num(r[k]) ?? 0), 0)
    const t = tokensOf(r)
    const tokens = t.input + t.output + t.cacheWrite + t.cacheRead
    const where = `${r.run_id} (${r.variant}/${r.rep})`

    if (!r.model) {
      bad.push(`${where}: no model column — nothing to price it against.`)
      continue
    }
    // `observed_model` is read back off the billed usage records, so it says
    // what actually ran rather than what was configured to run. It can be
    // `a+b` where a summarizer routes through a different model.
    if (r.observed_model) {
      const seen = r.observed_model.split('+')
      if (!seen.includes(r.model)) {
        bad.push(`${where}: configured ${r.model} but the billed usage says ` +
          `${r.observed_model}.`)
        continue
      }
    }
    // Fewer usage lines than calls means tokens were billed that no line
    // accounts for. It is how a retried call and three server-tool continues
    // went uncosted, and it sums perfectly while being wrong — so it is
    // checked directly rather than left to the totals to reveal.
    const lines = num(r.usage_lines)
    const calls = num(r.api_calls)
    if (lines != null && calls != null && lines < calls &&
        (num(r.cost_recovered_usd) ?? 0) === 0) {
      bad.push(`${where}: ${calls} calls but only ${lines} usage lines, and ` +
        'nothing recovered — some billed tokens are uncosted.')
      continue
    }
    // A shortfall the aggregator could not attribute to a rate card is not a
    // number with error bars, it is an unknown. Publishing it would put a
    // guess in a table whose whole claim is traceability.
    if ((r.cost_recovered_usd || '').toUpperCase() === 'UNATTRIBUTED') {
      bad.push(`${where}: usage lines are short of the recorded call count ` +
        'and the gap could not be attributed to a model.')
      continue
    }
    if (r.cost_unpriced_models) {
      bad.push(`${where}: ${r.cost_unpriced_models} has no published rate, ` +
        'so part of this run is costed at nothing.')
      continue
    }
    if (!total && tokens > 0) {
      bad.push(`${where}: total $0.00 but ${tokens.toLocaleString('en-US')} ` +
        `tokens billed — the aggregator priced it at nothing.`)
      continue
    }
    if (Math.abs(total - parts) > Math.max(0.01, total * 0.02)) {
      bad.push(`${where}: total $${total.toFixed(4)} but the buckets sum ` +
        `to $${parts.toFixed(4)}.`)
      continue
    }

    const expected = tokenCost(r.model, t)
    if (expected == null) {
      bad.push(`${where}: no published rate for ${r.model}.`)
      continue
    }
    const withSearch = expected + (num(r.searches) ?? 0) * SEARCH_USD
    if (Math.abs(parts - withSearch) > Math.max(0.02, withSearch * 0.02)) {
      bad.push(`${where}: buckets say $${parts.toFixed(4)}, but ` +
        `${tokens.toLocaleString('en-US')} tokens at ${r.model} rates come to ` +
        `$${withSearch.toFixed(4)} — priced off the wrong card.`)
    }
  }
  return bad
}

/**
 * Per-cell quality verdicts, keyed by the same canonical treatment name the
 * cost rows use. Absent files are not an error — the cost table stands on
 * its own and the column renders as unmeasured.
 */
function loadQuality(taskId, published) {
  const file = path.join(QDIR, `quality-${taskId}-cells.csv`)
  if (NO_QUALITY || !fs.existsSync(file)) return null
  const rows = parseCsv(fs.readFileSync(file, 'utf8'))
  const byCell = new Map()
  for (const r of rows) byCell.set(canon(r.cell, taskId), r)
  const floors = [...new Set(rows.map((r) => r.noise_floor))]
  // Only cells that actually reach the table may speak for it. A withdrawn
  // treatment held back by --status once carried the whole compliance table
  // from "not resolved" to "no measurable change" on every row, on the
  // strength of one n=1 cell no reader could see.
  const shown = rows.filter((r) => published.includes(canon(r.cell, taskId)))
  return {
    byCell,
    floor: floors.length === 1 ? Number(floors[0]) : null,
    // If not one cell on this task clears the floor, the instrument did not
    // separate anything here. That is a different statement from "these
    // treatments are equivalent", and printing the latter would be a claim
    // the data does not support.
    resolves: shown.some((r) => r[ANCHOR.verdict] === 'True'),
    maxN: Math.max(0, ...shown.map((r) => num(r.n) ?? 0)),
  }
}

/**
 * The quality cell.
 *
 * `render` carries the verdict, so the decision of whether a gap is real has
 * already been made against that task's noise floor and is not re-litigated
 * here. Rendering a decimal for a cell the instrument cannot separate would
 * turn "no difference" into a small apparent one, which is the opposite of
 * the finding.
 */
function qualityCell(q, variant) {
  if (!q) return '—'
  const row = q.byCell.get(variant)
  if (!row) return '—'
  // That row's own n, not the table's best. One compliance cell lost a pair
  // and has two; printing the table-wide 3 against it claims a replicate
  // that was never judged.
  if (!q.resolves) return `not resolved at n=${num(row.n) ?? q.maxN}`
  if (row[ANCHOR.verdict] !== 'True') return 'no measurable change'
  const v = num(row[ANCHOR.delta])
  if (v == null) return '—'
  const sign = v > 0 ? '+' : v < 0 ? '−' : '±'
  return `${sign}${Math.abs(v).toFixed(1)}`
}

function stats(runs, key) {
  const get = typeof key === 'function' ? key : (r) => num(r[key])
  const xs = runs.map(get).filter((x) => x != null)
  if (!xs.length) return null
  const mean = xs.reduce((a, x) => a + x, 0) / xs.length
  return { mean, min: Math.min(...xs), max: Math.max(...xs), n: xs.length }
}

const money = (s) => s == null ? '—'
  : `$${s.mean.toFixed(2)}` +
    (s.n > 1 ? ` <sub>${s.min.toFixed(2)}–${s.max.toFixed(2)}</sub>` : '')
const round = (s, d = 0) => s == null ? '—' : s.mean.toFixed(d)
const unit = (s, d, suffix) => s == null ? '—' : s.mean.toFixed(d) + suffix
const count = (s) => s == null ? '—'
  : Math.round(s.mean).toLocaleString('en-US')

function table(rowsByVariant, variants, labels, specs, q) {
  const head =
    '| Treatment | Model | Effort | n | Cost | Latency | Searches | ' +
    `Fetches | Report | Quality vs ${ANCHOR.label} |\n` +
    '|---|---|---|---|---:|---:|---:|---:|---:|---:|'
  const lines = [head]
  for (const v of variants) {
    const runs = rowsByVariant.get(v) ?? []
    const s = specs.get(v) ?? {}
    lines.push([
      labels[v] ?? v,
      s.model ? s.model.replace('claude-', '') : '?',
      s.effort ?? '?',
      runs.length || '—',
      money(stats(runs, runCost)),
      // A blank cell in the CSV means the run did not record the value, not
      // that the value was zero. `stats` drops nulls, so a column that is
      // blank on some reps averages the reps that have it — and a column
      // blank on all of them is an em-dash, never a confident 0.
      unit(stats(runs, 'wallclock_s'), 0, 's'),
      round(stats(runs, 'searches'), 1),
      round(stats(runs, 'fetches'), 1),
      count(stats(runs, 'report_chars')),
      runs.length ? qualityCell(q, v) : '—',
    ].join(' | ').replace(/^/, '| ') + ' |')
  }
  // The floor is what makes "no measurable change" a measurement rather than
  // a shrug, so it is generated with the table it qualifies.
  if (q?.floor != null) {
    const floor = `Quality is a signed margin vs the ${ANCHOR.label} cell: ` +
      `every report was judged head-to-head against the same fixed as-built ` +
      `reference run, four dimensions at ±2 each, and cell means were rebased ` +
      `so ${ANCHOR.label} sits at zero — a rebased margin can land outside ±8. ` +
      `The mean spread between replicates of the *same* configuration is ` +
      `${q.floor.toFixed(2)} index points on this task`
    // The unresolved note is deliberately short: it sits under the second
    // table, where repeating the whole instrument description verbatim buys
    // nothing. Only what is specific to this task stays.
    lines.push('')
    lines.push('<sub>' + (q.resolves
      ? `${floor}, so any smaller gap is reported as no measurable change ` +
        `rather than as a number.</sub>`
      : `Same instrument and rebasing as the first table. The mean spread ` +
        `between replicates of the *same* configuration is ` +
        `${q.floor.toFixed(2)} index points here, and no treatment separated ` +
        `from any other by more than that — so quality is not reported for ` +
        `this task. The instrument did not resolve it, which is not the same ` +
        `as the treatments being equivalent.</sub>`))
  }
  return lines.join('\n')
}

/** Model and effort per treatment, gathered across both tasks. */
function specsOf(runs) {
  const out = new Map()
  for (const r of runs) {
    const seen = out.get(r.variant)
    if (!seen) { out.set(r.variant, { model: r.model, effort: r.effort }); continue }
    if (seen.model !== r.model || seen.effort !== r.effort) {
      console.error(`note: ${r.variant} has rows at ${seen.model}/` +
        `${seen.effort} and ${r.model}/${r.effort} — one treatment, two ` +
        'configurations. The label shows the first.')
    }
  }
  return out
}

function main() {
  if (!fs.existsSync(CSV)) {
    console.error(`No results CSV at ${CSV}. ` +
      'Run `node scripts/experiments/aggregate.mjs` first.')
    process.exit(1)
  }
  const all = parseCsv(fs.readFileSync(CSV, 'utf8'))
  let ok = all.filter((r) => r.status === 'ok')

  // A run on the compliance task records its variant as `t-compliance:live-
  // append`. Same treatment, different string, so the two tables would share
  // no rows at all — and the whole point is to read them side by side.
  for (const r of ok) r.variant = canon(r.variant, r.task_id)

  if (!ok.length) {
    console.error('No ok rows in the CSV.')
    process.exit(1)
  }
  if (!('narrative_status' in ok[0])) {
    console.error('CSV has no narrative_status column — cannot tell a ' +
      'headline treatment from a deleted one. Regenerate it.')
    process.exit(1)
  }

  // An unclassified treatment is not a headline treatment that lost its
  // label; it is one nobody has decided about yet. Publishing it by default
  // is how a deleted experiment ends up in the table.
  const unclassified = [...new Set(ok
    .filter((r) => !r.narrative_status || r.narrative_status === 'unclassified')
    .map((r) => r.variant))]
  if (unclassified.length) {
    console.error('Refusing to publish — unclassified treatment(s): ' +
      unclassified.join(', ') +
      '\nClassify them in the aggregator, or name their status via --status.')
    process.exit(1)
  }

  // Dropping a treatment is allowed; dropping it quietly is not. A table that
  // silently omits rows reads as "this is everything we ran".
  const dropped = new Map()
  for (const r of ok) {
    if (STATUSES.includes(r.narrative_status)) continue
    if (!dropped.has(r.narrative_status)) dropped.set(r.narrative_status, new Set())
    dropped.get(r.narrative_status).add(r.variant)
  }
  ok = ok.filter((r) => STATUSES.includes(r.narrative_status))
  for (const [status, vs] of dropped) {
    console.error(`note: held back ${vs.size} ${status} treatment(s) — ` +
      [...vs].join(', '))
  }
  if (!ok.length) {
    console.error(`No rows left after keeping only: ${STATUSES.join(', ')}.`)
    process.exit(1)
  }

  const problems = reconcile(ok)
  if (problems.length) {
    console.error('Refusing to publish — these rows do not reconcile:\n')
    for (const p of problems) console.error('  ' + p)
    console.error(
      '\nEvery figure in the README has to be traceable to the CSV. Fix the ' +
      'aggregator, regenerate, and run this again.')
    process.exit(1)
  }

  const specs = specsOf(ok)
  const labels = JSON.parse(fs.readFileSync(LABELS, 'utf8'))
  // One row set for both tables, so the two are read side by side. A cell
  // with no runs for a task shows as em-dash rather than vanishing.
  // Ordered by the first table's task, so the primary table reads top to
  // bottom as most expensive to least and the second keeps its rows aligned.
  const rank = (v) => {
    const rows = ok.filter((r) => r.variant === v)
    const primary = stats(rows.filter((r) => r.task_id === TABLES[0].taskId),
      runCost)
    return -(primary ?? stats(rows, runCost) ?? { mean: 0 }).mean
  }
  const variants = [...new Set(ok.map((r) => r.variant))]
    .sort((a, b) => rank(a) - rank(b))

  let readme = fs.existsSync(README) ? fs.readFileSync(README, 'utf8') : ''
  const missing = []

  for (const { marker, taskId } of TABLES) {
    const rows = ok.filter((r) => r.task_id === taskId)
    const byVariant = new Map()
    for (const r of rows) {
      if (!byVariant.has(r.variant)) byVariant.set(r.variant, [])
      byVariant.get(r.variant).push(r)
    }
    for (const v of variants) {
      if (!byVariant.has(v)) missing.push(`${marker}: no runs for ${v}`)
    }

    const q = loadQuality(taskId, variants)
    if (!q) console.error(`note: ${marker}: no quality file, column blank.`)
    const body = table(byVariant, variants, labels, specs, q)
    const open = `<!-- TABLE:${marker} -->`
    const close = `<!-- /TABLE:${marker} -->`

    if (process.argv.includes('--stdout')) {
      console.log(`\n${open}\n${body}\n${close}`)
      continue
    }
    const from = readme.indexOf(open)
    const to = readme.indexOf(close)
    if (from === -1 || to === -1) {
      console.error(`README has no ${open} … ${close} pair. Add the markers.`)
      process.exit(1)
    }
    readme = readme.slice(0, from + open.length) + '\n' + body + '\n' +
      readme.slice(to)
  }

  // A gap is a fact about the campaign, not something to paper over.
  for (const m of missing) console.error('note: ' + m)

  // A corrected figure is still a figure, but it should never arrive silently.
  const fixed = ok.filter((r) => (num(r.cost_recovered_usd) ?? 0) > 0)
  for (const r of fixed) {
    console.error(`note: ${r.variant}/${r.rep} publishes a recovered cost — ` +
      `$${num(r.cost_recovered_usd).toFixed(4)} of billed tokens had no ` +
      'usage line of their own.')
  }

  if (process.argv.includes('--stdout')) return
  if (process.argv.includes('--check')) {
    const current = fs.readFileSync(README, 'utf8')
    if (current !== readme) {
      console.error('README tables are stale. Run without --check to rewrite.')
      process.exit(1)
    }
    console.log('README tables are current.')
    return
  }
  fs.writeFileSync(README, readme)
  console.log(`Wrote ${TABLES.length} tables to ${path.relative(REPO, README)}`)
}

main()
