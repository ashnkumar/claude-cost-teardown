'use client'

import { useEffect, useRef } from 'react'
import {
  BookOpen,
  CircleDot,
  Globe,
  ListTree,
  MessageSquare,
  Search,
  Sparkles,
  Wrench,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import { STATUS_LABEL, hostOf } from '@/lib/ui'
import type { FeedEntry } from '@/lib/client/feed'

const TOOL_LABEL: Record<string, string> = {
  create_subtasks: 'create_subtasks',
  update_task: 'update_task',
  add_comment: 'add_comment',
  attach_report: 'attach_report',
}

function Line({
  icon,
  tint,
  children,
}: {
  icon: React.ReactNode
  tint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <span className={cn('mt-[3px] shrink-0 text-muted-foreground', tint)}>{icon}</span>
      <div className="min-w-0 flex-1 text-[12.5px] leading-relaxed">{children}</div>
    </div>
  )
}

function Entry({ entry }: { entry: FeedEntry }) {
  switch (entry.kind) {
    case 'turn':
      return (
        <div className="flex items-center gap-3 py-3 first:pt-0">
          <span className="text-[10px] font-semibold tracking-widest text-muted-foreground/70 uppercase">
            Turn {entry.turn}
          </span>
          <span className="h-px flex-1 bg-border" />
        </div>
      )

    // The thinking stream runs to many hundreds of words per turn and swamps
    // the feed, burying the subtask and tool events — which are the ones that
    // tell you what the agent is actually doing to your task. The events still
    // arrive and still stream; they are simply not rendered. Delete this case
    // to bring the stream back.
    case 'thinking':
      return null

    case 'text':
      return (
        <p className="my-1.5 text-[13px] leading-relaxed whitespace-pre-wrap text-foreground/90">
          {entry.text}
        </p>
      )

    case 'search':
      return (
        <Line icon={<Search className="size-3.5" />}>
          <span className="text-muted-foreground">Searched </span>
          <span className="text-foreground">{entry.query}</span>
        </Line>
      )

    case 'fetch':
      return (
        <Line icon={<Globe className="size-3.5" />}>
          <span className="text-muted-foreground">Fetched </span>
          <span className="text-foreground">{hostOf(entry.url)}</span>
        </Line>
      )

    case 'tool':
      return (
        <Line icon={<Wrench className="size-3.5" />}>
          <span className="font-mono text-[11.5px] text-foreground">
            {TOOL_LABEL[entry.name] ?? entry.name}
          </span>
          {entry.label && (
            <span className="text-muted-foreground"> · {entry.label}</span>
          )}
        </Line>
      )

    case 'subtask':
      return (
        <Line icon={<ListTree className="size-3.5" />} tint="text-emerald-400">
          <span className="text-foreground">{entry.title}</span>
          {entry.assignee && (
            <span className="text-muted-foreground"> · {entry.assignee}</span>
          )}
        </Line>
      )

    case 'comment':
      return (
        <Line icon={<MessageSquare className="size-3.5" />}>
          <span className="text-muted-foreground">Commented — </span>
          <span className="text-foreground/90">{entry.preview}</span>
        </Line>
      )

    case 'report':
      return (
        <Line icon={<BookOpen className="size-3.5" />} tint="text-agent">
          <span className="text-foreground">Report attached</span>
          <span className="text-muted-foreground"> · {entry.sources} sources</span>
        </Line>
      )

    case 'status':
      return (
        <Line icon={<CircleDot className="size-3.5" />}>
          <span className="text-muted-foreground">Status → </span>
          <span className="text-foreground">{STATUS_LABEL[entry.status]}</span>
        </Line>
      )

    case 'done':
      return (
        <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[12.5px] text-emerald-300">
          Run finished · {entry.turns} turns
        </div>
      )

    case 'error':
      return (
        <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
          {entry.message}
        </div>
      )
  }
}

export function ActivityFeed({
  entries,
  running,
}: {
  entries: FeedEntry[]
  running: boolean
}) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [entries])

  return (
    <div className="flex h-full flex-col border-l border-border bg-card/20">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-5">
        <Sparkles className={cn('size-4 text-agent', running && 'animate-pulse')} />
        <h2 className="text-sm font-medium text-foreground">Activity</h2>
        {running && (
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="size-1.5 animate-pulse rounded-full bg-agent" />
            live
          </span>
        )}
      </div>

      <div className="scroll-quiet flex-1 overflow-y-auto px-5 py-4">
        {entries.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">Waiting for the agent…</p>
        ) : (
          entries.map((entry) => <Entry key={entry.id} entry={entry} />)
        )}
        <div ref={bottomRef} className="h-1" />
      </div>
    </div>
  )
}
