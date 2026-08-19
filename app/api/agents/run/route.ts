import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

import type { NextRequest } from 'next/server'

import type { AgentEvent } from '@/lib/agent/events'
import { runAgentLoop } from '@/lib/agent/loop'
import { withSpendGate } from '@/lib/gate'
import { getTask, updateTask } from '@/lib/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TRACE = path.join(process.cwd(), 'runs', 'trace.jsonl')

async function appendTrace(event: AgentEvent): Promise<void> {
  try {
    await mkdir(path.dirname(TRACE), { recursive: true })
    await appendFile(
      TRACE,
      JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n',
    )
  } catch {
    // Tracing must never take the run down with it.
  }
}

/**
 * POST /api/agents/run — deploy the agent onto a task.
 *
 * Streams the run back as server-sent events so the UI can show the work
 * happening rather than a spinner and then a wall of results.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const { taskId } = (await req.json()) as { taskId?: string }
  if (!taskId) {
    return Response.json({ error: 'taskId is required' }, { status: 400 })
  }

  const task = await getTask(taskId)
  if (!task) {
    return Response.json({ error: `No such task: ${taskId}` }, { status: 404 })
  }

  // Move it before the first token so the click feels instant.
  await updateTask(taskId, { status: 'in_progress' })

  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const send = (event: AgentEvent) => {
        // Tee every event to runs/trace.jsonl. Nothing in the app reads it —
        // it exists so a run can be inspected after the fact without sitting
        // and watching the feed, and so a failed run can be diagnosed.
        void appendTrace(event)
        if (closed) return
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }

      send({ type: 'status_changed', taskId, status: 'in_progress' })

      try {
        // The gate sits OUTSIDE the loop. The agent has no tool to check it,
        // no way to skip it, and no way to raise its own ceiling — everything
        // it can reach is inside the inner function.
        const result = await withSpendGate(taskId, () =>
          runAgentLoop(task, { onEvent: send, signal: req.signal }),
        )

        send({ type: 'run_finished', turns: result.turns, stopReason: result.stopReason })
      } catch (error) {
        send({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      } finally {
        closed = true
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
