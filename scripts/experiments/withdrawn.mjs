/**
 * Account for the treatments that ship as data but never appear in a table.
 *
 *   node scripts/experiments/withdrawn.mjs            # write the notes
 *   node scripts/experiments/withdrawn.mjs --check    # fail if any is stale
 *
 * The repo publishes every run it made, including the ones whose numbers are
 * held back. That is the honest choice and it creates a specific hazard: a
 * reader browsing `experiments/` finds directories full of real runs whose
 * costs appear in no table, and has no way to tell "withheld because the
 * treatment was wrong" from "withheld because the number was inconvenient".
 * These notes close that gap, one per directory, where the reader actually is.
 *
 * Everything below is derived from `experiments/results/results.csv` — the
 * same generated view the tables are built from — so the run counts here
 * cannot drift from the run counts there. The only hand-written material is
 * the paragraph per CLASS, and the classes come from `narrativeStatus()` in
 * aggregate.mjs, which is where the taxonomy is defined.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const CSV = path.join(ROOT, 'experiments/results/results.csv')
const LABELS = path.join(HERE, 'labels.json')
const CHECK = process.argv.includes('--check')

/** The two statuses that reach a published table. Everything else is withheld. */
const PUBLISHED = ['headline', 'fix3']

/**
 * One paragraph per class, and what to read instead. Keyed by the value
 * `narrativeStatus()` assigns. A class that turns up here without an entry is
 * a refusal, not a blank note — an unexplained withdrawal is the whole thing
 * this file exists to prevent.
 */
const CLASSES = {
  'deleted-halfmove': {
    short: 'withdrawn: the half-move',
    why:
      'These runs moved the cache breakpoint but left the volatile run-context ' +
      'block above the conversation, so the prefix still changed on every turn ' +
      'and the cache still missed. It is a real measurement of an intermediate ' +
      'state, and an intermediate state nobody would deliberately ship: the ' +
      'change costs the same to make as the one that works. Reporting it beside ' +
      'the fix would suggest a spectrum where there is a right answer.',
  },
  'deleted-trap': {
    short: 'withdrawn: composed wrong',
    why:
      'Both fixes are applied here, and composed wrong: the volatile churn still ' +
      'lands inside the conversation span, so the cache breaks anyway and the ' +
      'composition buys nothing. It is the trap worth knowing about, which is why ' +
      'the runs ship, but its cost is a property of the mistake rather than of ' +
      'either fix.',
  },
  superseded: {
    short: 'withdrawn: the earlier naming',
    why:
      'This is the correct composition under its earlier name, measured against ' +
      'a frozen run context. The published rows re-ran it against a live one, ' +
      'which is the condition an actual agent runs in. The numbers here are ' +
      'sound; they are simply the earlier lineage, kept as evidence rather than ' +
      'printed twice under two names.',
  },
  'excluded-lineage': {
    short: 'excluded as a result, not a gap',
    why:
      'Sliding-window trimming drops a web_search that a later web_fetch depends ' +
      'on, so most of these runs 400 out. That is the finding: on this loop the ' +
      'tactic is not merely expensive, it is unsafe. The runs are excluded from ' +
      'the cost tables because a crashed run bills a partial conversation and ' +
      'would read as cheapness — not because the tactic went unmeasured.',
  },
}

const parseCsv = (text) => {
  const [head, ...lines] = text.trim().split('\n')
  const cols = head.split(',')
  return lines.map((l) => {
    // The generated CSV quotes any field containing a comma; nothing else.
    const out = []
    let cur = ''
    let q = false
    for (const ch of l) {
      if (ch === '"') q = !q
      else if (ch === ',' && !q) { out.push(cur); cur = '' }
      else cur += ch
    }
    out.push(cur)
    return Object.fromEntries(cols.map((c, i) => [c, out[i] ?? '']))
  })
}

/** `t-compliance:full-window` is the CSV's name for the directory `t-compliance-full-window`. */
const dirFor = (variant) => variant.replace(':', '-')
/** The treatment without its task prefix, which is what the labels are keyed by. */
const cellFor = (variant) => variant.includes(':') ? variant.split(':')[1] : variant

const rows = parseCsv(fs.readFileSync(CSV, 'utf8'))
const labels = JSON.parse(fs.readFileSync(LABELS, 'utf8'))

const publishedVariants = new Set(
  rows.filter((r) => PUBLISHED.includes(r.narrative_status)).map((r) => r.variant),
)

/**
 * The published row a reader should look at instead, if one exists. Derived,
 * never asserted: swap the withdrawn lineage's prefix for the live one, keep
 * the task it was run on, and only name the result if that exact row actually
 * reached a table. A treatment whose live twin was never run says so instead.
 */
function replacement(variant) {
  const task = variant.includes(':') ? variant.split(':')[0] + ':' : ''
  const live = task + cellFor(variant).replace(/^(full|fullvol|prefix)-/, 'live-')
  return live !== variant && publishedVariants.has(live) ? live : null
}

const groups = new Map()
for (const r of rows) {
  if (PUBLISHED.includes(r.narrative_status)) continue
  if (!CLASSES[r.narrative_status]) {
    console.error(`Refusing to write — no explanation for class "${r.narrative_status}" ` +
      `(treatment ${r.variant}). Add it to CLASSES in this file.`)
    process.exit(1)
  }
  if (!groups.has(r.variant)) groups.set(r.variant, [])
  groups.get(r.variant).push(r)
}

