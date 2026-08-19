import type Anthropic from '@anthropic-ai/sdk'

import type { EmitFn } from '@/lib/agent/events'
import { addComment, attachReport, createSubtasks, updateTask } from '@/lib/store'
import type { SubtaskSpec, TaskPatch } from '@/lib/store'
import type { Level, ReportSource, TaskStatus } from '@/lib/types'

// ── Server-side tools ───────────────────────────────────────────────────────
// These run on Anthropic's infrastructure. We declare them and the results come
// back in the response; there is nothing for us to execute.
//
// The _20260209 versions do dynamic filtering — the model writes and runs code
// to filter search results before they reach the context window. That is built
// in; do NOT also declare code_execution, a second execution environment just
// confuses the model.

export const SERVER_TOOLS: Anthropic.Messages.ToolUnion[] = [
  { type: 'web_search_20260209', name: 'web_search' },
  {
    type: 'web_fetch_20260209',
    name: 'web_fetch',
    // 🔴 KNOWN BUG — `max_content_tokens` is deliberately not set.
    // Without it a fetched page enters the context at whatever size it happens
    // to be (a research PDF is comfortably six figures of tokens) and then
    // rides along on every subsequent request in the loop.
  },
]

// ── Client-side tools ───────────────────────────────────────────────────────
// We execute these ourselves, against the JSON store.

export const CLIENT_TOOLS: Anthropic.Messages.ToolUnion[] = [
  {
    name: 'create_subtasks',
    description:
      'Create one or more child tasks under a parent task. Decompose to the smallest actionable unit — each subtask should be a single concrete action.',
    input_schema: {
      type: 'object',
      properties: {
        parent_id: { type: 'string', description: 'The id of the parent task.' },
        subtasks: {
          type: 'array',
          description: 'The subtasks to create, in the order they should be done.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: {
                type: 'string',
                description:
                  'Everything someone needs to act on this without re-reading the parent.',
              },
              assignee: { type: 'string', enum: ['human', 'agent'] },
              priority: { type: 'string', enum: ['low', 'medium', 'high'] },
              energy: { type: 'string', enum: ['low', 'medium', 'high'] },
              time_estimate: { type: 'number', enum: [5, 15, 30, 60, 90] },
              task_type: { type: 'array', items: { type: 'string' } },
            },
            required: ['title'],
          },
        },
      },
      required: ['parent_id', 'subtasks'],
    },
  },
  {
    name: 'update_task',
    description:
      'Update fields on a task. Use this to move status, record findings in the description, and fill in missing metadata.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        status: {
          type: 'string',
          enum: ['not_started', 'in_progress', 'waiting', 'needs_review', 'done'],
        },
        description: { type: 'string' },
        assignee: { type: 'string', enum: ['human', 'agent'] },
        priority: { type: 'string', enum: ['low', 'medium', 'high'] },
        energy: { type: 'string', enum: ['low', 'medium', 'high'] },
        time_estimate: { type: 'number', enum: [5, 15, 30, 60, 90] },
        task_type: { type: 'array', items: { type: 'string' } },
        needs_human_review: {
          type: 'boolean',
          description:
            'Set true only when you are blocked and need an answer before you can continue.',
        },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'add_comment',
    description:
      'Leave a comment on a task. Progress updates, questions, and the closing summary.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['task_id', 'body'],
    },
  },
  {
    name: 'attach_report',
    description:
      'Attach the deliverable to a task. Markdown, structured for someone making a decision, plus the sources you actually used. One report per task; attaching again replaces it.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        markdown: { type: 'string' },
        sources: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              url: { type: 'string' },
            },
            required: ['title', 'url'],
          },
        },
      },
      required: ['task_id', 'markdown', 'sources'],
    },
  },
]

export const TOOLS: Anthropic.Messages.ToolUnion[] = [...SERVER_TOOLS, ...CLIENT_TOOLS]

const CLIENT_TOOL_NAMES = new Set(
  CLIENT_TOOLS.map((t) => (t as { name: string }).name),
)

export function isClientTool(name: string): boolean {
  return CLIENT_TOOL_NAMES.has(name)
}

// ── Execution ───────────────────────────────────────────────────────────────

interface CreateSubtasksInput {
  parent_id: string
  subtasks: SubtaskSpec[]
}

interface UpdateTaskInput {
  task_id: string
  status?: TaskStatus
  description?: string
  assignee?: 'human' | 'agent'
  priority?: Level
  energy?: Level
  time_estimate?: number
  task_type?: string[]
  needs_human_review?: boolean
}

interface AddCommentInput {
  task_id: string
  body: string
}

interface AttachReportInput {
  task_id: string
  markdown: string
  sources: ReportSource[]
}

export async function executeClientTool(
  name: string,
  input: unknown,
  emit: EmitFn,
): Promise<string> {
  switch (name) {
    case 'create_subtasks': {
      const { parent_id, subtasks } = input as CreateSubtasksInput
      const created = await createSubtasks(parent_id, subtasks ?? [])
      for (const task of created) {
        emit({ type: 'subtask_created', title: task.title, assignee: task.assignee })
      }
      return JSON.stringify({
        created: created.map((t) => ({ id: t.id, title: t.title })),
      })
    }

    case 'update_task': {
      const args = input as UpdateTaskInput
      const patch: TaskPatch = {
        status: args.status,
        description: args.description,
        assignee: args.assignee,
        priority: args.priority,
        energy: args.energy,
        timeEstimate: args.time_estimate,
        taskType: args.task_type,
        needsHumanReview: args.needs_human_review,
      }
      const task = await updateTask(args.task_id, patch)

      if (args.status) {
        emit({ type: 'status_changed', taskId: task.id, status: task.status })
      } else {
        emit({ type: 'task_updated', label: task.title })
      }
      return JSON.stringify({ ok: true, id: task.id, status: task.status })
    }

    case 'add_comment': {
      const { task_id, body } = input as AddCommentInput
      const comment = await addComment(task_id, body, 'agent')
      emit({ type: 'comment_added', preview: body.slice(0, 140) })
      return JSON.stringify({ ok: true, id: comment.id })
    }

    case 'attach_report': {
      const { task_id, markdown, sources } = input as AttachReportInput
      const report = await attachReport(task_id, markdown, sources ?? [])
      emit({ type: 'report_attached', sources: report.sources.length })
      return JSON.stringify({ ok: true, sources: report.sources.length })
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` })
  }
}
