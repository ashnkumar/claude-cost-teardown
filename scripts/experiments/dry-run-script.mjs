// A scripted agent, distilled from the real run-1 trace, so every piece of
// harness plumbing can be exercised for $0: client tool execution against the
// real store, an is_error tool_result, and a server-tool turn that must be
// resumed via container id. Assistant messages carry fake thinking blocks —
// they never reach the API in dry mode, but the strategies must pass them
// through untouched.

const FAKE_DOC = 'Fetched page content. ' + 'lorem '.repeat(8000) // ~50KB

const usage = (input, output, extra = {}) => ({
  input_tokens: input,
  output_tokens: output,
  cache_creation_input_tokens: 9500,
  cache_read_input_tokens: 0,
  server_tool_use: { web_search_requests: 0, web_fetch_requests: 0, ...extra },
})

const think = (t) => ({ type: 'thinking', thinking: t, signature: 'dry' })
const msg = (content, stop_reason, u, container) => ({
  id: 'msg_dry', type: 'message', role: 'assistant',
  model: 'dry-run-stub', content, stop_reason, usage: u,
  ...(container ? { container } : {}),
})

export function makeScript() {
  let n = 0
  const tu = (name, input) =>
    ({ type: 'tool_use', id: `dry_${++n}`, name, input })

  return [
    msg([
      think('start the task'),
      tu('update_task', { task_id: 't-dog', status: 'in_progress' }),
    ], 'tool_use', usage(300, 120)),

    msg([
      think('break it down'),
      tu('create_subtasks', {
        parent_id: 't-dog',
        subtasks: [
          { title: 'Dry subtask one' }, { title: 'Dry subtask two' },
          { title: 'Dry subtask three' }, { title: 'Dry subtask four' },
          { title: 'Dry subtask five' }, { title: 'Dry subtask six' },
        ],
      }),
    ], 'tool_use', usage(800, 400)),

    // Server-tool turn: stop_reason tool_use with NO client tools pending —
    // the loop must re-send with the container id, not end the run.
    msg([
      think('research'),
      { type: 'server_tool_use', id: 'srv_1', name: 'web_search',
        input: { query: 'dry run query' } },
      { type: 'web_search_tool_result', tool_use_id: 'srv_1',
        content: [{ type: 'web_search_result', url: 'https://example.com/a',
          title: 'Example A', encrypted_content: 'ENC' }] },
      { type: 'server_tool_use', id: 'srv_2', name: 'web_fetch',
        input: { url: 'https://example.com/a' } },
      { type: 'web_fetch_tool_result', tool_use_id: 'srv_2',
        content: { type: 'web_fetch_result', url: 'https://example.com/a',
          content: { type: 'document',
            source: { type: 'text', data: FAKE_DOC } } } },
    ], 'tool_use',
    usage(2000, 900, { web_search_requests: 1, web_fetch_requests: 1 }),
    { id: 'container_dry' }),

    msg([
      think('good, mark progress'),
      tu('update_task', { task_id: 't-dog', status: 'in_progress' }),
    ], 'tool_use', usage(14000, 200)),

    // Bad id on purpose: exercises the is_error tool_result path.
    msg([
      think('oops, wrong id'),
      tu('update_task', { task_id: 't-missing', status: 'done' }),
    ], 'tool_use', usage(22000, 180)),

    msg([
      think('leave a note'),
      tu('add_comment', { task_id: 't-dog', body: 'Dry-run progress note.' }),
    ], 'tool_use', usage(31000, 250)),

    msg([
      think('write it up'),
      tu('attach_report', {
        task_id: 't-dog',
        markdown: '# Dry-run report\n\nFindings from the scripted run.',
        sources: [{ title: 'Example A', url: 'https://example.com/a' }],
      }),
    ], 'tool_use', usage(42000, 700)),

    msg([
      think('wrap up'),
      { type: 'text', text: 'Done. Report attached, tree updated.' },
    ], 'end_turn', usage(52000, 150)),
  ]
}