const wrap = (s, width = 76) => {
  const out = []
  let line = ''
  for (const w of s.split(/\s+/)) {
    if (line && (line + ' ' + w).length > width) { out.push(line); line = w }
    else line = line ? line + ' ' + w : w
  }
  if (line) out.push(line)
  return out.join('\n')
}

function noteFor(variant, rs) {
  const cell = cellFor(variant)
  const cls = CLASSES[rs[0].narrative_status]
  const ok = rs.filter((r) => r.status === 'ok').length
  const label = labels[cell]
  const swap = replacement(variant)
  const runs = `${rs.length} ${rs.length === 1 ? 'run' : 'runs'} on disk` +
    (ok === rs.length ? ', all completed' : `, ${ok} completed and ${rs.length - ok} failed`)

  const lines = [
    `# ${variant} — ${cls.short}`,
    '',
    wrap(`**${label ? label + '. ' : ''}${runs}. Its cost does not appear in any ` +
      `table in the README, on purpose.**`),
    '',
    wrap(cls.why),
    '',
    wrap(swap
      ? `Read \`${swap}\` instead — it is the published row this one was replaced by, ` +
        `and it is in the tables.`
      : `There is no published row that replaces this one; the exclusion is the result.`),
    '',
    wrap(`The runs themselves are complete and unedited: \`result.json\`, ` +
      `\`usage.jsonl\` and \`trace.jsonl\` per replicate, the same records every ` +
      `published number is computed from. \`node scripts/experiments/aggregate.mjs\` ` +
      `reads them along with everything else; the tables drop them by ` +
      `\`narrative_status\`, and say so out loud when they do.`),
    '',
    wrap(`Written by \`node scripts/experiments/withdrawn.mjs\` — see ` +
      `\`experiments/WITHDRAWN.md\` for every withheld treatment at once.`),
    '',
  ]
  return lines.join('\n')
}

function index() {
  const byClass = new Map()
  for (const [variant, rs] of groups) {
    const st = rs[0].narrative_status
    if (!byClass.has(st)) byClass.set(st, [])
    byClass.get(st).push([variant, rs])
  }
  const totalRuns = [...groups.values()].reduce((n, rs) => n + rs.length, 0)

  const out = [
    '# Withheld treatments',
    '',
    wrap(`${groups.size} of the treatment directories under \`experiments/\` — ` +
      `${totalRuns} runs — ship their records but appear in no table in the ` +
      `README. This file says which, and why, in one place. Every count below is ` +
      `read from \`experiments/results/results.csv\` by ` +
      `\`node scripts/experiments/withdrawn.mjs\`; none of it is typed.`),
    '',
    wrap(`Publishing data you chose not to report is more honest than deleting ` +
      `it, and it invites exactly one question — "why isn't this in the table". ` +
      `Each directory carries its own \`WITHDRAWN.md\` with the same answer, so ` +
      `the question gets answered where it gets asked.`),
    '',
    wrap(`The classes come from \`narrativeStatus()\` in ` +
      `\`scripts/experiments/aggregate.mjs\`, which is where a treatment's ` +
      `standing is decided. \`readme-table.mjs\` prints the held-back list on ` +
      `every run and refuses outright on a treatment it cannot classify.`),
    '',
  ]

  for (const [st, entries] of [...byClass].sort()) {
    const cls = CLASSES[st]
    out.push(`## \`${st}\` — ${cls.short}`, '')
    out.push(wrap(cls.why), '')
    out.push('| Treatment | Runs | Completed | Read instead |', '|---|---:|---:|---|')
    for (const [variant, rs] of entries.sort((a, b) => a[0].localeCompare(b[0]))) {
      const swap = replacement(variant)
      out.push(`| [\`${variant}\`](${dirFor(variant)}/WITHDRAWN.md) | ${rs.length} | ` +
        `${rs.filter((r) => r.status === 'ok').length} | ${swap ? `\`${swap}\`` : '—'} |`)
    }
    out.push('')
  }
  return out.join('\n')
}

const wanted = new Map()
wanted.set(path.join(ROOT, 'experiments/WITHDRAWN.md'), index())
for (const [variant, rs] of groups) {
  const dir = path.join(ROOT, 'experiments', dirFor(variant))
  if (!fs.existsSync(dir)) {
    console.error(`Refusing — ${variant} has rows in the CSV but no directory at ${dir}`)
    process.exit(1)
  }
  wanted.set(path.join(dir, 'WITHDRAWN.md'), noteFor(variant, rs))
}

let stale = 0
for (const [file, body] of wanted) {
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
  if (current === body) continue
  stale++
  if (CHECK) console.error(`stale: ${path.relative(ROOT, file)}`)
  else fs.writeFileSync(file, body)
}

if (CHECK) {
  if (stale) {
    console.error(`${stale} withdrawal note(s) are stale. Run without --check to rewrite.`)
    process.exit(1)
  }
  console.error(`All ${wanted.size} withdrawal notes are current.`)
} else {
  console.error(`${wanted.size} withdrawal notes written (${stale} changed) — ` +
    `${groups.size} treatments, ` +
    `${[...groups.values()].reduce((n, rs) => n + rs.length, 0)} runs.`)
}
