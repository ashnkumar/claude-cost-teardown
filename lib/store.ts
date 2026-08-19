/**
 * The store. A JSON file and a mutex — that is the whole persistence layer.
 *
 * `data/tasks.json` is gitignored and seeded from `data/seed.json` the first
 * time anything reads it. Node-only; never import this from a client component.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import type { Db, Level, Task, TaskComment, TaskReport, TaskStatus } from '@/lib/types'

const DATA_DIR = path.join(process.cwd(), 'data')
const DB_PATH = path.join(DATA_DIR, 'tasks.json')
const SEED_PATH = path.join(DATA_DIR, 'seed.json')

/**
 * The agent fires tool calls back to back and every one of them is a
 * read-modify-write against the same file. Serialise them or they clobber
 * each other — a lost subtask is very visible on screen.
 */
let chain: Promise<unknown> = Promise.resolve()

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/** `data/seed.json` carries the day its dates were written relative to. */
interface Seed extends Db {
  anchor?: string
}

function shiftDays(iso: string, days: number): string {
  const isDay = iso.length === 10
  const date = new Date(isDay ? `${iso}T00:00:00Z` : iso)
  date.setUTCDate(date.getUTCDate() + days)
  return isDay ? date.toISOString().slice(0, 10) : date.toISOString()
}

/**
 * Roll the seed's dates forward so they land around today.
 *
 * The list is read on whatever day it is read, and a due column reading
 * "Jul 30" three weeks later looks like abandoned data. Written once at seed
 * time, so nothing downstream has to know about it.
 */
function rollSeedDates(seed: Seed): Db {
  if (!seed.anchor) return { tasks: seed.tasks }

  // Both ends have to be local midnight. Comparing a local clock against a UTC
  // anchor puts everything a day out for most of the day west of Greenwich.
  const [year, month, day] = seed.anchor.split('-').map(Number)
  const from = new Date(year, month - 1, day)
  const to = new Date()
  to.setHours(0, 0, 0, 0)

  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000)
  if (days === 0) return { tasks: seed.tasks }

  return {
    tasks: seed.tasks.map((task) => ({
      ...task,
      dueDate: task.dueDate ? shiftDays(task.dueDate, days) : null,
      createdAt: shiftDays(task.createdAt, days),
      updatedAt: shiftDays(task.updatedAt, days),
    })),
  }
}

async function readDb(): Promise<Db> {
  try {
    return JSON.parse(await fs.readFile(DB_PATH, 'utf8')) as Db
  } catch {
    const seed = JSON.parse(await fs.readFile(SEED_PATH, 'utf8')) as Seed
    const db = rollSeedDates(seed)
    await fs.mkdir(DATA_DIR, { recursive: true })
    await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2))
    return db
  }
}

async function writeDb(db: Db): Promise<void> {
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2))
}

function now(): string {
  return new Date().toISOString()
}

function shortId(): string {
  return randomUUID().slice(0, 8)
}

// ── Reads ───────────────────────────────────────────────────────────────────

function attachSubtasks(db: Db, task: Task): Task {
  return {
    ...task,
    subtasks: db.tasks
      .filter((t) => t.parentId === task.id)
      .map((t) => attachSubtasks(db, t)),
  }
}

/** Root tasks, each with its subtask tree nested underneath. */
export async function listTasks(): Promise<Task[]> {
  const db = await readDb()
  return db.tasks
    .filter((t) => t.parentId === null)
    .map((t) => attachSubtasks(db, t))
}

/** One task with its subtree. */
export async function getTask(id: string): Promise<Task | null> {
  const db = await readDb()
  const task = db.tasks.find((t) => t.id === id)
  return task ? attachSubtasks(db, task) : null
}

/** Titles of everything under `id` that isn't done — the agent's working set. */
export async function openSubtaskTitles(id: string): Promise<string[]> {
  const db = await readDb()
  return db.tasks
    .filter((t) => t.parentId === id && t.status !== 'done')
    .map((t) => t.title)
}

// ── Writes ──────────────────────────────────────────────────────────────────

export interface SubtaskSpec {
  title: string
  description?: string
  assignee?: 'human' | 'agent' | null
  priority?: Level | null
  energy?: Level | null
  time_estimate?: number | null
  task_type?: string[]
  status?: TaskStatus
}

export async function createSubtasks(
  parentId: string,
  specs: SubtaskSpec[],
): Promise<Task[]> {
  return withLock(async () => {
    const db = await readDb()
    const parent = db.tasks.find((t) => t.id === parentId)
    if (!parent) throw new Error(`No such task: ${parentId}`)

    const created = specs.map<Task>((spec) => ({
      id: `t-${shortId()}`,
      title: spec.title,
      description: spec.description ?? '',
      status: spec.status ?? 'not_started',
      assignee: spec.assignee ?? null,
      parentId,
      needsHumanReview: false,
      priority: spec.priority ?? null,
      energy: spec.energy ?? null,
      timeEstimate: spec.time_estimate ?? null,
      taskType: spec.task_type ?? [],
      // Subtasks live inside the detail pane, never in the list view, so none
      // of the three list-only fields mean anything here.
      dueDate: null,
      project: parent.project,
      section: null,
      comments: [],
      report: null,
      createdAt: now(),
      updatedAt: now(),
    }))

    db.tasks.push(...created)
    await writeDb(db)
    return created
  })
}

export interface TaskPatch {
  title?: string
  description?: string
  status?: TaskStatus
  assignee?: 'human' | 'agent' | null
  priority?: Level | null
  energy?: Level | null
  timeEstimate?: number | null
  taskType?: string[]
  needsHumanReview?: boolean
}

export async function updateTask(id: string, patch: TaskPatch): Promise<Task> {
  return withLock(async () => {
    const db = await readDb()
    const task = db.tasks.find((t) => t.id === id)
    if (!task) throw new Error(`No such task: ${id}`)

    Object.assign(
      task,
      Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
    )
    task.updatedAt = now()

    await writeDb(db)
    return task
  })
}

export async function addComment(
  taskId: string,
  body: string,
  author: 'human' | 'agent',
): Promise<TaskComment> {
  return withLock(async () => {
    const db = await readDb()
    const task = db.tasks.find((t) => t.id === taskId)
    if (!task) throw new Error(`No such task: ${taskId}`)

    const comment: TaskComment = { id: `c-${shortId()}`, body, author, createdAt: now() }
    task.comments.push(comment)
    task.updatedAt = now()

    await writeDb(db)
    return comment
  })
}

export async function attachReport(
  taskId: string,
  markdown: string,
  sources: TaskReport['sources'],
): Promise<TaskReport> {
  return withLock(async () => {
    const db = await readDb()
    const task = db.tasks.find((t) => t.id === taskId)
    if (!task) throw new Error(`No such task: ${taskId}`)

    const report: TaskReport = { markdown, sources, createdAt: now() }
    task.report = report
    task.updatedAt = now()

    await writeDb(db)
    return report
  })
}

/** Blow away local state and re-seed, so a run starts from a known tree. */
export async function resetDb(): Promise<void> {
  return withLock(async () => {
    await fs.rm(DB_PATH, { force: true })
    await readDb()
  })
}
