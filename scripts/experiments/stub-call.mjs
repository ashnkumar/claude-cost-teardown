// Drop-in replacement for callClaude in dry mode. Injected as the loop's
// callFn parameter — the real client is simply never imported, so a dry run
// needs no API key and costs nothing.
export function makeStubCall(script) {
  let i = 0
  return async function stubCall(req, ctx) {
    if (!req?.model || !Array.isArray(req.messages) || !req.system) {
      throw new Error('stubCall: malformed request')
    }
    // compact's summarizer (tool-less, 3000-token cap) must not eat the
    // agent script — answer it with a canned summary instead.
    if (!req.tools && req.max_tokens === 3000) {
      return {
        id: 'msg_drysum', type: 'message', role: 'assistant',
        model: 'dry-run-stub', stop_reason: 'end_turn',
        content: [{ type: 'text',
          text: 'DRY SUMMARY: six subtasks exist; fetched ' +
                'https://example.com/a; work in progress.' }],
        usage: {
          input_tokens: 1000, output_tokens: 90,
          cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
        },
      }
    }
    const next = script[i++]
    if (!next) throw new Error(`stubCall: script exhausted at call ${i}`)
    ctx?.onText?.('.')
    return structuredClone(next)
  }
}
