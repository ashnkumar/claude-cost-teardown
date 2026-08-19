/**
 * Load a finished agent run into the app, for free.
 *
 *   node scripts/load-run.mjs --list
 *   node scripts/load-run.mjs --best
 *   node scripts/load-run.mjs --cell live-append --rep rep-7
 *   node scripts/load-run.mjs --best --task t-compliance
 *
 * Reset gives you the seed. This gives you the other end — a task the agent
 * has actually finished, with its real subtask tree, comments and report.
 * Every completed run is already on disk under `experiments/`, so showing one
 * costs nothing; until now the only way to see that state was to spend $5.
 *
 * Reversible: hit Reset in the app to go back to the seed.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EXP = path.join(REPO, 'experiments')
const LIVE = path.join(REPO, 'data', 'tasks.json')
const SEED = path.join(REPO, 'data', 'seed.json')

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback
}
const flag = (name) => process.argv.includes(`--${name}`)

const reportChars = (t) =>
  t?.report ? String(t.report.markdown ?? t.report).length : 0

/** Every recorded run that finished and left a task tree behind. */
function findRuns(taskFilter) {
  const runs = []
  for (const cell of fs.readdirSync(EXP)) {
    const dir = path.join(EXP, cell)
    if (cell === 'results' || !fs.statSync(dir).isDirectory()) continue
    for (const rep of fs.readdirSync(dir)) {
      const file = path.join(dir, rep, 'result.json')
      if (!fs.existsSync(file)) continue
      let r
      try {
        r = JSON.parse(fs.readFileSync(file, 'utf8'))
      } catch {
        continue
      }
      const tree = r.final_task_tree
      if (r.dry_run || r.status !== 'ok' || !tree) continue
      if (taskFilter && r.task_id !== taskFilter) continue
      runs.push({
        cell, rep, tree,
        taskId: r.task_id,
        turns: r.turns ?? 0,
        subtasks: countTree(tree) - 1,
        comments: countComments(tree),
        chars: reportChars(tree),
      })
    }
  }
  return runs
}

const countTree = (t) =>
  1 + (t.subtasks ?? []).reduce((a, s) => a + countTree(s), 0)
const countComments = (t) =>
  (t.comments?.length ?? 0) +
  (t.subtasks ?? []).reduce((a, s) => a + countComments(s), 0)

/**
 * The archive nests subtasks; the store keeps one flat list joined by
 * parentId. Same tree, different shape — this is the only real work here.
 */
function flatten(node, parentId = null, out = []) {
  const { subtasks = [], ...task } = node
  out.push({ ...task, parentId })
  for (const child of subtasks) flatten(child, task.id, out)
  return out
}

/** Every id beneath a root, so the old subtree can be dropped wholesale. */
function descendants(tasks, rootId, acc = new Set()) {
  for (const t of tasks) {
    if (t.parentId === rootId && !acc.has(t.id)) {
      acc.add(t.id)
      descendants(tasks, t.id, acc)
    }
  }
  return acc
}

function base() {
  if (fs.existsSync(LIVE)) {
    return JSON.parse(fs.readFileSync(LIVE, 'utf8')).tasks
  }
  // No live state yet. The seed's dates are rolled forward at boot, so this
  // fallback shows stale due dates — open the app once and Reset to fix.
  console.error('note: no data/tasks.json yet, falling back to the raw seed ' +
    '— due dates will look stale until you hit Reset.')
  return JSON.parse(fs.readFileSync(SEED, 'utf8')).tasks
}

const runs = findRuns(arg('task'))
if (!runs.length) {
  console.error('No finished runs found under experiments/.')
  process.exit(1)
}

if (flag('list')) {
  runs.sort((a, b) => b.chars - a.chars)
  console.log(
    'cell/rep'.padEnd(50) +'task'.padEnd(15) +
    'turns'.padEnd(7) + 'subs'.padEnd(6) + 'cmts'.padEnd(6) + 'report')
  for (const r of runs) {
    console.log(
      `${r.cell}/${r.rep}`.padEnd(50) +r.taskId.padEnd(15) +
      String(r.turns).padEnd(7) + String(r.subtasks).padEnd(6) +
      String(r.comments).padEnd(6) + r.chars.toLocaleString('en-US') + ' chars')
  }
  console.log(`\n${runs.length} runs. Load one with --cell <name> --rep <rep-N>.`)
  process.exit(0)
}

let pick
if (flag('best') || (!arg('cell') && !arg('rep'))) {
  // A run that ended at needs_review wins first — that is the state the app
  // is built to show, a finished run waiting on a person. Then richest tree.
  const done = (r) => (r.tree.status === 'needs_review' ? 1 : 0)
  pick = runs.slice().sort((a, b) =>
    (done(b) - done(a)) || (b.subtasks - a.subtasks) || (b.chars - a.chars))[0]
} else {
  const cell = arg('cell')
  const rep = arg('rep', 'rep-1')
  pick = runs.find((r) => r.cell === cell && r.rep === rep)
  if (!pick) {
    console.error(`No finished run at experiments/${cell}/${rep}. ` +
      'Try --list.')
    process.exit(1)
  }
}

const tasks = base()
const root = pick.tree
const stale = descendants(tasks, root.id)
const kept = tasks.filter((t) => t.id !== root.id && !stale.has(t.id))
const loaded = flatten(root, tasks.find((t) => t.id === root.id)?.parentId ?? null)

// Keep the seeded ordering: the run's tasks go where the original task sat.
const at = tasks.findIndex((t) => t.id === root.id)
const next = at === -1
  ? [...kept, ...loaded]
  : [...kept.slice(0, at), ...loaded, ...kept.slice(at)]

fs.writeFileSync(LIVE, JSON.stringify({ tasks: next }, null, 2) + '\n')

console.log(`Loaded ${pick.cell}/${pick.rep} into data/tasks.json`)
console.log(`  ${root.title}`)
console.log(`  status ${root.status} · ${pick.subtasks} subtasks · ` +
  `${pick.comments} comments · ${pick.chars.toLocaleString('en-US')}-char report`)
console.log(`  ${next.length} tasks total. Reset in the app puts the seed back.`)
