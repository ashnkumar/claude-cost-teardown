'use client'

import {
  Archive,
  CalendarDays,
  CheckCheck,
  CircleDot,
  Inbox,
  List,
  Zap,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { projectDots } from '@/lib/ui'
import type { Task } from '@/lib/types'

/**
 * Navigation chrome. Nothing here filters anything — the list always shows
 * everything. It exists so the frame reads as a tool someone actually uses,
 * and the counts are derived so none of it can drift out of sync with the data.
 */

const VIEWS = [
  { id: 'inbox', name: 'Inbox', icon: Inbox },
  { id: 'today', name: 'Today', icon: CalendarDays },
  { id: 'active', name: 'Active', icon: CircleDot },
  { id: 'backlog', name: 'Backlog', icon: Archive },
  { id: 'all', name: 'All Tasks', icon: List },
  { id: 'done', name: 'Done', icon: CheckCheck },
] as const

export const SELECTED_VIEW = 'All Tasks'

function today(): string {
  const now = new Date()
  now.setHours(12, 0, 0, 0)
  return now.toISOString().slice(0, 10)
}

function viewCounts(tasks: Task[]): Record<string, number> {
  const open = tasks.filter((task) => task.status !== 'done')
  const day = today()

  return {
    inbox: 0,
    today: open.filter((task) => task.dueDate !== null && task.dueDate <= day).length,
    active: open.filter((task) => task.section !== 'Backlog').length,
    backlog: open.filter((task) => task.section === 'Backlog').length,
    all: tasks.length,
    done: tasks.filter((task) => task.status === 'done').length,
  }
}

function projectCounts(tasks: Task[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const task of tasks) {
    if (!task.project) continue
    counts.set(task.project, (counts.get(task.project) ?? 0) + 1)
  }
  return [...counts]
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-2 pb-1.5 text-[10px] font-semibold tracking-[0.09em] text-muted-foreground/60 uppercase">
      {children}
    </p>
  )
}

function Item({
  label,
  count,
  active,
  icon,
  dot,
}: {
  label: string
  count?: number
  active?: boolean
  icon?: React.ReactNode
  dot?: string
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between rounded px-2 py-1.5 text-[13px] transition-colors',
        active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/40',
      )}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        {icon}
        {dot && <span className={cn('size-2 shrink-0 rounded-full', dot)} />}
        <span className="truncate">{label}</span>
      </span>

      {count !== undefined && count > 0 && (
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
          {count}
        </span>
      )}
    </div>
  )
}

export function NavRail({ tasks }: { tasks: Task[] }) {
  const counts = viewCounts(tasks)
  const projects = projectCounts(tasks)
  const dots = projectDots(tasks)

  return (
    <nav className="flex w-56 shrink-0 flex-col border-r border-border bg-card/30">
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
        <span className="flex size-6 items-center justify-center rounded-md bg-agent/15 text-agent">
          <Zap className="size-3.5" />
        </span>
        <span className="text-[15px] font-semibold tracking-tight text-foreground">
          Delegate
        </span>
      </div>

      <div className="scroll-quiet flex-1 overflow-y-auto px-2 pb-4">
        <Heading>Views</Heading>
        <div className="space-y-px">
          {VIEWS.map((view) => (
            <Item
              key={view.id}
              label={view.name}
              count={counts[view.id]}
              active={view.name === SELECTED_VIEW}
              icon={<view.icon className="size-4 shrink-0" />}
            />
          ))}
        </div>

        <div className="mt-5 border-t border-border pt-4">
          <Heading>Projects</Heading>
          <div className="space-y-px">
            {projects.map(([name, count]) => (
              <Item key={name} label={name} count={count} dot={dots[name]} />
            ))}
          </div>
        </div>
      </div>

      <p className="shrink-0 px-4 py-3 text-[11px] text-muted-foreground/50">v0.1.0</p>
    </nav>
  )
}
