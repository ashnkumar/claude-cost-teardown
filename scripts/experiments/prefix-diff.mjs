// Why did this call miss the cache? For every consecutive pair of agent
// requests in a transcript, walk the block sequence in the API's cache-
// hierarchy order (tools → system → messages) and find the first byte where
// they diverge. `clean-append` means the earlier request is a strict prefix
// of the later one — cacheable. `mutated` means history was rewritten, and
// the reason column shows the exact bytes that did it.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function stripCC(block) {
  if (!('cache_control' in block)) return block
  const rest = { ...block }
  delete rest.cache_control
  return rest
}

const msgBlocks = (m) =>
  typeof m.content === 'string'
    ? [{ type: 'text', text: m.content }]
    : m.content

function flatten(req) {
  const out = []
  for (const [i, t] of (req.tools ?? []).entries()) {
    out.push({ path: `tools[${i}]`, json: JSON.stringify(t) })
  }
  const system = typeof req.system === 'string'
    ? [{ type: 'text', text: req.system }]
    : req.system ?? []
  for (const [i, b] of system.entries()) {
    out.push({ path: `system[${i}]`, json: JSON.stringify(stripCC(b)) })
  }
  for (const [mi, m] of (req.messages ?? []).entries()) {
    for (const [bi, b] of msgBlocks(m).entries()) {
      out.push({
        path: `messages[${mi}].content[${bi}]`,
        json: JSON.stringify(stripCC(b)),
      })
    }
  }
  return out
}

// Marker positions as indices into the flattened block list. A breakpoint at
// flat index m caches blocks [0..m]; the span survives a new request only if
// the first divergence lands strictly after m. The top-level automatic marker
// sits on the last cacheable block — treat it as the end of the list.
function markerIndices(req, flatLen) {
  const spots = []
  const toolCount = (req.tools ?? []).length
  const system = Array.isArray(req.system) ? req.system : []
  system.forEach((b, i) => {
    if (b.cache_control) {
      spots.push({ path: `system[${i}]`, index: toolCount + i })
    }
  })
  let cursor = toolCount + system.length
  ;(req.messages ?? []).forEach((m, mi) => {
    msgBlocks(m).forEach((b, bi) => {
      if (b.cache_control) {
        spots.push({ path: `messages[${mi}].content[${bi}]`, index: cursor })
      }
      cursor += 1
    })
  })
  if (req.cache_control) {
    spots.push({ path: 'request(top-level)', index: flatLen - 1 })
  }
  return spots
}

function firstDiff(a, b) {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return { at: i, a: a.slice(i, i + 120), b: b.slice(i, i + 120) }
}

/** transcript lines (parsed) -> per-pair diagnosis rows */
export function prefixDiff(lines) {
  const agent = lines.filter((l) => l.kind === 'agent' && l.request)
  const rows = []
  for (let i = 1; i < agent.length; i++) {
    const prev = flatten(agent[i - 1].request)
    const cur = flatten(agent[i].request)
    let d = 0
    while (d < prev.length && d < cur.length &&
           prev[d].json === cur[d].json) d++
    const marks = markerIndices(agent[i].request, cur.length)
    let row
    if (d === prev.length && cur.length >= prev.length) {
      row = { classification: 'clean-append', shared_blocks: d }
    } else {
      const delta = d < prev.length && d < cur.length
        ? firstDiff(prev[d].json, cur[d].json)
        : { at: 0, a: '(block removed)', b: '(list ended)' }
      // A span cached by marker m survives only if divergence lands after m.
      const busted = marks.filter((m) => d <= m.index).map((m) => m.path)
      row = {
        classification: busted.length ? 'cache-busting' : 'drift-after-markers',
        shared_blocks: d,
        block_path: cur[d]?.path ?? prev[d]?.path,
        busted_markers: busted,
        was: delta.a,
        now: delta.b,
      }
    }
    rows.push({
      call: agent[i].call_index,
      prev_call: agent[i - 1].call_index,
      ...row,
      markers: marks.map((m) => m.path),
      cache_read: agent[i].usage?.cache_read_input_tokens ?? null,
      cache_write: agent[i].usage?.cache_creation_input_tokens ?? null,
    })
  }
  return rows
}

export function runOnRepDir(repDir) {
  const file = path.join(repDir, 'transcript.jsonl')
  if (!fs.existsSync(file)) return null
  const lines = fs.readFileSync(file, 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const rows = prefixDiff(lines)
  fs.writeFileSync(
    path.join(repDir, 'prefix-diff.jsonl'),
    rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''),
  )
  return {
    pairs: rows.length,
    clean_append: rows.filter((r) => r.classification === 'clean-append').length,
    drift_after_markers:
      rows.filter((r) => r.classification === 'drift-after-markers').length,
    cache_busting:
      rows.filter((r) => r.classification === 'cache-busting').length,
    first_busting: rows.find((r) => r.classification === 'cache-busting')
      ?.block_path ?? null,
  }
}

// CLI: node prefix-diff.mjs <rep-dir>
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repDir = process.argv[2]
  if (!repDir) throw new Error('usage: prefix-diff.mjs <rep-dir>')
  const summary = runOnRepDir(repDir)
  if (!summary) throw new Error(`no transcript.jsonl in ${repDir}`)
  console.log(JSON.stringify(summary, null, 2))
  const rows = fs.readFileSync(path.join(repDir, 'prefix-diff.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const TAGS = {
    'clean-append': 'append ',
    'drift-after-markers': 'drift  ',
    'cache-busting': 'BUSTING',
  }
  for (const r of rows) {
    const why = r.classification === 'clean-append'
      ? ''
      : `  @ ${r.block_path}  "${String(r.was).slice(0, 40)}" -> ` +
        `"${String(r.now).slice(0, 40)}"` +
        (r.busted_markers?.length
          ? `  kills [${r.busted_markers.join(', ')}]` : '')
    console.log(
      `call ${String(r.prev_call).padStart(2)}->${String(r.call).padEnd(3)}` +
      ` ${TAGS[r.classification]}  cr=${r.cache_read ?? '-'}${why}`,
    )
  }
}
