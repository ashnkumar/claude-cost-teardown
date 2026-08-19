'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, RotateCcw } from 'lucide-react'

import { ActivityFeed } from '@/components/activity-feed'
import { NavRail, SELECTED_VIEW } from '@/components/nav-rail'
import { TaskDetail } from '@/components/task-detail'
import { TaskTable } from '@/components/task-table'
import { Button } from '@/components/ui/button'
import { appendEvent, isMutation, type FeedEntry } from '@/lib/client/feed'
import { streamRun } from '@/lib/client/stream'
import type { Task } from '@/lib/types'

const FEED_WIDTH = 400

export function DelegateApp() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [entries, setEntries] = useState<FeedEntry[]>([])
  const [running, setRunning] = useState(false)
  const [dateLabel, setDateLabel] = useState('')

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** After mount only — the server and the laptop can disagree about the day. */
  useEffect(() => {
    setDateLabel(
      new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }),
    )
  }, [])

  const refresh = useCallback(async () => {
    const response = await fetch('/api/tasks', { cache: 'no-store' })
    const { tasks: next } = (await response.json()) as { tasks: Task[] }
    setTasks(next)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** The agent writes in bursts; coalesce so we aren't refetching per tool call. */
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) return
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null
      void refresh()
    }, 250)
  }, [refresh])

  const deploy = useCallback(async () => {
    if (!selectedId || running) return

    setEntries([])
    setRunning(true)

    try {
      await streamRun(selectedId, (event) => {
        setEntries((current) => appendEvent(current, event))
        if (isMutation(event)) scheduleRefresh()
      })
    } catch (error) {
      setEntries((current) =>
        appendEvent(current, {
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        }),
      )
    } finally {
      setRunning(false)
      void refresh()
    }
  }, [refresh, running, scheduleRefresh, selectedId])

  const reset = useCallback(async () => {
    await fetch('/api/tasks/reset', { method: 'POST' })
    setEntries([])
    setSelectedId(null)
    await refresh()
  }, [refresh])

  const selected = tasks.find((task) => task.id === selectedId) ?? null
  const activeCount = tasks.filter((task) => task.status !== 'done').length
  const showFeed = running || entries.length > 0

  return (
    <div className="flex h-full">
      <NavRail tasks={tasks} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-6">
          {selected ? (
            <>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="-ml-2 flex items-center gap-0.5 rounded px-2 py-1 text-[13px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              >
                <ChevronLeft className="size-4" />
                {SELECTED_VIEW}
              </button>
              <span className="text-muted-foreground/40">/</span>
              <span className="truncate text-[13px] text-foreground/80">
                {selected.title}
              </span>
            </>
          ) : (
            <>
              <h1 className="text-[15px] font-semibold tracking-tight text-foreground">
                {SELECTED_VIEW}
              </h1>
              <span className="text-[12px] tabular-nums text-muted-foreground">
                {activeCount} active
              </span>
            </>
          )}

          <div className="ml-auto flex shrink-0 items-center gap-4">
            <span className="text-[13px] text-muted-foreground">{dateLabel}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={reset}
              disabled={running}
              className="gap-1.5 text-muted-foreground"
            >
              <RotateCcw className="size-3.5" />
              Reset
            </Button>
          </div>
        </header>

        <main className="flex min-h-0 flex-1">
          {/*
            The feed slides in when Deploy is pressed. Hold its column open
            beforehand so the detail doesn't slide sideways on the exact click
            that starts a run. The list wants the full width, so it opts out.
          */}
          <div
            className="min-w-0 flex-1"
            style={selected && !showFeed ? { marginRight: FEED_WIDTH } : undefined}
          >
            {selected ? (
              <TaskDetail task={selected} running={running} onDeploy={deploy} />
            ) : (
              <TaskTable tasks={tasks} selectedId={selectedId} onSelect={setSelectedId} />
            )}
          </div>

          {showFeed && (
            <aside className="shrink-0" style={{ width: FEED_WIDTH }}>
              <ActivityFeed entries={entries} running={running} />
            </aside>
          )}
        </main>
      </div>
    </div>
  )
}
