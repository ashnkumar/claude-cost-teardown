#!/usr/bin/env node
/**
 * Generate experiments/results/SLIDE-TABLE.csv -- the flat one-row-per-cell
 * view the headline numbers are read off.
 *
 * SLIDE-TABLE.csv used to be maintained by hand, which broke the standing rule on
 * this project: every published figure is generated from the run artifacts and
 * traceable back to them. Hand maintenance is also how its quality columns sat on
 * "PENDING GRADER" after the grader had already run.
 *
 * Cost/behaviour come from results.csv (one row per run, itself generated from the
 * run artifacts). Quality comes from quality-<task>-cells.csv and is rendered
 * according to that file's own `render` verdict -- never as a bare number the
 * reader would take for a measured difference:
 *
 *   number        -> the signed index, e.g. "-6.8" (resolves against Fix 1)
 *   within-noise  -> "within noise (+-3.8)" -- the gap is smaller than the spread
 *                    between two runs of the SAME config, so it is not a result
 *   (no cell on the task resolves anything) -> "not resolved (n=N)"
 *
 * Rows are named for the STORY, not the cell id, because that is what goes on a
 * slide. Cells not listed here are still in results.csv; they are just not on a
 * slide. Anything listed that has no ok reps refuses rather than emitting a hole.
 *
 * Run:  node scripts/experiments/slide-table.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const RESULTS = path.join(ROOT, 'experiments/results')

// label -> t-dog cell. The compliance cell is the same name with the task prefix,
// which is how the harness writes those directories.
const ROWS = [
  ['No caching at all', 'off-append'],
  ['Built as-is (BASELINE)', 'naive-append'],
  ['FIX 1 - dynamic below convo', 'live-append'],
  ['Fix 1 + Opus 5 / low', 'live-append-effort-low'],
  ['Fix 1 + Sonnet 5 / high', 'live-append-sonnet'],
  ['Fix 1 + Sonnet 5 / low', 'live-append-sonnet-effort-low'],
  ['Fix 1 + drop old tool results', 'live-droptools'],
  ['Fix 1 + drop but keep last 2', 'live-droptools2'],
  ['Fix 1 + compact every 6', 'live-compact'],
  ['Fix 1 + fetch cap 8k', 'live-append-fetchcap8k'],
]
const BASELINE = 'naive-append'

function readCsv(f) {
  // The quality files are written by python's csv.writer, which emits CRLF. Left
  // in, the trailing \r rides on the LAST column of every row -- so `render`
  // silently compares as "number\r" and every cell reads unresolved.
  const text = fs.readFileSync(f, 'utf8').replace(/\r\n?/g, '\n')
  const [head, ...body] = text.trim().split('\n')
  const cols = splitCsv(head)
  return body.filter((l) => l.trim()).map((l) => {
    const v = splitCsv(l)
    if (v.length !== cols.length) {
      throw new Error(`${path.basename(f)}: ragged row (${v.length} vs `
        + `${cols.length} cols) -- refusing rather than dropping a treatment`)
    }
    return Object.fromEntries(cols.map((c, i) => [c, v[i]]))
  })
}

// Minimal RFC4180 split -- report_chars and the quality files are plain, but a
// label with a comma in it must not silently shift every column right of it.
function splitCsv(line) {
  const out = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out
}

const num = (v) => (v === '' || v == null ? null : Number(v))
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length
const f2 = (x) => (x == null ? '' : x.toFixed(2))
const f0 = (x) => (x == null ? '' : Math.round(x).toString())
const f1 = (x) => (x == null ? '' : x.toFixed(1))

const runs = readCsv(path.join(RESULTS, 'results.csv'))

function cellStats(taskId, cell) {
  const rows = runs.filter((r) => r.task_id === taskId && r.status === 'ok'
    && r.variant.replace(/^t-compliance:/, '') === cell)
  if (!rows.length) return null
  const costs = rows.map((r) => num(r.cost_usd_total)).filter((x) => x != null)
  if (!costs.length) throw new Error(`${taskId}/${cell}: ok reps with no cost`)
  // Average only the reps that HAVE the value. Coercing a missing field to 0 and
  // averaging it in silently drags the mean down: t-compliance
  // live-append-sonnet-effort-low/rep-13 is `ok` with an empty report_chars, and
  // treating it as zero reported 7,116 characters for a cell whose two measured
  // reps are 13,221 and 8,126.
  const meanOf = (key) => {
    const v = rows.map((r) => num(r[key])).filter((x) => x != null)
    return v.length ? mean(v) : null
  }
  return {
    n: rows.length,
    model: rows[0].model,
    effort: rows[0].effort,
    cost: mean(costs),
    lo: Math.min(...costs),
    hi: Math.max(...costs),
    latency: meanOf('wallclock_s'),
    searches: meanOf('searches'),
    fetches: meanOf('fetches'),
    chars: meanOf('report_chars'),
  }
}

/** Quality, rendered per the cells file's own verdict. */
function quality(taskId) {
  const suffix = taskId === 't-dog' ? 't-dog' : 't-compliance'
  const f = path.join(RESULTS, `quality-${suffix}-cells.csv`)
  if (!fs.existsSync(f)) return { get: () => 'NO GRADER OUTPUT' }
  const rows = readCsv(f)
  const byCell = new Map(rows.map((r) => [
    r.cell.replace(/^t-compliance-/, ''), r,
  ]))
  const floor = num(rows[0]?.noise_floor)
  // If nothing on this task clears the floor, the instrument did not resolve the
  // task -- which is a different statement from "no treatment changed quality",
  // and the two must not be allowed to read the same on a slide. Ten rows reading
  // "within noise" would be taken for demonstrated equivalence.
  //
  // Two guards on what counts as the instrument working here:
  //  - n>=2. A single rep cannot be separated from the noise it defines.
  //  - the cell has to be ON THE SLIDE. Compliance's only resolving cell is
  //    prefix-append at n=1, a deleted-halfmove treatment that never reaches a
  //    table -- it must not be what licenses "within noise" on the other thirteen.
  const onSlide = new Set(ROWS.map(([, c]) => c))
  const resolves = (r) => r.render === 'number' && (num(r.n) ?? 0) >= 2
  const anyResolved = rows.some((r) => resolves(r)
    && onSlide.has(r.cell.replace(/^t-compliance-/, '')))
  return {
    floor,
    anyResolved,
    get(cell) {
      const r = byCell.get(cell)
      if (!r) return ''
      if (!anyResolved) return `not resolved (n=${r.n})`
      if (r.render === 'number') {
        const v = num(r.vs_fix1)
        const sign = `${v > 0 ? '+' : ''}${f1(v)} vs Fix 1`
        return resolves(r) ? sign : `${sign} (n=${r.n}, provisional)`
      }
      return `within noise (+-${f1(floor)})`
    },
  }
}

