// Sequential matrix driver. One child process per rep so a crash can never
// take the matrix down, and a cooldown after each run so the org-scoped
// prompt cache (5-min TTL, refreshed on read) goes cold between runs —
// parallel lanes would warm each other's identical prefixes and contaminate
// the very variable under study. Slow on purpose.
//
//   node scripts/experiments/run-matrix.mjs [--cells=a,b] [--task=t-dog]
//        [--cooldown=320] [--dry-run]
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CELLS, MATRIX_DEFAULT } from './cells.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

function arg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split('=').slice(1).join('=') : fallback
}
const flag = (name) => process.argv.includes(`--${name}`)

const cells = (arg('cells') ? arg('cells').split(',') : MATRIX_DEFAULT)
  .map((c) => c.trim()).filter(Boolean)
for (const c of cells) {
  if (!CELLS[c]) throw new Error(`unknown cell in --cells: ${c}`)
}
const dry = flag('dry-run')
const cooldown = Number(arg('cooldown', dry ? '0' : '320'))
const task = arg('task', 't-dog')

console.log(
  `matrix: ${cells.length} cells, task=${task}, ` +
  `cooldown=${cooldown}s, ${dry ? 'DRY' : 'LIVE'}`,
)
const results = []
for (const [i, cell] of cells.entries()) {
  console.log(`\n=== [${i + 1}/${cells.length}] ${cell} ===`)
  const args = [
    path.join(HERE, 'run-cell.mjs'),
    `--cell=${cell}`, `--task=${task}`,
    ...(dry ? ['--dry-run'] : []),
  ]
  const child = spawnSync('node', args, { stdio: 'inherit' })
  results.push({ cell, code: child.status })
  if (i < cells.length - 1 && cooldown > 0) {
    console.log(`cooldown ${cooldown}s (cache must go cold)…`)
    await new Promise((r) => setTimeout(r, cooldown * 1000))
  }
}

console.log('\n=== matrix summary ===')
for (const r of results) {
  console.log(`${r.code === 0 ? 'ok   ' : 'ERROR'} ${r.cell}`)
}
if (results.some((r) => r.code !== 0)) process.exit(1)
