/**
 * The mechanism figures in the README's "Why Fix 1 is the one that matters",
 * recomputed from the two runs they describe.
 *
 *   node scripts/experiments/mechanism.mjs           print them
 *   node scripts/experiments/mechanism.mjs --check   fail if the README drifted
 *
 * Those figures are prose, not a generated table, because the argument reads
 * badly as a grid. That makes them the one place in this README a number is
 * typed by hand — so this exists to catch a typo or a stale edit, and runs
 * beside `readme-table.mjs --check` before anything is published.
 *
 * The runs are committed artifacts and cannot change under us. The claims
 * about them can.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RATES, SEARCH_USD } from './rates.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// web_search is billed per request; web_fetch is not. One rate card.
const SEARCH_FEE = SEARCH_USD

const NAIVE = 'experiments/naive-append/rep-1'
const FIX1 = 'experiments/live-append/rep-7'

function load(dir) {
  const file = path.join(REPO, dir, 'usage.jsonl')
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map(
    (l) => JSON.parse(l),
  )
  const sum = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0)
  const model = rows[0].model
  const rate = RATES[model]
  if (!rate) throw new Error(`no rate card for ${model}`)
  const [inRate, outRate, writeRate, readRate] = rate.map((r) => r / 1e6)

  const input = sum('input_tokens')
  const write = sum('cache_creation_input_tokens')
  const read = sum('cache_read_input_tokens')
  const output = sum('output_tokens')
  const fees = sum('web_search_requests') * SEARCH_FEE

  const billed = input * inRate + write * writeRate + read * readRate +
    output * outRate + fees
  // The counterfactual: nothing cached, so every token that was written or
  // read is bought once at the full input rate.
  const uncached = (input + write + read) * inRate + output * outRate + fees

  return {
    dir,
    calls: rows.length,
    zeroReads: rows.filter((r) => !r.cache_read_input_tokens).length,
    toolCalls: rows.filter(
      (r) => (r.web_search_requests || 0) + (r.web_fetch_requests || 0) > 0,
    ).length,
    read,
    readOnToolCalls: rows
      .filter((r) => (r.web_search_requests || 0) + (r.web_fetch_requests || 0) > 0)
      .reduce((a, r) => a + (r.cache_read_input_tokens || 0), 0),
    uncachedInput: input,
    searches: sum('web_search_requests'),
    fetches: sum('web_fetch_requests'),
    fees,
    billed,
    recorded: sum('cost_usd'),
    withoutCaching: uncached,
    saved: uncached - billed,
  }
}

const naive = load(NAIVE)
const fix1 = load(FIX1)
const usd = (n) => '$' + n.toFixed(2)
const pct = (a, b) => ((100 * a) / b).toFixed(2) + '%'

// Each claim is the phrase the README must contain, built from the computed
// figure. Comparing a computed value against a constant in this file would
// only prove this file agrees with itself — the README is the thing that
// can drift, so the README is what gets read.
const CLAIMS = [
  ['as-built without caching / billed',
    `cost ${usd(naive.withoutCaching)} instead of the ${usd(naive.billed)}`],
  ['as-built saved by caching', `already saving ${usd(naive.saved)}`],
  ['as-built calls', `Across the ${naive.calls} calls`],
  ['as-built calls reading zero',
    `${naive.zeroReads} read exactly zero cached tokens`],
  ['as-built cache reads',
    `${naive.read.toLocaleString('en-US')} tokens that did come from cache`],
  ['reads landing on tool calls',
    `${pct(naive.readOnToolCalls, naive.read)} of them`],
  ['as-built calls with a tool', `landed on the ${naive.toolCalls} calls`],
  ['Fix 1 calls / uncached input',
    `${fix1.calls}-call run is ${fix1.uncachedInput} tokens`],
  ['Fix 1 saved by caching / billed',
    `${usd(fix1.saved)} on a run that costs ${usd(fix1.billed)}`],
  ['as-built saved, restated', `the ${usd(naive.saved)} it was saving before`],
]

const check = process.argv.includes('--check')
let bad = 0

// Markdown emphasis sits inside several of these phrases, and the source is
// hard-wrapped, so both are flattened before matching.
// The copy renames README.public.md to README.md, so default to whichever
// one exists — exactly as readme-table.mjs does. `--readme` still wins.
const i = process.argv.indexOf('--readme')
const readmePath = i !== -1 && process.argv[i + 1]
  ? path.resolve(process.argv[i + 1])
  : (['README.public.md', 'README.md']
      .map((n) => path.join(REPO, n))
      .find((p) => fs.existsSync(p)) ?? path.join(REPO, 'README.md'))
const readme = fs.readFileSync(readmePath, 'utf8')
  .replace(/\*\*/g, '').replace(/\s+/g, ' ')

for (const [label, phrase] of CLAIMS) {
  const ok = readme.includes(phrase)
  if (!ok) bad++
  if (!check) console.log(`  ${label.padEnd(34)} ${phrase}`)
  else if (!ok) console.error(`DRIFT: ${label} — README does not say "${phrase}"`)
}

// A run must reprice to the cent from its own tokens, or the fee model is
// wrong and every figure above inherits the error.
for (const r of [naive, fix1]) {
  if (r.billed.toFixed(4) !== r.recorded.toFixed(4)) {
    console.error(
      `DRIFT: ${r.dir} reprices to $${r.billed.toFixed(4)} but recorded ` +
      `$${r.recorded.toFixed(4)} — check the search fee, not the README`,
    )
    bad++
  }
}

if (!check) {
  console.log(`\n  as-built: ${naive.searches} searches (fee ${usd(naive.fees)}), ` +
    `${naive.fetches} fetches (no fee)`)
}
if (bad) {
  console.error(`\n${bad} mechanism figure(s) do not match the README.`)
  process.exit(1)
}
if (check) console.log('README mechanism figures are current.')
