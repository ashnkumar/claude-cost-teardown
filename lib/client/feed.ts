import type { AgentEvent } from '@/lib/agent/events'
import type { Assignee, TaskStatus } from '@/lib/types'

/** One line in the activity feed. Streamed deltas fold into a single entry. */
export type FeedEntry =
  | { kind: 'turn'; id: number; turn: number }
  | { kind: 'thinking'; id: number; text: string }
  | { kind: 'text'; id: number; text: string }
  | { kind: 'search'; id: number; query: string }
  | { kind: 'fetch'; id: number; url: string }
  | { kind: 'tool'; id: number; name: string; label: string }
  | { kind: 'subtask'; id: number; title: string; assignee: Assignee }
  | { kind: 'comment'; id: number; preview: string }
  | { kind: 'report'; id: number; sources: number }
  | { kind: 'status'; id: number; status: TaskStatus }
  | { kind: 'done'; id: number; turns: number }
  | { kind: 'error'; id: number; message: string }

/** Plain Omit collapses a union to its shared keys; this keeps each member. */
type NewEntry = FeedEntry extends infer T ? (T extends FeedEntry ? Omit<T, 'id'> : never) : never

let nextId = 0

/** Mutations the task tree needs to be refetched for. */
export function isMutation(event: AgentEvent): boolean {
  return (
    event.type === 'subtask_created' ||
    event.type === 'comment_added' ||
    event.type === 'task_updated' ||
    event.type === 'status_changed' ||
    event.type === 'report_attached' ||
    event.type === 'run_finished'
  )
}

export function appendEvent(entries: FeedEntry[], event: AgentEvent): FeedEntry[] {
  const last = entries[entries.length - 1]
  const push = (entry: NewEntry): FeedEntry[] => [
    ...entries,
    { ...entry, id: nextId++ } as FeedEntry,
  ]

  switch (event.type) {
    case 'run_started':
      return entries

    case 'turn_started':
      return push({ kind: 'turn', turn: event.turn })

    // Deltas coalesce into whichever entry is still open at the tail.
    case 'thinking_delta':
      if (last?.kind === 'thinking') {
        return [...entries.slice(0, -1), { ...last, text: last.text + event.text }]
      }
      return push({ kind: 'thinking', text: event.text })

    case 'text_delta':
      if (last?.kind === 'text') {
        return [...entries.slice(0, -1), { ...last, text: last.text + event.text }]
      }
      return push({ kind: 'text', text: event.text })

    case 'web_search':
      return push({ kind: 'search', query: event.query })

    case 'web_fetch':
      return push({ kind: 'fetch', url: event.url })

    case 'tool_use':
      return push({ kind: 'tool', name: event.name, label: event.label })

    case 'subtask_created':
      return push({ kind: 'subtask', title: event.title, assignee: event.assignee })

    case 'comment_added':
      return push({ kind: 'comment', preview: event.preview })

    case 'report_attached':
      return push({ kind: 'report', sources: event.sources })

    case 'status_changed':
      return push({ kind: 'status', status: event.status })

    case 'run_finished':
      return push({ kind: 'done', turns: event.turns })

    case 'error':
      return push({ kind: 'error', message: event.message })

    default:
      return entries
  }
}
