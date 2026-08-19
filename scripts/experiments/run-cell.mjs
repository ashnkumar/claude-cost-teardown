// One experiment rep: reset the store, verify the seed, run the cell, write
// everything a grader could ever need. Crashes still leave a result.json and
// a manifest line — a dead run is a data point, not a mystery.
//
//   node scripts/experiments/run-cell.mjs --cell=prefix-append [--rep=N]
//        [--task=t-dog] [--dry-run]
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  REPO, getTask, resetDb, listTasks, updateTask, MODEL,
} from './repo.mjs'
import { CACHE } from './strategies-cache.mjs'
import { CONTEXT } from './strategies-context.mjs'
import { CELLS } from './cells.mjs'
import { runHarnessLoop } from './harness-loop.mjs'
import { runOnRepDir } from './prefix-diff.mjs'

// in, out, cacheWrite, cacheRead — $/1M tokens, list price.
// Sonnet 5 carries an introductory discount ($2/$10) through 2026-08-31, so
// the card is billed less than this table says. We price at LIST on purpose:
// a cost claim that expires in three weeks is not a claim worth publishing.
const RATES = {
  'claude-opus-5': [5, 25, 6.25, 0.5],
  'claude-sonnet-5': [3, 15, 3.75, 0.3],
  'claude-haiku-4-5': [1, 5, 1.25, 0.1],
}
const SEARCH_USD = 10 / 1000

function arg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split('=').slice(1).join('=') : fallback
}
const flag = (name) => process.argv.includes(`--${name}`)

async function seedCheck(taskId) {
  const all = await listTasks()
  const task = await getTask(taskId)
  const ok =
    all.length === 18 &&
    !!task &&
    task.status === 'not_started' &&
    (task.subtasks?.length ?? 0) === 0 &&
    (task.comments?.length ?? 0) === 0 &&
    !task.report
  return { ok, count: all.length }
}

function tokenCost(u, model) {
  const [inR, outR, cwR, crR] = RATES[model] ?? [0, 0, 0, 0]
  return (
    (u.input_tokens ?? 0) * inR +
    (u.output_tokens ?? 0) * outR +
    (u.cache_creation_input_tokens ?? 0) * cwR +
    (u.cache_read_input_tokens ?? 0) * crR
  ) / 1e6 + (u.server_tool_use?.web_search_requests ?? 0) * SEARCH_USD
}

