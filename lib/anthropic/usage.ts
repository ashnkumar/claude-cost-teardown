/**
 * One JSON line per Anthropic request, appended to runs/usage.jsonl.
 *
 * Every number the dashboard shows is derived from what the API reported and
 * the published per-million rates. Nothing here estimates tokens — if the API
 * didn't report it, it isn't recorded.
 */
import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

const DIR = path.join(process.cwd(), 'runs')
const FILE = path.join(DIR, 'usage.jsonl')

/** USD per million tokens. Cache write is 5-minute ephemeral (1.25x
 *  input); cache read is 0.1x input. */
const RATES: Record<string, [number, number, number, number]> = {
  // model: [input, output, cacheWrite, cacheRead]
  'claude-opus-5': [5, 25, 6.25, 0.5],
}

/**
 * Web search bills per request at $10 / 1,000 — OUTSIDE the four token fields,
 * reported separately under usage.server_tool_use. Web fetch carries no
 * surcharge; it costs only the tokens it drags into the context.
 *
 * This is the one line item "read the four fields" does not cover, which is
 * exactly why it belongs on the dashboard rather than quietly missing from it.
 */
const SEARCH_USD = 10 / 1000

export interface UsageFields {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
}

export interface ServerToolFields {
  web_search_requests: number
  web_fetch_requests: number
}

/**
 * Returns null for a model we hold no published rate for — not 0.
 *
 * A meter that reports $0.00 because it failed to recognise something is the
 * precise failure this application exists to talk about. Unpriced calls
 * surface on the dashboard as unpriced.
 */
export function costUsd(
  model: string,
  u: UsageFields,
  s?: ServerToolFields,
): number | null {
  const rate = RATES[model]
  if (!rate) return null
  const [i, o, cw, cr] = rate
  const tokens =
    (u.input_tokens * i +
      u.output_tokens * o +
      u.cache_creation_input_tokens * cw +
      u.cache_read_input_tokens * cr) /
    1_000_000
  return tokens + (s?.web_search_requests ?? 0) * SEARCH_USD
}

export interface UsageRecord extends UsageFields, ServerToolFields {
  ts: string
  task_id: string
  run_id: string
  model: string
  latency_ms: number
  status: 'ok' | 'error'
  /** Why the model stopped. The only field that explains a short run. */
  stop_reason?: string | null
  /** null = no published rate for this model. Deliberately not zero. */
  cost_usd: number | null
}

export async function recordUsage(
  rec: Omit<UsageRecord, 'ts' | 'cost_usd'>,
): Promise<void> {
  const line: UsageRecord = {
    ts: new Date().toISOString(),
    ...rec,
    cost_usd: costUsd(rec.model, rec, rec),
  }
  try {
    await mkdir(DIR, { recursive: true })
    await appendFile(FILE, JSON.stringify(line) + '\n')
  } catch {
    // Metering must never take the run down with it.
  }
}
