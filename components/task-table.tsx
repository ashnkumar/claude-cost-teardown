'use client'

import { useState } from 'react'
import {
  AlignLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CornerDownRight,
  Sparkles,
  User,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  PRIORITY_CELL,
  PRIORITY_LABEL,
  STATUS_CELL,
  STATUS_LABEL,
  formatDue,
  projectDots,
} from '@/lib/ui'
import type { Task } from '@/lib/types'

/**
 * Name flexes, everything else is fixed — that is what makes the columns line
 * up down the page instead of ragging, and the alignment is most of what reads
 * as "table" rather than "list of cards".
 */
const GRID = '16px minmax(240px,1fr) 116px 108px 92px 64px 88px'
const HEADERS = ['', 'Name', 'Project', 'Status', 'Assignee', 'Priority', 'Due']
const MIN_WIDTH = 'min-w-[900px]'

function countAll(tasks: Task[] = []): number {
  return tasks.reduce((sum, task) => sum + 1 + countAll(task.subtasks), 0)
}

function Pill({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium',
        className,
      )}
    >
      {children}
    </span>
  )
}

/** Groups in the order they first appear in the data. */
function groupBySection(tasks: Task[]): [string, Task[]][] {
  const groups = new Map<string, Task[]>()
  for (const task of tasks) {
    const key = task.section ?? 'Other'
    const group = groups.get(key)
    if (group) group.push(task)
    else groups.set(key, [task])
  }
  return [...groups]
}

function Row({
  task,
  dot,
  selected,
  onSelect,
}: {
  task: Task
  dot: string | undefined
  selected: boolean
  onSelect: (id: string) => void
}) {
  const done = task.status === 'done'
  const subtaskCount = countAll(task.subtasks)
  const due = formatDue(task.dueDate)

  return (
    <button
      type="button"
      onClick={() => onSelect(task.id)}
      style={{ gridTemplateColumns: GRID }}
      className={cn(
        `grid w-full ${MIN_WIDTH} items-center gap-3 border-b border-border/60 px-6 py-2 text-left text-[13px] transition-colors`,
        selected ? 'bg-agent/[0.07]' : 'hover:bg-muted/40',
        done && 'opacity-55',
      )}
    >
      <span className="flex items-center justify-center">
        {done ? (
          <CheckCircle2 className="size-3.5 text-emerald-400/80" />
        ) : (
          <Circle
            className={cn(
              'size-3.5 text-muted-foreground/50',
              task.status === 'in_progress' && 'text-sky-400/80',
            )}
          />
        )}
      </span>

      <span className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            'truncate',
            done ? 'text-muted-foreground line-through' : 'text-foreground/90',
          )}
        >
          {task.title}
        </span>

        {subtaskCount > 0 && (
          <span className="flex shrink-0 items-center gap-0.5 text-[11px] tabular-nums text-muted-foreground">
            <CornerDownRight className="size-3" />
            {subtaskCount}
          </span>
        )}

        {task.description && (
          <AlignLeft className="size-3 shrink-0 text-muted-foreground/50" />
        )}
      </span>

      <span className="flex min-w-0 items-center gap-2 text-[12px] text-muted-foreground">
        {task.project ? (
          <>
            <span className={cn('size-2 shrink-0 rounded-full', dot)} />
            <span className="truncate">{task.project}</span>
          </>
        ) : (
          <span className="text-muted-foreground/40">—</span>
        )}
      </span>

      <span>
        <Pill className={STATUS_CELL[task.status]}>{STATUS_LABEL[task.status]}</Pill>
      </span>

      <span>
        {task.assignee === 'agent' ? (
          <Pill className="bg-agent/15 text-agent">
            <Sparkles className="size-3" />
            Agent
          </Pill>
        ) : task.assignee === 'human' ? (
          <Pill className="bg-white/[0.06] text-muted-foreground">
            <User className="size-3" />
            You
          </Pill>
        ) : (
          <span className="text-muted-foreground/40">—</span>
        )}
      </span>

      <span>
        {task.priority ? (
          <Pill className={PRIORITY_CELL[task.priority]}>
            {PRIORITY_LABEL[task.priority]}
          </Pill>
        ) : (
          <span className="text-muted-foreground/40">—</span>
        )}
      </span>

      <span className="truncate text-[12px] tabular-nums text-muted-foreground">
        {due ?? <span className="text-muted-foreground/40">—</span>}
      </span>
    </button>
  )
}

export function TaskTable({
  tasks,
  selectedId,
  onSelect,
}: {
  tasks: Task[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [collapsed, setCollapsed] = useState<string[]>([])
  const dots = projectDots(tasks)

  const toggle = (section: string) =>
    setCollapsed((current) =>
      current.includes(section)
        ? current.filter((s) => s !== section)
        : [...current, section],
    )

  return (
    <div className="scroll-quiet h-full overflow-auto">
      <div
        style={{ gridTemplateColumns: GRID }}
        className={`sticky top-0 z-10 grid ${MIN_WIDTH} items-center gap-3 border-b border-border bg-background px-6 py-2 text-[11px] font-medium tracking-[0.06em] text-muted-foreground/70 uppercase`}
      >
        {HEADERS.map((label, i) => (
          <span key={i}>{label}</span>
        ))}
      </div>

      {groupBySection(tasks).map(([section, sectionTasks]) => {
        const open = !collapsed.includes(section)

        return (
          <div key={section}>
            <button
              type="button"
              onClick={() => toggle(section)}
              className={`flex w-full ${MIN_WIDTH} items-center gap-1.5 px-4 pt-5 pb-2 text-left`}
            >
              {open ? (
                <ChevronDown className="size-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="size-4 text-muted-foreground" />
              )}
              <span className="text-[14px] font-semibold text-foreground">{section}</span>
              <span className="ml-1 text-[12px] tabular-nums text-muted-foreground">
                {sectionTasks.length}
              </span>
            </button>

            {open &&
              sectionTasks.map((task) => (
                <Row
                  key={task.id}
                  task={task}
                  dot={task.project ? dots[task.project] : undefined}
                  selected={task.id === selectedId}
                  onSelect={onSelect}
                />
              ))}
          </div>
        )
      })}

      <div className="h-10" />
    </div>
  )
}
