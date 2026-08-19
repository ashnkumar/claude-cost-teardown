// The four context-management cells: what people do to a growing agent
// conversation to "save money". Canonical history is append-only and owned by
// the loop; each strategy derives a per-call VIEW. Views are validated on
// every call, and canonical messages are never mutated — droptools deep-copies
// the blocks it elides.
import {
  segmentCycles, flattenCycles,
} from './validate-view.mjs'
import { fileURLToPath } from 'node:url'

export const WINDOW_CYCLES = 4     // window: opener + last N cycles
export const DROPTOOLS_KEEP = 2    // droptools: last K cycles stay verbatim
export const COMPACT_EVERY = 6     // compact: fire when this many uncovered
export const COMPACT_KEEP = 2      //          cycles, keep last K verbatim

/* ---------------------------------------------------------------- droptools
 * The token whale is the fetched-page document riding inside old assistant
 * messages (max_content_tokens is unset in the app's code). Elide that text
 * and old client tool_result bodies; keep block structure, ids, and urls so
 * tool pairing and later web_fetch url-lineage stay intact. Search results
 * are never touched — their encrypted_content must round-trip.
 */
function elideFetchDoc(block) {
  const src = block?.content?.content?.source
  if (typeof src?.data !== 'string' || src.data.length < 400) return block
  const clone = structuredClone(block)
  clone.content.content.source.data =
    `[document elided by droptools: ${src.data.length} chars. ` +
    `URL is preserved in this block.]`
  return clone
}

function elideCycle(cycle) {
  const a = {
    ...cycle.a,
    content: cycle.a.content.map((b) =>
      b.type === 'web_fetch_tool_result' ? elideFetchDoc(b) : b,
    ),
  }
  const out = { a }
  if (cycle.u) {
    out.u = {
      ...cycle.u,
      content: cycle.u.content.map((b) =>
        b.type === 'tool_result'
          ? { ...b, content: '[tool result elided by droptools]' }
          : b,
      ),
    }
  }
  return out
}

/* ------------------------------------------------------------------ compact
 * Serialize old cycles to plain text (fetched docs truncated, urls kept),
 * have the model summarize, then present [opener, summary, recent cycles].
 * The summarizer call routes through the injected callFn so its cost lands
 * in usage.jsonl under `${runId}#summary` — compaction's bill is part of
 * compaction's result.
 */
const clip = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s)

function serializeForSummary(opener, cycles) {
  const lines = [`USER TASK:\n${clip(String(opener.content), 4000)}`]
  for (const msg of flattenCycles(cycles)) {
    for (const b of typeof msg.content === 'string'
      ? [{ type: 'text', text: msg.content }]
      : msg.content) {
      if (b.type === 'text') lines.push(`${msg.role}: ${clip(b.text, 2000)}`)
      else if (b.type === 'tool_use' || b.type === 'server_tool_use') {
        lines.push(`${b.name}(${clip(JSON.stringify(b.input), 600)})`)
      } else if (b.type === 'web_fetch_tool_result') {
        const url = b.content?.url ?? 'unknown'
        const doc = b.content?.content?.source?.data ?? ''
        lines.push(`fetched ${url}: ${clip(String(doc), 1200)}`)
      } else if (b.type === 'web_search_tool_result') {
        const hits = Array.isArray(b.content)
          ? b.content.map((r) => r.url).filter(Boolean).join(' ')
          : ''
        lines.push(`search results: ${clip(hits, 800)}`)
      } else if (b.type === 'tool_result') {
        lines.push(`result: ${clip(JSON.stringify(b.content), 400)}`)
      }
      // thinking blocks are dropped from the summary input on purpose
    }
  }
  return lines.join('\n')
}

const SUMMARIZER_SYSTEM =
  'You compact an agent transcript so the agent can resume seamlessly. ' +
  'Write a dense summary: decisions made, subtask ids/titles/statuses, ' +
  'findings with their numbers, and EVERY url mentioned, verbatim. ' +
  'No preamble.'

async function summarize(opener, cycles, io) {
  const req = {
    model: io.MODEL,
    max_tokens: 3000,
    output_config: { effort: 'low' },
    system: [{ type: 'text', text: SUMMARIZER_SYSTEM }],
    messages: [{
      role: 'user',
      content: serializeForSummary(opener, cycles),
    }],
  }
  const started = Date.now()
  const res = await io.callFn(req, {
    taskId: io.taskId,
    runId: `${io.runId}#summary`,
  })
  io.record?.({
    turn: io.turn, kind: 'summarizer', request: req, response: res,
    usage: res.usage, latency_ms: Date.now() - started,
  })
  return res.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
}

const summaryMessage = (summary) => ({
  role: 'user',
  content: [{
    type: 'text',
    text:
      '[The conversation so far was compacted to save tokens. ' +
      'Summary of everything before this point:]\n\n' + summary,
  }],
})

