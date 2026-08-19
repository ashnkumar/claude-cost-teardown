// The four caching cells. Each takes the split system prompt and returns the
// system blocks for one request; `topLevel` asks the harness to also set the
// request-level cache_control (the SDK's automatic conversation caching).
//
// `naive` must reproduce the app's request byte-for-byte — that cell IS the
// app as built. `prefix`/`full` put the volatile lines AFTER the static
// prefix, outside the marker, which is the whole fix.
import { fileURLToPath } from 'node:url'

const marked = (text) => ({
  type: 'text', text, cache_control: { type: 'ephemeral' },
})
const plain = (text) => ({ type: 'text', text })

export const CACHE = {
  off: { topLevel: false, system: (p) => [plain(p.full)] },
  naive: { topLevel: false, system: (p) => [marked(p.full)] },
  prefix: {
    topLevel: false,
    system: (p) => [marked(p.static), plain(p.volatile)],
  },
  // The composition trap: prefix-style system + conversation caching,
  // composed naively. The volatile block sits ABOVE the messages in the
  // cache hierarchy, so its per-call churn kills the conversation span on
  // every call — both fixes applied, bill barely moves.
  fullvol: {
    topLevel: true,
    system: (p) => [marked(p.static), plain(p.volatile)],
  },
  // The corrected composition: nothing above the conversation ever changes.
  // The volatile run context is frozen into the opening user message once
  // (the agent learns subtask state from its own tool results anyway).
  full: {
    topLevel: true,
    volatileInOpener: true,
    system: (p) => [marked(p.static)],
  },
  // `full` buys its cache by freezing the run context at run start, so the
  // agent reads "Open subtasks: none yet" for the whole run — a cache win
  // paid for with information. This cell keeps the context LIVE: rebuilt
  // every turn and appended to the newest message, i.e. BELOW everything
  // already sent. Nothing above the bookmark is ever rewritten, so prior
  // turns still hit; the churn costs ~40 fresh tokens per turn.
  live: {
    topLevel: true,
    volatileInOpener: true,
    volatileEachTurn: true,
    system: (p) => [marked(p.static)],
  },
}

// Self-test: node scripts/experiments/strategies-cache.mjs
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { getTask, buildSystem, openSubtaskTitles, splitSystem } =
    await import('./repo.mjs')
  const task = await getTask('t-dog')
  const open = await openSubtaskTitles(task.id)
  // Split the SAME output being compared against — the volatile line holds a
  // millisecond timestamp, so two buildSystem calls never match each other.
  const shipped = buildSystem(task, 'run-selftest', open)
  const parts = splitSystem(shipped)

  const naive = CACHE.naive.system(parts)
  if (JSON.stringify(naive) !== JSON.stringify(shipped)) {
    throw new Error('naive cell does not reproduce the shipped request')
  }
  const off = CACHE.off.system(parts)
  if (JSON.stringify(off).includes('cache_control')) {
    throw new Error('off cell leaked a cache marker')
  }
  for (const name of ['prefix', 'fullvol']) {
    const blocks = CACHE[name].system(parts)
    if (blocks.length !== 2) throw new Error(`${name}: expected 2 blocks`)
    if (!blocks[0].cache_control) throw new Error(`${name}: static unmarked`)
    if (blocks[1].cache_control) throw new Error(`${name}: volatile marked`)
    if (!blocks[1].text.startsWith('Current date: ')) {
      throw new Error(`${name}: volatile block not the 4 volatile lines`)
    }
  }
  for (const name of ['full', 'live']) {
    const blocks = CACHE[name].system(parts)
    if (blocks.length !== 1 || !blocks[0].cache_control ||
        blocks[0].text !== parts.static) {
      throw new Error(`${name}: expected exactly the marked static block`)
    }
    if (!CACHE[name].volatileInOpener) {
      throw new Error(`${name}: volatileInOpener flag missing`)
    }
  }
  if (!CACHE.live.volatileEachTurn) {
    throw new Error('live: volatileEachTurn flag missing')
  }
  if (CACHE.full.volatileEachTurn) {
    throw new Error('full: must stay frozen — that is the cell it measures')
  }
  for (const [name, cell] of Object.entries(CACHE)) {
    const blocks = cell.system(parts)
    console.log(
      `${name.padEnd(6)} topLevel=${String(cell.topLevel).padEnd(5)} ` +
      blocks.map((b) =>
        `[${b.cache_control ? 'CACHED' : 'plain '}] "${b.text.slice(0, 28)}…"`,
      ).join('  '),
    )
  }
  console.log('strategies-cache.mjs self-test OK')
}
