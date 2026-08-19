// The experiment loop — a faithful clone of lib/agent/loop.ts semantics with
// two seams the app's loop deliberately lacks: a caching strategy (how the
// system blocks and cache markers are laid out) and a context strategy (what
// slice of history each request carries). The app's files stay untouched;
// every request still flows through the real callClaude when live.
import {
  buildOpeningMessage, executeClientTool, isClientTool, splitSystem,
  buildSystem, openSubtaskTitles, MODEL, MAX_TOKENS, THINKING, EFFORT, TOOLS,
} from './repo.mjs'
import { validateView } from './validate-view.mjs'

const MAX_TURNS = 200

function labelFor(toolUse) {
  const input = toolUse.input ?? {}
  switch (toolUse.name) {
    case 'create_subtasks': return `${input.subtasks?.length ?? 0} subtasks`
    case 'update_task': return input.status ?? 'fields'
    case 'add_comment': return input.body?.slice(0, 60) ?? ''
    case 'attach_report': return 'report'
    default: return ''
  }
}

function emitServerToolUse(content, onEvent) {
  for (const block of content) {
    if (block.type !== 'server_tool_use') continue
    const input = block.input ?? {}
    if (block.name === 'web_search' && input.query) {
      onEvent({ type: 'web_search', query: input.query })
    } else if (block.name === 'web_fetch' && input.url) {
      onEvent({ type: 'web_fetch', url: input.url })
    }
  }
}

export async function runHarnessLoop(task, opts) {
  const {
    cache, context, callFn, onEvent, record, fetchcap, effort, model,
  } = opts
  const MODEL_USED = model ?? MODEL
  const runId = opts.runId ?? `run-${Date.now().toString(36)}`
  onEvent({ type: 'run_started', runId, taskId: task.id })

  // fetchcap cell: cap fetched-page size at the server, per request — the
  // app's tools.ts (which deliberately omits the cap) stays untouched.
  const tools = fetchcap
    ? TOOLS.map((t) =>
        t.name === 'web_fetch' ? { ...t, max_content_tokens: fetchcap } : t)
    : TOOLS

  // volatileInOpener cells freeze the run context (date, run id, task,
  // subtask state) into the opening message ONCE — nothing above the
  // conversation may change per call, or the conversation cache dies.
  let opener = buildOpeningMessage(task)
  if (cache.volatileInOpener) {
    const parts0 = splitSystem(
      buildSystem(task, runId, await openSubtaskTitles(task.id)),
    )
    opener += `\n\n[Run context]\n${parts0.volatile}`
  }
  const messages = [{ role: 'user', content: opener }]
  const state = context.makeState()
  let containerId = null
  let turns = 0
  let stopReason = null
  let callIndex = 0

  while (turns < MAX_TURNS) {
    turns += 1
    onEvent({ type: 'turn_started', turn: turns })

    await context.beforeCall?.(messages, state, {
      callFn, record, MODEL, taskId: task.id, runId, turn: turns,
    })

    const view = context.view(messages, state)
    validateView(view, { isClientTool })

    // Rebuilt every call, exactly like the app's loop — the volatile lines
    // (date, open subtasks) are meant to churn; the cache cell decides where
    // they sit relative to the marker.
    const parts = splitSystem(
      buildSystem(task, runId, await openSubtaskTitles(task.id)),
    )

    const req = {
      model: MODEL_USED,
      max_tokens: MAX_TOKENS,
      thinking: THINKING,
      // The one lever that touches OUTPUT tokens — the biggest bucket left
      // once caching is composed correctly, and flat across every context
      // tactic we ran. Defaults to the app's value; cells may override.
      output_config: { effort: effort ?? EFFORT },
      system: cache.system(parts),
      tools,
      messages: view,
      ...(containerId ? { container: containerId } : {}),
      ...(cache.topLevel ? { cache_control: { type: 'ephemeral' } } : {}),
    }

    const started = Date.now()
    let message
    try {
      message = await callFn(req, {
        taskId: task.id,
        runId,
        onText: (text) => onEvent({ type: 'text_delta', text }),
        onThinking: (text) => onEvent({ type: 'thinking_delta', text }),
      })
    } catch (error) {
      callIndex += 1
      record({
        turn: turns, call_index: callIndex, kind: 'agent', request: req,
        error: error instanceof Error ? error.message : String(error),
        latency_ms: Date.now() - started,
      })
      onEvent({ type: 'error', message: String(error?.message ?? error) })
      throw error
    }
    callIndex += 1
    record({
      turn: turns, call_index: callIndex, kind: 'agent', request: req,
      response: message, usage: message.usage,
      latency_ms: Date.now() - started,
    })

    stopReason = message.stop_reason
    containerId = message.container?.id ?? containerId
    emitServerToolUse(message.content, onEvent)

    messages.push({ role: 'assistant', content: message.content })

    if (message.stop_reason === 'pause_turn') continue
    if (message.stop_reason !== 'tool_use') break

    const toolUses = message.content.filter(
      (block) => block.type === 'tool_use' && isClientTool(block.name),
    )

    // Server-tool turn still working in its container: resume, don't end.
    if (toolUses.length === 0) {
      if (message.content.some((b) => b.type === 'server_tool_use')) continue
      break
    }

    const toolResults = []
    for (const toolUse of toolUses) {
      onEvent({ type: 'tool_use', name: toolUse.name, label: labelFor(toolUse) })
      try {
        const result = await executeClientTool(
          toolUse.name, toolUse.input, onEvent,
        )
        toolResults.push({
          type: 'tool_result', tool_use_id: toolUse.id, content: result,
        })
      } catch (error) {
        toolResults.push({
          type: 'tool_result', tool_use_id: toolUse.id,
          content: error instanceof Error ? error.message : String(error),
          is_error: true,
        })
      }
    }
    // Live run context enters as NEW content at the bottom of the newest
    // message — never as an edit to anything already sent — so every earlier
    // turn still cache-hits.
    //
    // It rides INSIDE the last tool_result, not as a sibling text block. A
    // user message carrying anything but tool_results ends the turn, which
    // strands any server tool the assistant left running: across 46 runs,
    // pending server tools resolved 88/91 times after a tool_result-only
    // reply and 0/2 times after one carrying a text block. Same tokens, same
    // position, no fabricated user turn.
    if (cache.volatileEachTurn && toolResults.length) {
      const { volatile } = splitSystem(
        buildSystem(task, runId, await openSubtaskTitles(task.id)),
      )
      const last = toolResults[toolResults.length - 1]
      const body = typeof last.content === 'string'
        ? [{ type: 'text', text: last.content }]
        : last.content
      last.content = [
        ...body, { type: 'text', text: `[Run context]\n${volatile}` },
      ]
    }
    messages.push({ role: 'user', content: toolResults })
  }

  onEvent({ type: 'run_finished', turns, stopReason })
  return { runId, turns, stopReason, calls: callIndex }
}
