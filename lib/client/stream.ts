import type { AgentEvent } from '@/lib/agent/events'

/**
 * POSTs to the run route and parses the SSE stream back.
 *
 * EventSource can only issue GETs, so the stream is read off the fetch body
 * directly and split on the blank-line frame boundary.
 */
export async function streamRun(
  taskId: string,
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch('/api/agents/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId }),
    signal,
  })

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '')
    throw new Error(detail || `Run failed with ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)

      if (frame.startsWith('data: ')) {
        onEvent(JSON.parse(frame.slice(6)) as AgentEvent)
      }
      boundary = buffer.indexOf('\n\n')
    }
  }
}