const qDog = quality('t-dog')
const qCmp = quality('t-compliance')

const HEAD = ['Treatment', 'Model', 'Effort',
  'Dog $', 'Dog range', 'Dog vs base', 'Dog latency s', 'Dog searches',
  'Dog fetches', 'Dog report chars', 'Dog n', 'Dog quality',
  'Comp $', 'Comp range', 'Comp vs base', 'Comp latency s', 'Comp searches',
  'Comp fetches', 'Comp report chars', 'Comp n', 'Comp quality']

const base = {
  't-dog': cellStats('t-dog', BASELINE),
  't-compliance': cellStats('t-compliance', BASELINE),
}
for (const [t, b] of Object.entries(base)) {
  if (!b) throw new Error(`no ok reps for the baseline ${BASELINE} on ${t}`)
}

const lines = [HEAD.join(',')]
const missing = []
for (const [label, cell] of ROWS) {
  const d = cellStats('t-dog', cell)
  const c = cellStats('t-compliance', cell)
  if (!d && !c) { missing.push(cell); continue }
  const side = (s, taskId, q) => (s
    ? [f2(s.cost), `${f2(s.lo)}-${f2(s.hi)}`,
      `${f2(s.cost / base[taskId].cost)}x`,
      f0(s.latency), f1(s.searches), f1(s.fetches), f0(s.chars),
      String(s.n), q.get(cell)]
    : ['', '', '', '', '', '', '', '0', 'not run'])
  const shape = d ?? c
  lines.push([label, shape.model, shape.effort,
    ...side(d, 't-dog', qDog), ...side(c, 't-compliance', qCmp),
  ].map((v) => (String(v).includes(',') ? `"${v}"` : v)).join(','))
}
if (missing.length) {
  throw new Error(`no ok reps on either task for: ${missing.join(', ')}`
    + ' -- fix the row list rather than shipping a table with holes')
}

const out = path.join(RESULTS, 'SLIDE-TABLE.csv')
fs.writeFileSync(out, `${lines.join('\n')}\n`)
console.log(`wrote ${out}`)
console.log(`  ${ROWS.length} rows`)
console.log(`  dog quality:        floor +-${f1(qDog.floor)}, `
  + `${qDog.anyResolved ? 'some cells resolve' : 'NOTHING resolves'}`)
console.log(`  compliance quality: floor +-${f1(qCmp.floor)}, `
  + `${qCmp.anyResolved ? 'some cells resolve' : 'NOTHING resolves'}`)