/* -------------------------------------------------------------- strategies */
export const CONTEXT = {
  append: {
    makeState: () => ({}),
    view: (messages) => messages,
  },

  window: {
    makeState: () => ({}),
    view: (messages) => {
      const { opener, cycles } = segmentCycles(messages)
      if (cycles.length <= WINDOW_CYCLES) return messages
      return [opener, ...flattenCycles(cycles.slice(-WINDOW_CYCLES))]
    },
  },

  droptools: {
    makeState: () => ({}),
    view: (messages) => {
      const { opener, cycles } = segmentCycles(messages)
      if (cycles.length <= DROPTOOLS_KEEP) return messages
      const old = cycles.slice(0, -DROPTOOLS_KEEP).map(elideCycle)
      const recent = cycles.slice(-DROPTOOLS_KEEP)
      return [opener, ...flattenCycles([...old, ...recent])]
    },
  },

  // The measured fix for droptools' state destruction: client tool_results
  // are tiny and hold the only copy of the subtask ids — keep them verbatim,
  // elide only the fetched-document whales.
  droptools2: {
    makeState: () => ({}),
    view: (messages) => {
      const { opener, cycles } = segmentCycles(messages)
      if (cycles.length <= DROPTOOLS_KEEP) return messages
      const old = cycles.slice(0, -DROPTOOLS_KEEP).map((c) => ({
        a: {
          ...c.a,
          content: c.a.content.map((b) =>
            b.type === 'web_fetch_tool_result' ? elideFetchDoc(b) : b,
          ),
        },
        ...(c.u ? { u: c.u } : {}),
      }))
      const recent = cycles.slice(-DROPTOOLS_KEEP)
      return [opener, ...flattenCycles([...old, ...recent])]
    },
  },

  compact: {
    makeState: () => ({ summary: null, covered: 0 }),
    beforeCall: async (messages, state, io) => {
      const { opener, cycles } = segmentCycles(messages)
      if (cycles.length - state.covered < COMPACT_EVERY) return
      if (cycles.length <= COMPACT_KEEP) return
      const target = cycles.slice(0, -COMPACT_KEEP)
      state.summary = await summarize(opener, target, io)
      state.covered = target.length
    },
    view: (messages, state) => {
      if (!state.summary) return messages
      const { opener, cycles } = segmentCycles(messages)
      return [
        opener,
        summaryMessage(state.summary),
        ...flattenCycles(cycles.slice(state.covered)),
      ]
    },
  },
}

/* ---------------------------------------------------------------- self-test */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { validateView } = await import('./validate-view.mjs')
  const isClientTool = (n) => n.startsWith('client_')

  const doc = 'x'.repeat(5000)
  const fixture = [{ role: 'user', content: 'do the task' }]
  let id = 0
  const clientCycle = () => {
    id += 1
    return [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'hmm', signature: 'sig' },
          { type: 'tool_use', id: `t${id}`, name: 'client_x', input: { id } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: `t${id}`, content: '{"ok":1}' },
        ],
      },
    ]
  }
  fixture.push(...clientCycle())
  fixture.push({
    role: 'assistant',
    content: [
      { type: 'server_tool_use', id: 's1', name: 'web_fetch',
        input: { url: 'https://ex.com' } },
      { type: 'web_fetch_tool_result', tool_use_id: 's1',
        content: {
          type: 'web_fetch_result', url: 'https://ex.com',
          content: { type: 'document', source: { type: 'text', data: doc } },
        } },
    ],
  })
  for (let i = 0; i < 5; i++) fixture.push(...clientCycle())
  const before = JSON.stringify(fixture)

  const windowView = CONTEXT.window.view(fixture)
  validateView(windowView, { isClientTool })
  if (windowView.length >= fixture.length) throw new Error('window: no shrink')

  const dtView = CONTEXT.droptools.view(fixture)
  validateView(dtView, { isClientTool })
  if (!JSON.stringify(dtView).includes('elided by droptools')) {
    throw new Error('droptools: nothing elided')
  }
  if (JSON.stringify(dtView).length >= before.length) {
    throw new Error('droptools: view did not shrink')
  }

  const state = CONTEXT.compact.makeState()
  await CONTEXT.compact.beforeCall(fixture, state, {
    MODEL: 'stub', taskId: 't', runId: 'r', turn: 1,
    callFn: async () => ({
      content: [{ type: 'text', text: 'SUMMARY: did things. https://ex.com' }],
      usage: {},
    }),
  })
  if (!state.summary) throw new Error('compact: did not fire')
  const cView = CONTEXT.compact.view(fixture, state)
  validateView(cView, { isClientTool })
  if (!JSON.stringify(cView).includes('compacted to save tokens')) {
    throw new Error('compact: summary message missing')
  }
  if (cView.length >= fixture.length) throw new Error('compact: no shrink')

  if (JSON.stringify(fixture) !== before) {
    throw new Error('canonical history was mutated')
  }
  console.log(
    `views  window=${windowView.length} droptools=${dtView.length} ` +
    `compact=${cView.length} canonical=${fixture.length} msgs`,
  )
  console.log('strategies-context.mjs self-test OK')
}
