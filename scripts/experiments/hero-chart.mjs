// The lab chart: every variant's bill as stacked buckets, quality dots on a
// right axis, dead runs marked dead. Reads experiments/results/results.csv —
// numbers flow from data to pixels by script, never by hand.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..',
)
const OUT = path.join(REPO, 'experiments', 'results')

/**
 * RFC4180-ish: fields may be quoted, quoted fields may contain commas,
 * newlines and doubled quotes. A naive split() used to be "fine here" — it
 * stopped being fine the moment a failed run wrote an API error string
 * (commas AND quotes) into the row, which silently shifted every later column
 * and put a $90 cost on a $2.30 cell. Parse it properly.
 */
function parseCsv(text) {
  const rows = []
  let row = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows
}

function readCsv(file) {
  const rows = parseCsv(fs.readFileSync(file, 'utf8').trim())
  const cols = rows.shift()
  return rows.map((vals) =>
    Object.fromEntries(cols.map((c, i) => [c, vals[i]])))
}

const ORDER = [
  'off-append', 'naive-append', 'prefix-append', 'fullvol-append',
  'full-append', 'live-append',
  'full-append-fetchcap', 'full-append-fetchcap8k',
  'prefix-window', 'full-window',
  'prefix-droptools', 'full-droptools', 'full-droptools2',
  'prefix-compact', 'full-compact',
]
const LABELS = {
  'off-append': ['caching', 'off'],
  'naive-append': ['as built', '(baseline)'],
  'prefix-append': ['fix 1', 'prefix'],
  'fullvol-append': ['fix 1+2', 'naive mix'],
  'full-append': ['fix 1+2', 'correct'],
  'live-append': ['live ctx', 'appended'],
  'full-append-fetchcap': ['+ fetch', 'cap 25k'],
  'full-append-fetchcap8k': ['+ fetch', 'cap 8k'],
  'prefix-window': ['window', 'no conv $'],
  'full-window': ['window', 'conv $'],
  'prefix-droptools': ['droptools', 'no conv $'],
  'full-droptools': ['droptools', 'conv $'],
  'full-droptools2': ['droptools2', 'conv $'],
  'prefix-compact': ['compact', 'no conv $'],
  'full-compact': ['compact', 'conv $'],
}
const BUCKETS = [
  ['cost_uncached_input', '#c4643c', 'uncached input'],
  ['cost_cache_write', '#dba642', 'cache write'],
  ['cost_output', '#6b7f9e', 'output'],
  ['cost_cache_read', '#4a8a6f', 'cache read'],
  ['cost_search_fees', '#8a7ca8', 'search fees'],
  ['summarizer_cost_usd', '#b06a8f', 'summarizer'],
]

const rows = readCsv(path.join(OUT, 'results.csv'))
const byVariant = new Map()
for (const r of rows) {
  if (!byVariant.has(r.variant)) byVariant.set(r.variant, [])
  byVariant.get(r.variant).push(r)
}
const variants = ORDER.filter((v) => byVariant.has(v))

/**
 * Stage-2 view: bars are the MEAN over status=='ok' reps, with a min–max
 * whisker on the total. A crashed run bills a partial conversation and scores
 * null, so it is excluded from every average — but a cell whose runs ALL died
 * is still drawn (as a dead marker, no bars), because that outcome is the
 * result for the window cells, not missing data.
 */
