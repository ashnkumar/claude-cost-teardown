/**
 * The Delegate task model.
 *
 * Only the fields the agent actually reads or writes survived. Sections,
 * projects, views, dependencies, recurrence and placement were all cut.
 */

export type TaskStatus =
  | 'not_started'
  | 'in_progress'
  | 'waiting'
  | 'needs_review'
  | 'done'

/** Who does the work. The whole point of the product is that this can be an agent. */
export type Assignee = 'human' | 'agent' | null

export type Level = 'low' | 'medium' | 'high'

export interface TaskComment {
  id: string
  body: string
  author: 'human' | 'agent'
  createdAt: string
}

export interface ReportSource {
  title: string
  url: string
}

/**
 * A report is a first-class artifact hanging off the task, not a comment.
 * Comments are the conversation; the report is the deliverable.
 */
export interface TaskReport {
  markdown: string
  sources: ReportSource[]
  createdAt: string
}

export interface Task {
  id: string
  title: string
  description: string
  status: TaskStatus
  assignee: Assignee
  parentId: string | null
  /** "I am blocked and cannot continue without you" — set by the agent mid-run. */
  needsHumanReview: boolean
  priority: Level | null
  energy: Level | null
  /** Minutes. */
  timeEstimate: number | null
  taskType: string[]
  /** ISO day, `YYYY-MM-DD`. The Due column. */
  dueDate: string | null
  /** Project name. Only the left rail reads this, for its counts. */
  project: string | null
  /** The group header this task renders under in the list. */
  section: string | null
  comments: TaskComment[]
  report: TaskReport | null
  createdAt: string
  updatedAt: string

  /** Computed at read time from `parentId` — never persisted. */
  subtasks?: Task[]
}

export interface Db {
  tasks: Task[]
}
