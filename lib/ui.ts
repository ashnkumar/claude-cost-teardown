import type { Level, Task, TaskStatus } from '@/lib/types'

export const STATUS_LABEL: Record<TaskStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  waiting: 'Waiting',
  needs_review: 'Needs review',
  done: 'Done',
}

/** Border + text + tint, one line per status. */
export const STATUS_CLASS: Record<TaskStatus, string> = {
  not_started: 'border-border text-muted-foreground',
  in_progress: 'border-sky-500/35 text-sky-300 bg-sky-500/10',
  waiting: 'border-amber-500/35 text-amber-300 bg-amber-500/10',
  needs_review: 'border-agent/45 text-agent bg-agent/10',
  done: 'border-emerald-500/35 text-emerald-300 bg-emerald-500/10',
}

export const STATUS_DOT: Record<TaskStatus, string> = {
  not_started: 'bg-muted-foreground/40',
  in_progress: 'bg-sky-400',
  waiting: 'bg-amber-400',
  needs_review: 'bg-agent',
  done: 'bg-emerald-400',
}

/**
 * Table cells use flat tinted pills rather than the bordered chips the detail
 * pane uses — at row density a border on every cell turns into a grid.
 */
export const STATUS_CELL: Record<TaskStatus, string> = {
  not_started: 'bg-white/[0.06] text-muted-foreground',
  in_progress: 'bg-sky-500/15 text-sky-300',
  waiting: 'bg-amber-500/15 text-amber-300',
  needs_review: 'bg-agent/15 text-agent',
  done: 'bg-emerald-500/12 text-emerald-300/90',
}

export const PRIORITY_LABEL: Record<Level, string> = {
  low: 'Low',
  medium: 'Med',
  high: 'High',
}

export const PRIORITY_CELL: Record<Level, string> = {
  low: 'bg-emerald-500/12 text-emerald-300/90',
  medium: 'bg-amber-500/12 text-amber-300/90',
  high: 'bg-red-500/12 text-red-300',
}

const PROJECT_DOTS = ['bg-violet-400', 'bg-sky-400', 'bg-amber-400', 'bg-emerald-400']

/**
 * Project → dot colour, assigned in the order projects first appear. Derived
 * rather than configured so the rail and the table always agree, whatever the
 * seed happens to contain.
 */
export function projectDots(tasks: Task[]): Record<string, string> {
  const dots: Record<string, string> = {}
  let next = 0

  for (const task of tasks) {
    if (!task.project || dots[task.project]) continue
    dots[task.project] = PROJECT_DOTS[next++ % PROJECT_DOTS.length]
  }
  return dots
}

/**
 * Near dates read as words, everything else as a date. Overdue is deliberately
 * not called out in red — the seed rolls forward, and a red column on a demo
 * reads as broken data rather than as urgency.
 */
export function formatDue(iso: string | null): string | null {
  if (!iso) return null

  const due = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(due.getTime())) return null

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'

  return due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function formatTime(minutes: number | null): string | null {
  if (!minutes) return null
  return minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
