// Trimming safety net. All context strategies work on CYCLES — an assistant
// message plus the user (tool_result) message that answers it, if any — so a
// derived view can never orphan a tool_result from its tool_use or split a
// server_tool_use from its result (those share one assistant message).
//
// validateView() re-proves that on every single request, dry or live. A
// strategy bug should die here, loudly, not as a cryptic API 400 mid-run.

/** messages -> { opener, cycles: [{ a, u? }] } */
export function segmentCycles(messages) {
  if (!messages.length || messages[0].role !== 'user') {
    throw new Error('segmentCycles: history must open with the user message')
  }
  const opener = messages[0]
  const cycles = []
  for (let i = 1; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.role === 'assistant') {
      cycles.push({ a: msg })
    } else if (msg.role === 'user') {
      const last = cycles[cycles.length - 1]
      if (!last || last.u) {
        throw new Error(`segmentCycles: user message at ${i} has no assistant`)
      }
      last.u = msg
    } else {
      throw new Error(`segmentCycles: unexpected role ${msg.role} at ${i}`)
    }
  }
  return { opener, cycles }
}

export const flattenCycles = (cycles) =>
  cycles.flatMap((c) => (c.u ? [c.a, c.u] : [c.a]))

const blocks = (msg) =>
  typeof msg.content === 'string'
    ? [{ type: 'text', text: msg.content }]
    : msg.content

/** Throws unless `view` is a structurally valid request history. */
export function validateView(view, { isClientTool }) {
  if (!view.length || view[0].role !== 'user') {
    throw new Error('validateView: view must open with a user message')
  }
  for (let i = 1; i < view.length; i++) {
    const msg = view[i]
    if (msg.role === 'user') {
      // Consecutive plain user messages are legal (the API merges them);
      // only tool_results demand the assistant message directly before.
      const results = blocks(msg).filter((b) => b.type === 'tool_result')
      if (results.length) {
        const prev = view[i - 1]
        if (prev.role !== 'assistant') {
          throw new Error(`validateView: tool_result at ${i} follows user`)
        }
        const uses = new Set(
          blocks(prev).filter((b) => b.type === 'tool_use').map((b) => b.id),
        )
        for (const b of results) {
          if (!uses.has(b.tool_use_id)) {
            throw new Error(
              `validateView: orphaned tool_result ${b.tool_use_id} at ${i}`,
            )
          }
        }
      }
    }
    if (msg.role === 'assistant' && i < view.length - 1) {
      const clientUses = blocks(msg)
        .filter((b) => b.type === 'tool_use' && isClientTool(b.name))
        .map((b) => b.id)
      if (clientUses.length) {
        const next = view[i + 1]
        const answered = new Set(
          next.role === 'user'
            ? blocks(next)
                .filter((b) => b.type === 'tool_result')
                .map((b) => b.tool_use_id)
            : [],
        )
        for (const id of clientUses) {
          if (!answered.has(id)) {
            throw new Error(
              `validateView: unanswered client tool_use ${id} at ${i}`,
            )
          }
        }
      }
    }
  }
  return true
}
