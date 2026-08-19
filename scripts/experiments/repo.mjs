// Bridge into the app's TypeScript through jiti (already a transitive dep;
// there is no tsx/ts-node here, and Node's strip-types chokes on gate.ts).
// Everything the harness borrows from the app's code flows through this file
// so the experiment scripts stay plain .mjs with zero new dependencies.
import { createJiti } from 'jiti'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const REPO = path.resolve(HERE, '..', '..')

// store.ts and usage.ts write via paths relative to the process cwd; the
// harness must land those in the repo no matter where it was launched from.
process.chdir(REPO)

const jiti = createJiti(fileURLToPath(import.meta.url), {
  alias: { '@': REPO },
})

const store = await jiti.import('@/lib/store')
const prompt = await jiti.import('@/lib/agent/prompt')
const tools = await jiti.import('@/lib/agent/tools')
const call = await jiti.import('@/lib/anthropic/call')

export const {
  getTask, resetDb, openSubtaskTitles, listTasks, updateTask,
} = store
export const { buildSystem, buildOpeningMessage } = prompt
export const { TOOLS, executeClientTool, isClientTool } = tools
export const { callClaude, MODEL, MAX_TOKENS, THINKING, EFFORT } = call

/**
 * The app's buildSystem returns ONE block: four volatile lines, a blank
 * line, then the ~9.4k-token static prefix — all under one cache marker.
 * The cache cells need those halves separately. prompt.ts stays byte-
 * identical, so the split happens here, and every assumption
 * it rests on is asserted loudly before a request costs money.
 */
export function splitSystem(blocks) {
  if (!Array.isArray(blocks) || blocks.length !== 1) {
    throw new Error(`splitSystem: expected 1 system block, got ${blocks?.length}`)
  }
  const { text } = blocks[0]
  if (blocks[0].cache_control?.type !== 'ephemeral') {
    throw new Error('splitSystem: system block lost its cache marker')
  }
  const cut = text.indexOf('\n\n')
  const volatile = text.slice(0, cut)
  const staticPart = text.slice(cut + 2)
  if (volatile.split('\n').length !== 4 ||
      !volatile.startsWith('Current date: ')) {
    throw new Error('splitSystem: volatile head is not the expected 4 lines')
  }
  if (!staticPart.startsWith('You are an execution agent inside Delegate')) {
    throw new Error('splitSystem: static prefix does not open as expected')
  }
  // ~6.4k chars as shipped; the 9.4k figure people quote is cache-write
  // TOKENS, which also count the server-injected tool specs.
  if (staticPart.length < 4000) {
    throw new Error('splitSystem: static prefix suspiciously short')
  }
  if (volatile + '\n\n' + staticPart !== text) {
    throw new Error('splitSystem: reassembly is not byte-identical')
  }
  return { full: text, static: staticPart, volatile }
}

export async function systemParts(task, runId) {
  const open = await openSubtaskTitles(task.id)
  return splitSystem(buildSystem(task, runId, open))
}

// Self-test: node scripts/experiments/repo.mjs
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const task = await getTask('t-dog')
  if (!task) throw new Error('self-test: t-dog missing from store')
  const parts = await systemParts(task, 'run-selftest')
  console.log(`task:            ${task.title}`)
  console.log(`volatile lines:  ${parts.volatile.split('\n').length}`)
  console.log(`static length:   ${parts.static.length} chars`)
  console.log(`model binding:   ${MODEL} / effort ${EFFORT}`)
  console.log('repo.mjs self-test OK')
}