const mean = (xs) => (xs.length
  ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

const agg = (v) => {
  const all = byVariant.get(v)
  const ok = all.filter((r) => r.status === 'ok')
  const totals = ok.map((r) => Number(r.cost_usd_total) || 0)
  const scores = ok.map((r) => Number(r.score_total))
    .filter((x) => Number.isFinite(x) && x > 0)
  const buckets = Object.fromEntries(BUCKETS.map(([k]) =>
    [k, mean(ok.map((r) => Number(r[k]) || 0))]))
  return {
    n: ok.length, failed: all.length - ok.length, dead: ok.length === 0,
    buckets, total: mean(totals),
    lo: totals.length ? Math.min(...totals) : 0,
    hi: totals.length ? Math.max(...totals) : 0,
    score: scores.length ? mean(scores) : null,
  }
}
const A = new Map(variants.map((v) => [v, agg(v)]))

const W = 1180
const H = 700
const M = { l: 74, r: 74, t: 96, b: 118 }
const plotW = W - M.l - M.r
const plotH = H - M.t - M.b
// headroom for the whisker cap, not just the bar
const maxCost = Math.max(...variants.map((v) =>
  Math.max(A.get(v).total, A.get(v).hi))) * 1.12
const x = (i) => M.l + (i + 0.5) * (plotW / variants.length)
const bw = Math.min(64, (plotW / variants.length) * 0.62)
const y = (usd) => M.t + plotH * (1 - usd / maxCost)
const yq = (score) => M.t + plotH * (1 - score / 100)

let s = ''
s += `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" `
s += `viewBox="0 0 ${W} ${H}" font-family="-apple-system,Helvetica,sans-serif">`
s += `<rect width="${W}" height="${H}" fill="#ffffff"/>`
s += `<text x="${M.l}" y="42" font-size="23" font-weight="700" fill="#16181d">`
s += `Same task, same agent, same model — only the context strategy changed</text>`
s += `<text x="${M.l}" y="66" font-size="14" fill="#5d626e">`
s += `t-dog · bars are the mean of the ok reps (whisker = min–max), measured `
s += `dollars from results.csv · dots are grader score /100</text>`

for (let g = 0; g <= 4; g++) {
  const usd = (maxCost / 4) * g
  s += `<line x1="${M.l}" y1="${y(usd)}" x2="${W - M.r}" y2="${y(usd)}" `
  s += `stroke="#eceef1"/>`
  s += `<text x="${M.l - 8}" y="${y(usd) + 4}" font-size="12" fill="#8b909c" `
  s += `text-anchor="end">$${usd.toFixed(2)}</text>`
}
s += `<text x="${W - M.r + 8}" y="${yq(100) + 4}" font-size="12" `
s += `fill="#3f7f68">100</text>`
s += `<text x="${W - M.r + 8}" y="${yq(80) + 4}" font-size="12" `
s += `fill="#3f7f68">80</text>`

const qpts = []
for (const [i, v] of variants.entries()) {
  const a = A.get(v)
  const cx = x(i)
  let cy = y(0)
  const dead = a.dead
  for (const [k, color] of BUCKETS) {
    const usd = a.buckets[k] || 0
    if (!usd) continue
    const h = plotH * (usd / maxCost)
    cy -= h
    s += `<rect x="${cx - bw / 2}" y="${cy}" width="${bw}" height="${h}" `
    s += `fill="${color}"/>`
  }
  // min–max whisker: the spread is the claim's error bar, so it ships with it
  if (a.n > 1 && a.hi > a.lo) {
    const cap = bw * 0.28
    s += `<line x1="${cx}" y1="${y(a.lo)}" x2="${cx}" y2="${y(a.hi)}" `
    s += `stroke="#16181d" stroke-width="1.4" opacity="0.55"/>`
    for (const usd of [a.lo, a.hi]) {
      s += `<line x1="${cx - cap}" y1="${y(usd)}" x2="${cx + cap}" `
      s += `y2="${y(usd)}" stroke="#16181d" stroke-width="1.4" opacity="0.55"/>`
    }
    cy = Math.min(cy, y(a.hi))
  }
  s += `<text x="${cx}" y="${cy - 8}" font-size="14" font-weight="700" `
  s += `fill="${dead ? '#b03a2e' : '#16181d'}" text-anchor="middle">`
  s += `${dead ? '—' : '$' + a.total.toFixed(2)}</text>`
  if (dead) {
    s += `<text x="${cx}" y="${cy - 26}" font-size="12" font-weight="700" `
    s += `fill="#b03a2e" text-anchor="middle">✕ rejected</text>`
  }
  const [l1, l2] = LABELS[v] ?? [v, '']
  s += `<text x="${cx}" y="${H - M.b + 22}" font-size="12.5" `
  s += `font-weight="600" fill="#3f434d" text-anchor="middle">${l1}</text>`
  s += `<text x="${cx}" y="${H - M.b + 38}" font-size="11.5" fill="#6d727e" `
  s += `text-anchor="middle">${l2}</text>`
  // n is on every bar: a mean of 3 and a single run must not look alike
  const nLab = dead ? `${a.failed} failed` : `n=${a.n}`
  s += `<text x="${cx}" y="${H - M.b + 54}" font-size="10.5" `
  s += `fill="${dead ? '#b03a2e' : '#9a9fab'}" text-anchor="middle">`
  s += `${nLab}</text>`
  if (a.score != null) qpts.push([cx, yq(a.score)])
  else if (dead) {
    s += `<text x="${cx}" y="${yq(96)}" font-size="15" fill="#b03a2e" `
    s += `text-anchor="middle">☠</text>`
  }
}
for (let i = 1; i < qpts.length; i++) {
  s += `<line x1="${qpts[i - 1][0]}" y1="${qpts[i - 1][1]}" `
  s += `x2="${qpts[i][0]}" y2="${qpts[i][1]}" stroke="#3f7f68" `
  s += `stroke-width="1.6" stroke-dasharray="4 4" opacity="0.7"/>`
}
for (const [cx, cy] of qpts) {
  s += `<circle cx="${cx}" cy="${cy}" r="4.5" fill="#ffffff" `
  s += `stroke="#3f7f68" stroke-width="2.2"/>`
}

let lx = M.l
for (const [, color, label] of BUCKETS) {
  s += `<rect x="${lx}" y="${H - 40}" width="12" height="12" fill="${color}"/>`
  s += `<text x="${lx + 17}" y="${H - 30}" font-size="12" fill="#3f434d">`
  s += `${label}</text>`
  lx += 17 + label.length * 6.6 + 26
}
s += `<circle cx="${lx + 6}" cy="${H - 34}" r="4.5" fill="#ffffff" `
s += `stroke="#3f7f68" stroke-width="2.2"/>`
s += `<text x="${lx + 17}" y="${H - 30}" font-size="12" fill="#3f434d">`
s += `grader score (right axis)</text>`
s += `</svg>`

fs.writeFileSync(path.join(OUT, 'hero-chart.svg'), s)
console.log(`wrote experiments/results/hero-chart.svg (${variants.length} variants)`)
