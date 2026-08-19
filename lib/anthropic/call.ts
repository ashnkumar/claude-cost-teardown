/**
 * callClaude() — the single choke point.
 *
 * Every request this application makes to Anthropic goes through this function.
 * Nothing else in the repo constructs an Anthropic client or builds a request,
 * and nothing else is allowed to: if you need a new call site, call this.
 *
 * That constraint is the point. One function means one place to add retries,
 * one place to add logging, one place to add a usage meter — and one place
 * where every model binding is written down.
 */
import Anthropic from '@anthropic-ai/sdk'
import { gateCheck, gateRecord } from '@/lib/gate'
import { costUsd, recordUsage } from './usage'

const client = new Anthropic()

const NO_USAGE = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  web_search_requests: 0,
  web_fetch_requests: 0,
}

// ── Model bindings ──────────────────────────────────────────────────────────

export const MODEL = 'claude-opus-5'

export const MAX_TOKENS = 64_000

/**
 * Never set thinking to `disabled` on Opus 5. There is a documented failure
 * mode where the model narrates a tool call as plain text instead of emitting
 * a tool_use block — the call silently never runs and the loop just stops.
 * `summarized` also means the UI has something to show instead of a long pause.
 */
export const THINKING = { type: 'adaptive', display: 'summarized' } as const

/**
 * Named rather than inlined so a campaign can sweep it without going hunting.
 * 'high' is the default; the ladder is low | medium | high | xhigh | max.
 */
export const EFFORT = 'high' as const

// ── The choke point ─────────────────────────────────────────────────────────

export interface CallContext {
  taskId: string
  runId: string
  onText?: (delta: string) => void
  onThinking?: (delta: string) => void
  signal?: AbortSignal
}

export async function callClaude(
  req: Anthropic.MessageStreamParams,
  ctx: CallContext,
): Promise<Anthropic.Message> {
  const startedAt = Date.now()
  const meta = { task_id: ctx.taskId, run_id: ctx.runId, model: req.model }

  // The gate, if one is installed. Throws before the request is made — the
  // refused call never reaches Anthropic and is never billed.
  gateCheck(req.model, req.max_tokens)

  const stream = client.messages.stream(req, { signal: ctx.signal })

  stream.on('text', (delta) => ctx.onText?.(delta))
  stream.on('thinking', (delta) => ctx.onThinking?.(delta))

  // The container arrives on the message_delta event and the SDK's streaming
  // accumulator does not copy it onto the final message — it is only there on
  // the non-streaming create(). Later turns need it, so keep it here.
  let container: Anthropic.Container | null = null
  stream.on('streamEvent', (event) => {
    if (event.type === 'message_delta' && event.delta.container) {
      container = event.delta.container
    }
  })

  let message: Anthropic.Message
  try {
    message = await stream.finalMessage()
  } catch (err) {
    const latency_ms = Date.now() - startedAt
    void recordUsage({ ...meta, ...NO_USAGE, latency_ms, status: 'error' })
    throw err
  }

  // server_tool_use is where web search hides. It is billed per request,
  // outside the four token fields, and it is null on any call that ran none.
  const serverTools = message.usage.server_tool_use

  const fields = {
    input_tokens: message.usage.input_tokens,
    output_tokens: message.usage.output_tokens,
    cache_creation_input_tokens:
      message.usage.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: message.usage.cache_read_input_tokens ?? 0,
    web_search_requests: serverTools?.web_search_requests ?? 0,
    web_fetch_requests: serverTools?.web_fetch_requests ?? 0,
  }

  gateRecord(costUsd(req.model, fields, fields), fields.input_tokens)

  void recordUsage({
    ...meta,
    latency_ms: Date.now() - startedAt,
    status: 'ok',
    stop_reason: message.stop_reason,
    ...fields,
  })

  return { ...message, container: container ?? message.container }
}
