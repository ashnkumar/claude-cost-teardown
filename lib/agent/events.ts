import type { Assignee, TaskStatus } from '@/lib/types'

/** Everything the loop emits. Serialised straight onto the SSE stream. */
export type AgentEvent =
  | { type: 'run_started'; runId: string; taskId: string }
  | { type: 'turn_started'; turn: number }
  | { type: 'thinking_delta'; text: string }
  | { type: 'text_delta'; text: string }
  | { type: 'web_search'; query: string }
  | { type: 'web_fetch'; url: string }
  | { type: 'tool_use'; name: string; label: string }
  | { type: 'subtask_created'; title: string; assignee: Assignee }
  | { type: 'comment_added'; preview: string }
  | { type: 'task_updated'; label: string }
  | { type: 'status_changed'; taskId: string; status: TaskStatus }
  | { type: 'report_attached'; sources: number }
  | { type: 'run_finished'; turns: number; stopReason: string | null }
  | { type: 'error'; message: string }

export type EmitFn = (event: AgentEvent) => void