async function main() {
  const cellName = arg('cell')
  const cell = CELLS[cellName]
  if (!cell) throw new Error(`unknown cell ${cellName}`)
  const taskId = arg('task', 't-dog')
  const dry = flag('dry-run')

  // t-dog keeps the original flat layout; other tasks get task-prefixed
  // dirs so cells never mix tasks in one rep sequence.
  const cellDir = path.join(
    REPO, 'experiments',
    taskId === 't-dog' ? cellName : `${taskId}-${cellName}`,
  )
  let rep = arg('rep') ? Number(arg('rep')) : null
  if (rep === null) {
    rep = 1
    while (fs.existsSync(path.join(cellDir, `rep-${rep}`, 'result.json'))) {
      rep += 1
    }
  } else if (fs.existsSync(path.join(cellDir, `rep-${rep}`, 'result.json'))) {
    throw new Error(`rep-${rep} already exists for ${cellName}; refusing`)
  }
  const repDir = path.join(cellDir, `rep-${rep}`)
  fs.mkdirSync(repDir, { recursive: true })

  await resetDb()
  const seed = await seedCheck(taskId)
  if (!seed.ok && !dry) throw new Error('seed check failed after resetDb')

  // Mirror the app route: fetch first (the opener reads not_started), then
  // flip to in_progress before the loop starts.
  const task = await getTask(taskId)
  await updateTask(taskId, { status: 'in_progress' })

  const runId = `exp-${cellName}-r${rep}-${Date.now().toString(36)}`
  const tracePath = path.join(repDir, 'trace.jsonl')
  const transcriptPath = path.join(repDir, 'transcript.jsonl')
  const onEvent = (event) => {
    if (event.type === 'text_delta' || event.type === 'thinking_delta') {
      return fs.appendFileSync(
        tracePath,
        JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n',
      )
    }
    fs.appendFileSync(
      tracePath,
      JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n',
    )
    console.log(`  [${event.type}] ${event.query ?? event.url ?? event.label ?? event.status ?? ''}`)
  }
  const record = (line) =>
    fs.appendFileSync(transcriptPath, JSON.stringify(line) + '\n')

  let callFn
  if (dry) {
    const { makeScript } = await import('./dry-run-script.mjs')
    const { makeStubCall } = await import('./stub-call.mjs')
    callFn = makeStubCall(makeScript())
  } else {
    const { callClaude } = await import('./repo.mjs')
    // Long-lived streams occasionally die with a bare connection error
    // ("terminated") that the SDK does not retry; three runs were lost to
    // one squall. Retry once, only on connection-shaped errors — an API
    // rejection (4xx) still fails the run honestly.
    callFn = async (req, ctx) => {
      // A dead stream can otherwise hang a run for hours (observed when the
      // machine slept mid-batch). 15 min ceilings any single call.
      ctx = { ...ctx, signal: AbortSignal.timeout(900_000) }
      try {
        return await callClaude(req, ctx)
      } catch (error) {
        const msg = String(error?.message ?? error)
        if (!/terminated|ECONNRESET|socket|fetch failed|aborted/i.test(msg)) {
          throw error
        }
        console.log(`  [retry] connection error, once more in 20s: ${msg}`)
        await new Promise((r) => setTimeout(r, 20_000))
        return await callClaude(req, ctx)
      }
    }
  }

  const started = Date.now()
  const startedIso = new Date().toISOString()
  let outcome = null
  let runError = null
  try {
    outcome = await runHarnessLoop(task, {
      cache: CACHE[cell.cache],
      context: CONTEXT[cell.context],
      fetchcap: cell.fetchcap,
      effort: cell.effort,
      model: cell.model,
      callFn, onEvent, record, runId,
    })
  } catch (error) {
    runError = error instanceof Error ? error.message : String(error)
    console.error(`RUN ERROR: ${runError}`)
  }
  const wallMs = Date.now() - started

  // Live mode: pull this run's rows out of the global usage log (the choke
  // point appends there for every request, summarizer included). recordUsage
  // is fire-and-forget, so the final row can land AFTER the loop returns —
  // poll until the log has one row per recorded call, or 10s.
  const expectedRows = fs.existsSync(transcriptPath)
    ? fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean)
        .map((l) => JSON.parse(l)).filter((l) => l.usage).length
    : 0
  const usageRows = []
  const globalUsage = path.join(REPO, 'runs', 'usage.jsonl')
  if (fs.existsSync(globalUsage) && !dry) {
    const deadline = Date.now() + 10_000
    for (;;) {
      usageRows.length = 0
      for (const line of fs.readFileSync(globalUsage, 'utf8').split('\n')) {
        if (!line) continue
        const row = JSON.parse(line)
        if (row.run_id === runId || row.run_id === `${runId}#summary`) {
          usageRows.push(row)
        }
      }
      if (usageRows.length >= expectedRows || Date.now() > deadline) break
      await new Promise((r) => setTimeout(r, 250))
    }
    fs.writeFileSync(
      path.join(repDir, 'usage.jsonl'),
      usageRows.map((r) => JSON.stringify(r)).join('\n') +
        (usageRows.length ? '\n' : ''),
    )
  }

  const transcript = fs.existsSync(transcriptPath)
    ? fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean)
        .map((l) => JSON.parse(l))
    : []
  const sum = (kind, field) => transcript
    .filter((l) => (kind ? l.kind === kind : true) && l.usage)
    .reduce((acc, l) => acc + (field(l.usage) ?? 0), 0)
  const totals = {
    api_calls: transcript.filter((l) => l.kind === 'agent').length,
    summarizer_calls: transcript.filter((l) => l.kind === 'summarizer').length,
    input_tokens: sum(null, (u) => u.input_tokens),
    output_tokens: sum(null, (u) => u.output_tokens),
    cache_creation_input_tokens:
      sum(null, (u) => u.cache_creation_input_tokens),
    cache_read_input_tokens: sum(null, (u) => u.cache_read_input_tokens),
    web_search_requests:
      sum(null, (u) => u.server_tool_use?.web_search_requests),
    web_fetch_requests:
      sum(null, (u) => u.server_tool_use?.web_fetch_requests),
    cost_usd: usageRows.length
      ? usageRows.reduce((a, r) => a + (r.cost_usd ?? 0), 0)
      : null,
    computed_cost_usd: transcript
      .filter((l) => l.usage)
      .reduce((a, l) => a + tokenCost(l.usage, cell.model ?? MODEL), 0),
    summarizer_cost_usd: usageRows
      .filter((r) => r.run_id.endsWith('#summary'))
      .reduce((a, r) => a + (r.cost_usd ?? 0), 0),
  }

  const trace = fs.existsSync(tracePath)
    ? fs.readFileSync(tracePath, 'utf8').split('\n').filter(Boolean)
        .map((l) => JSON.parse(l))
    : []
  const count = (type) => trace.filter((e) => e.type === type).length
  const behavior = {
    subtasks_created: count('subtask_created'),
    comments: count('comment_added'),
    report_attached: count('report_attached') > 0,
    statuses_set: count('status_changed'),
    searches: count('web_search'),
    fetches: count('web_fetch'),
  }

  const result = {
    cell: cellName, rep, task_id: taskId, run_id: runId,
    dry_run: dry, config: cell,
    git_sha: execSync('git rev-parse --short HEAD', { cwd: REPO })
      .toString().trim(),
    started_at: startedIso,
    finished_at: new Date().toISOString(),
    wall_ms: wallMs,
    turns: outcome?.turns ?? null,
    stop_reason: outcome?.stopReason ?? null,
    status: runError ? 'error' : 'ok',
    error: runError,
    seed_check_ok: seed.ok,
    cache_hit_call1:
      (transcript.find((l) => l.kind === 'agent')?.usage
        ?.cache_read_input_tokens ?? 0) > 0,
    totals, behavior,
    final_task_tree: await getTask(taskId),
  }
  result.prefix_diff = runOnRepDir(repDir)
  fs.writeFileSync(
    path.join(repDir, 'result.json'), JSON.stringify(result, null, 2),
  )

  fs.appendFileSync(path.join(REPO, 'experiments', 'manifest.jsonl'),
    JSON.stringify({
      ts: startedIso, cell: cellName, rep, task_id: taskId, run_id: runId,
      dry_run: dry, status: result.status, wall_ms: wallMs,
      cost_usd: totals.cost_usd ?? totals.computed_cost_usd,
      api_calls: totals.api_calls, stop_reason: result.stop_reason,
      git_sha: result.git_sha,
    }) + '\n')

  console.log(
    `${cellName} rep-${rep} ${result.status}  calls=${totals.api_calls}` +
    ` stop=${result.stop_reason} wall=${Math.round(wallMs / 1000)}s` +
    ` cost=$${(totals.cost_usd ?? totals.computed_cost_usd).toFixed(4)}`,
  )
  if (runError) process.exit(1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
