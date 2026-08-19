/**
 * The spend gate.
 *
 * Wraps the agent loop from the route. Before each request goes out, it prices
 * the WORST CASE — the input we are about to send, plus max_tokens of output —
 * and refuses the call if that would push the task past its ceiling.
 *
 * 🔴 The placement is the whole point. `runAgentLoop` takes no budget
 * parameter, and there is no budget tool in `lib/agent/tools.ts`. The agent
 * cannot call this, cannot skip it, and cannot raise its own ceiling — the
 * ceiling is not reachable from inside the loop at all. A check the agent can
 * call is a check the agent can decide not to call.
 *
 * The context travels via AsyncLocalStorage rather than a threaded argument,
 * which is what lets the loop stay ignorant of it.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * USD ceiling per task. Config, not code — and not reachable by the agent.
 *
 * 🔴 OFF by default. A measurement run has to be allowed to reach its
 * natural end, or the number it produces is a number about the gate rather
 * than about the run. Trip it deliberately by naming a ceiling:
 *
 *   DELEGATE_CEILING_USD=0.40 npm run dev
 *
 * The gate still runs on every call either way — it prices the worst case and
 * records the spend. It just has nothing to refuse against until you give it one.
 */
const CEILINGS: Record<string, number> = {}
const DEFAULT_CEILING = Infinity

/** Env override wins over everything, so a ceiling can be forced at run
 *  time without a code change. */
const OVERRIDE = Number(process.env.DELEGATE_CEILING_USD) || null

/** Same rates the meter uses. Input and output only — this is a projection. */
const RATES: Record<string, [number, number]> = {
  'claude-opus-5': [5, 25],
}

export class BudgetExceeded extends Error {
  constructor(
    readonly taskId: string,
    readonly projectedUsd: number,
    readonly ceilingUsd: number,
    readonly call: number,
  ) {
    super(
      `Gate refused call ${call}: projected $${projectedUsd.toFixed(2)} ` +
        `would exceed the ceiling of $${ceilingUsd.toFixed(2)} for ${taskId}.`,
    )
    this.name = 'BudgetExceeded'
  }
}

interface Budget {
  taskId: string
  ceilingUsd: number
  spentUsd: number
  /** The conversation only ever grows, so the last call's input is a floor
   *  for the next one's. Cheap, and it errs toward refusing. */
  lastInputTokens: number
  calls: number
}

const store = new AsyncLocalStorage<Budget>()

export function ceilingFor(taskId: string): number {
  return OVERRIDE ?? CEILINGS[taskId] ?? DEFAULT_CEILING
}

/**
 * Install a budget for one run. Everything the callback awaits — including
 * every call the agent loop makes — sees it.
 */
export function withSpendGate<T>(
  taskId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return store.run(
    {
      taskId,
      ceilingUsd: ceilingFor(taskId),
      spentUsd: 0,
      lastInputTokens: 0,
      calls: 0,
    },
    fn,
  )
}

/**
 * Called from the choke point BEFORE the request is sent.
 *
 * No gate installed → no-op, so the app still runs ungated unless a caller
 * explicitly wraps it.
 */
export function gateCheck(model: string, maxTokens: number): void {
  const b = store.getStore()
  if (!b) return

  const [inRate, outRate] = RATES[model] ?? [0, 0]
  const worstCase =
    (b.lastInputTokens * inRate + maxTokens * outRate) / 1_000_000
  const projected = b.spentUsd + worstCase

  if (projected > b.ceilingUsd) {
    throw new BudgetExceeded(b.taskId, projected, b.ceilingUsd, b.calls + 1)
  }
}

/** Called from the choke point AFTER a request returns. */
export function gateRecord(costUsd: number | null, inputTokens: number): void {
  const b = store.getStore()
  if (!b) return
  b.spentUsd += costUsd ?? 0
  b.lastInputTokens = Math.max(b.lastInputTokens, inputTokens)
  b.calls += 1
}

/** For the UI — what this run has spent, and against what. */
export function gateState(): { spentUsd: number; ceilingUsd: number } | null {
  const b = store.getStore()
  return b ? { spentUsd: b.spentUsd, ceilingUsd: b.ceilingUsd } : null
}
