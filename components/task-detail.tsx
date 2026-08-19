'use client'

import { BookOpen, Clock, Gauge, Link2, LoaderCircle, Sparkles, User, Zap } from 'lucide-react'

import { AssigneeChip, MetaChip, StatusChip } from '@/components/chips'
import { Markdown } from '@/components/markdown'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { STATUS_DOT, formatTime, hostOf } from '@/lib/ui'
import type { Task } from '@/lib/types'

function Section({
  title,
  count,
  children,
}: {
  title: string
  count?: number
  children: React.ReactNode
}) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {title}
        </h3>
        {count !== undefined && count > 0 && (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
            {count}
          </span>
        )}
      </div>
      {children}
    </section>
  )
}

function SubtaskRow({ task, depth }: { task: Task; depth: number }) {
  const time = formatTime(task.timeEstimate)

  return (
    <>
      <div
        className="flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/40"
        style={{ marginLeft: depth * 20 }}
      >
        <span
          className={cn(
            'mt-[7px] size-2 shrink-0 rounded-full',
            STATUS_DOT[task.status],
            task.status === 'in_progress' && 'animate-pulse',
          )}
        />

        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'text-[13.5px] leading-snug',
              task.status === 'done'
                ? 'text-muted-foreground line-through decoration-muted-foreground/40'
                : 'text-foreground',
            )}
          >
            {task.title}
          </p>

          {task.description && (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {task.description}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <AssigneeChip assignee={task.assignee} />
            {task.priority && <MetaChip>{task.priority} priority</MetaChip>}
            {time && (
              <MetaChip>
                <Clock className="size-3" />
                {time}
              </MetaChip>
            )}
            {task.taskType.slice(0, 2).map((type) => (
              <MetaChip key={type}>{type}</MetaChip>
            ))}
          </div>
        </div>
      </div>

      {task.subtasks?.map((child) => (
        <SubtaskRow key={child.id} task={child} depth={depth + 1} />
      ))}
    </>
  )
}

export function TaskDetail({
  task,
  running,
  onDeploy,
}: {
  task: Task
  running: boolean
  onDeploy: () => void
}) {
  const time = formatTime(task.timeEstimate)
  const subtasks = task.subtasks ?? []

  return (
    <div className="scroll-quiet h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-10 py-9">
        <div className="flex items-start justify-between gap-8">
          <div className="min-w-0">
            <h1 className="text-[26px] leading-tight font-semibold tracking-tight text-balance text-foreground">
              {task.title}
            </h1>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <StatusChip status={task.status} />
              <AssigneeChip assignee={task.assignee} />
              {task.priority && (
                <MetaChip>
                  <Gauge className="size-3" />
                  {task.priority}
                </MetaChip>
              )}
              {time && (
                <MetaChip>
                  <Clock className="size-3" />
                  {time}
                </MetaChip>
              )}
              {task.report && (
                <MetaChip>
                  <BookOpen className="size-3" />
                  Report
                </MetaChip>
              )}
            </div>
          </div>

          <Button
            onClick={onDeploy}
            disabled={running}
            size="lg"
            className="shrink-0 gap-2 bg-agent text-white hover:bg-agent/90"
          >
            {running ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                Running
              </>
            ) : (
              <>
                <Zap className="size-4" />
                Deploy
              </>
            )}
          </Button>
        </div>

        {task.needsHumanReview && (
          <div className="mt-6 rounded-lg border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-200">
            The agent is blocked and left a question below.
          </div>
        )}

        {task.description && (
          <p className="mt-6 text-[14px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {task.description}
          </p>
        )}

        <Section title="Subtasks" count={subtasks.length}>
          {subtasks.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
              None yet. Deploy the agent and it will break this down.
            </p>
          ) : (
            <div className="-mx-3">
              {subtasks.map((subtask) => (
                <SubtaskRow key={subtask.id} task={subtask} depth={0} />
              ))}
            </div>
          )}
        </Section>

        {task.comments.length > 0 && (
          <Section title="Comments" count={task.comments.length}>
            <div className="space-y-3">
              {task.comments.map((comment) => (
                <div
                  key={comment.id}
                  className="flex gap-3 rounded-lg border border-border bg-card/40 p-3.5"
                >
                  <div
                    className={cn(
                      'flex size-6 shrink-0 items-center justify-center rounded-full',
                      comment.author === 'agent'
                        ? 'bg-agent/15 text-agent'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {comment.author === 'agent' ? (
                      <Sparkles className="size-3.5" />
                    ) : (
                      <User className="size-3.5" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium text-muted-foreground">
                      {comment.author === 'agent' ? 'Agent' : 'You'}
                    </p>
                    <p className="mt-1 text-[13.5px] leading-relaxed whitespace-pre-wrap text-foreground/90">
                      {comment.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {task.report && (
          <Section title="Report">
            <div className="rounded-xl border border-border bg-card/40">
              <div className="flex items-center gap-2 border-b border-border px-5 py-3">
                <BookOpen className="size-4 text-agent" />
                <span className="text-[13px] font-medium text-foreground">
                  Attached by the agent
                </span>
              </div>

              <div className="px-5 py-4">
                <Markdown source={task.report.markdown} />
              </div>

              {task.report.sources.length > 0 && (
                <div className="border-t border-border px-5 py-4">
                  <p className="mb-2.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                    Sources
                  </p>
                  <ul className="space-y-1.5">
                    {task.report.sources.map((source, i) => (
                      <li key={i} className="flex items-baseline gap-2 text-[13px]">
                        <Link2 className="size-3 shrink-0 translate-y-0.5 text-muted-foreground" />
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-foreground/90 underline-offset-2 hover:underline"
                        >
                          {source.title}
                        </a>
                        <span className="text-muted-foreground">{hostOf(source.url)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Section>
        )}

        <div className="h-16" />
      </div>
    </div>
  )
}
