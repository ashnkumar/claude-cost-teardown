import { Sparkles, User } from 'lucide-react'

import { cn } from '@/lib/utils'
import { STATUS_CLASS, STATUS_DOT, STATUS_LABEL } from '@/lib/ui'
import type { Assignee, TaskStatus } from '@/lib/types'

export function StatusChip({
  status,
  className,
}: {
  status: TaskStatus
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        STATUS_CLASS[status],
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', STATUS_DOT[status])} />
      {STATUS_LABEL[status]}
    </span>
  )
}

export function AssigneeChip({ assignee }: { assignee: Assignee }) {
  if (!assignee) return null

  if (assignee === 'agent') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-agent/40 bg-agent/10 px-2 py-0.5 text-[11px] font-medium text-agent">
        <Sparkles className="size-3" />
        Agent
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      <User className="size-3" />
      You
    </span>
  )
}

export function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
      {children}
    </span>
  )
}
