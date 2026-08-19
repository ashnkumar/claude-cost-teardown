/**
 * Usage dashboard — live, or replaying recorded runs one step at a time.
 *
 *   node scripts/usage-dashboard.mjs
 *   node scripts/usage-dashboard.mjs --replay experiments/naive-append/rep-1 \
 *                                    experiments/live-append/rep-7
 *
 * Live mode tails runs/usage.jsonl. Replay mode loads recorded usage.jsonl
 * files and releases them a step at a time, advanced by a keypress in the
 * page or `curl -X POST localhost:8080/next`. Showing four runs side by
 * side used to mean running four — about $20 and 35 minutes of waiting.
 *
 * No dependencies, no build step. Every figure comes from the four usage
 * fields callClaude() recorded; the dashboard only sums them.
 */
import { createServer } from 'node:http'
import { createReadStream, watchFile, statSync, readFileSync } from 'node:fs'
import path from 'node:path'

const PORT = Number(process.env.PORT) || 8080
const LAST_N = 25
const FILE = path.join(process.cwd(), 'runs', 'usage.jsonl')

function opt(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const next = process.argv[i + 1]
  return next && !next.startsWith('--') ? next : true
}

/** Every bare path after --replay, up to the next flag. */
function replayDirs() {
  const i = process.argv.indexOf('--replay')
  if (i === -1) return []
  const out = []
  for (let j = i + 1; j < process.argv.length; j++) {
    if (process.argv[j].startsWith('--')) break
    out.push(process.argv[j])
  }
  return out
}

/**
 * Step labels and order are data, never source.
 *
 * Which treatment wins is still being decided upstream, and the final naming
 * has already changed once. A rename must not be a code change, so it lives
 * in a JSON file rather than in this one.
 */
function loadBeats() {
  const dirs = replayDirs()
  const configPath = opt('steps')
  let config = null
  if (typeof configPath === 'string') {
    config = JSON.parse(readFileSync(configPath, 'utf8'))
  }

  let specs = []
  if (config?.steps?.length) {
    specs = config.steps
  } else if (dirs.length) {
    // No config: label each step with the cell it came from.
    specs = dirs.map((dir) => ({
      label: path.basename(path.dirname(dir)) + ' ' + path.basename(dir),
      dir,
    }))
  }
  if (!specs.length) return null

  const steps = specs.map((spec, i) => {
    const file = path.join(spec.dir, 'usage.jsonl')
    const records = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line))
    if (!records.length) throw new Error(`No usage records in ${file}`)
    // The label rides on the record so the page never has to know about
    // steps, dirs or config — it just renders what it is handed.
    for (const r of records) {
      r.beat_label = spec.label ?? `Step ${i + 1}`
      r.beat_note = spec.note ?? null
    }
    return { label: spec.label ?? `Step ${i + 1}`, records }
  })

  return {
    title: config?.title ?? 'Delegate — usage',
    callMs: Number(opt('call-ms')) || config?.callMs || 120,
    instant: process.argv.includes('--instant'),
    steps,
  }
}

const replay = loadBeats()

const records = []
const clients = new Set()
let offset = 0
let carry = ''

function push(fresh) {
  if (!fresh.length) return
  records.push(...fresh)
  const payload = `data: ${JSON.stringify(fresh)}\n\n`
  for (const res of clients) res.write(payload)
}

function ingest(chunk) {
  carry += chunk
  const lines = carry.split('\n')
  carry = lines.pop() ?? ''
  const fresh = []
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      fresh.push(JSON.parse(line))
    } catch {
      // A half-written line; the next flush brings the rest.
    }
  }
  push(fresh)
}

function drain() {
  let size
  try {
    size = statSync(FILE).size
  } catch {
    return // not created yet
  }
  if (size < offset) {
    // File was truncated or replaced — start over.
    offset = 0
    carry = ''
    records.length = 0
  }
  if (size === offset) return
  const from = offset
  offset = size
  const stream = createReadStream(FILE, { start: from, end: size - 1 })
  let buf = ''
  stream.setEncoding('utf8')
  stream.on('data', (d) => (buf += d))
  stream.on('end', () => ingest(buf))
}

let cursor = 0
let releasing = false

/**
 * Release one step, its calls trickling in rather than landing at once.
 *
 * The trickle is the whole point: the cost tile has to climb the way it
 * does on a live run. --instant is for checking the end state.
 */
async function releaseNext() {
  if (!replay || releasing || cursor >= replay.steps.length) return false
  releasing = true
  const step = replay.steps[cursor++]
  console.log(`step ${cursor}/${replay.steps.length}  ${step.label}`)
  for (const rec of step.records) {
    push([rec])
    if (!replay.instant && replay.callMs > 0) {
      await new Promise((r) => setTimeout(r, replay.callMs))
    }
  }
  releasing = false
  return true
}

function resetReplay() {
  cursor = 0
  records.length = 0
  for (const res of clients) res.write('event: reset\ndata: {}\n\n')
}

if (!replay) {
  drain()
  watchFile(FILE, { interval: 400 }, drain)
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${replay ? replay.title : 'Delegate — usage'}</title>
<style>
  :root {
    --bg: #0b0c0e; --panel: #131519; --line: #23262d;
    --fg: #e8eaed; --dim: #8b9099; --hot: #ff8a5c; --cool: #5ccfa8;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--fg);
    font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    padding: 18px 28px 24px;
  }
  h1 {
    font-size: 13px; font-weight: 500; letter-spacing: .14em;
    text-transform: uppercase; color: var(--dim); margin: 0 0 14px;
    display: flex; align-items: center; gap: 10px;
  }
  /* Clean mode is the default: the figures and nothing else. Verbose is
     for working out what actually happened. Everything marked v-only is
     diagnostic and stays hidden until asked for. */
  #mode, #step {
    font: inherit; font-size: 10px; letter-spacing: .1em;
    cursor: pointer; background: var(--panel); color: var(--dim);
    border: 1px solid var(--line); border-radius: 4px; padding: 5px 10px;
  }
  #mode { margin-left: auto; }
  #mode:hover, #step:hover { color: var(--fg); }
  body.clean .v-only { display: none !important; }
  h1 span { color: var(--cool); }
  .grid {
    display: grid; gap: 12px; margin-bottom: 18px;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  }
  .tile {
    background: var(--panel); border: 1px solid var(--line);
    border-radius: 6px; padding: 14px 18px;
  }
  .tile .k {
    font-size: 11px; letter-spacing: .1em; text-transform: uppercase;
    color: var(--dim); margin-bottom: 6px;
  }
  .tile .v { font-size: 30px; letter-spacing: -.02em; }
  .tile .s { font-size: 12px; color: var(--dim); margin-top: 4px; }
  .hot .v { color: var(--hot); }
  /* The cost is the reason the page exists — it outranks everything. */
  .tile.lead { grid-column: span 2; }
  .tile.lead .v { font-size: 46px; }
  /* Half of a 1080p frame: the dashboard shares the screen with the app so
     the run is visibly happening. auto-fit lands four tiles as three plus a
     lonely fourth, leaving three-quarters of a row empty. Pinning three
     columns puts the cost across the top and the rest in one even row. */
  @media (max-width: 1100px) {
    .grid { grid-template-columns: repeat(3, 1fr); }
    .tile.lead { grid-column: span 3; }
    /* The run name is the only wide cell — "live-append-sonnet-effort-low
       rep-13" alone takes 440px of an 904px table. Wrapping it buys back
       the width without shrinking the numbers, which are what has to stay
       readable from across a room. */
    .runs td:first-child { white-space: normal; }
    .runs th, .runs td { padding-left: 10px; padding-right: 10px; }
  }
  .wrap { border: 1px solid var(--line); border-radius: 6px; }
  table { border-collapse: collapse; width: 100%; }
  th, td {
    text-align: right; padding: 9px 14px; white-space: nowrap;
    border-bottom: 1px solid var(--line);
  }
  th {
    font-size: 11px; letter-spacing: .08em; text-transform: uppercase;
    color: var(--dim); font-weight: 500; background: var(--panel);
  }
  td:first-child, th:first-child { text-align: left; }
  tbody tr:last-child td { border-bottom: 0; }
  .err { color: var(--hot); }
  .zero { color: var(--dim); }
  .empty { padding: 28px 14px; color: var(--dim); text-align: center; }
  h2 {
    font-size: 11px; letter-spacing: .1em; text-transform: uppercase;
    color: var(--dim); font-weight: 500; margin: 17px 0 8px;
    display: flex; align-items: center; gap: 10px;
  }
  h2 button {
    font: inherit; font-size: 10px; letter-spacing: .1em; cursor: pointer;
    background: none; color: var(--dim); border: 1px solid var(--line);
    border-radius: 4px; padding: 3px 8px;
  }
  h2 button:hover { color: var(--fg); }
  /* The comparison. Two runs of the same task, one above the other — this is
     the only view in which "the fix worked" is something you can see. */
  /* The run rows carry the comparison, so they get the spare vertical space
     rather than the tiles. Measured at 1920x1080: five rows plus a delta
     line still clears the fold with the call log collapsed. */
  .runs td { font-size: 18px; padding: 13px 14px; }
  .runs .cur td { color: #fff; }
  .runs .cur td:first-child::before { content: '▸ '; color: var(--cool); }
  .runs .old td { color: var(--dim); }
  .rid { font-size: 11px; color: var(--dim); margin-left: 8px; }
  .delta td {
    border-bottom: 0; padding-top: 2px; padding-bottom: 12px;
    font-size: 14px; color: var(--cool);
  }
  .warn {
    margin-top: 12px; padding: 9px 13px; border-radius: 5px;
    border: 1px solid var(--hot); color: var(--hot); font-size: 12px;
  }
  .hide { display: none !important; }
  /* Where the money went. The single most legible thing on the page. */
  .money { margin: 4px 0 8px; }
  .money .r {
    display: grid; grid-template-columns: 110px 78px 52px 1fr;
    align-items: center; gap: 12px; padding: 5px 0;
  }
  .money .lbl { color: var(--dim); font-size: 12px; }
  .money .amt { text-align: right; font-size: 15px; }
  .money .pct { text-align: right; color: var(--dim); font-size: 12px; }
  .money .bar { height: 9px; border-radius: 2px; background: var(--line); }
  .money .bar i { display: block; height: 100%; border-radius: 2px; }
  /* Per-call cost breakdown, tucked under each row. */
  .sub td {
    border-bottom: 1px solid var(--line); padding: 0 14px 9px;
    color: var(--dim); font-size: 11px; text-align: left;
  }
  tbody tr.main td { border-bottom: 0; padding-bottom: 4px; }
  .miss { color: var(--hot); }
  .hit { color: var(--cool); }
</style>
</head>
<body>
<h1>Delegate — Anthropic usage <span id="live">●</span>
  <button id="step" type="button" class="${replay ? '' : 'hide'}">NEXT STEP ▸</button>
  <button id="mode" type="button">VERBOSE</button></h1>
<div class="grid">
  <div class="tile hot lead"><div class="k">Cost — this run</div>
    <div class="v" id="cost">$0.0000</div>
    <div class="s" id="costPer">$0.0000 / call</div></div>
  <div class="tile"><div class="k">Prefix write : read</div>
    <div class="v" id="wr">—</div>
    <div class="s" id="wrSub">waiting</div></div>
  <div class="tile"><div class="k">Cache miss</div>
    <div class="v" id="missPct">—</div>
    <div class="s" id="missSub">of all input tokens</div></div>
  <div class="tile"><div class="k">Calls</div>
    <div class="v" id="calls">0</div>
    <div class="s" id="errs">0 errored</div></div>
  <div class="tile v-only"><div class="k">Uncached input</div>
    <div class="v" id="in">0</div>
    <div class="s" id="out">0 output</div></div>
</div>

<div id="unpriced" class="warn hide"></div>
<div id="toolNote" class="v-only"
     style="color:#8b9099;font-size:12px;margin:-14px 0 18px"></div>

<h2>Where the money went — this run</h2>
<div class="money" id="money"></div>

<h2>Runs</h2>
<div class="wrap">
  <table class="runs">
    <thead><tr>
      <th>Run</th><th>Calls</th><th>Cache W / call</th><th>Cache R / call</th>
      <th>W:R</th><th>Searches</th><th>Cost</th>
    </tr></thead>
    <tbody id="runRows"><tr><td class="empty" colspan="7">
      Waiting for the first call…</td></tr></tbody>
  </table>
</div>

<h2>Last ${LAST_N} calls
  <button id="callsToggle" type="button">SHOW</button></h2>
<div class="wrap hide" id="callsWrap">
  <table>
    <thead><tr>
      <th>Time</th><th>In</th><th>Cache W</th><th>Cache R</th>
      <th>Out</th><th class="v-only">Srch</th><th>Miss</th>
      <th class="v-only">Latency</th><th>Cost</th>
    </tr></thead>
    <tbody id="rows"><tr><td class="empty" colspan="9">
      Waiting for the first call…</td></tr></tbody>
  </table>
</div>
<script>
const LAST_N = ${LAST_N};
const REPLAY = ${replay ? 'true' : 'false'};
const all = [];
const n = (x) => x.toLocaleString('en-US');
const usd = (x) => '$' + x.toFixed(4);
const el = (id) => document.getElementById(id);
const per2 = (v, calls) => n(Math.round(v / (calls || 1)));

/**
 * $/1M tokens: input, output, cache write, cache read. List price.
 *
 * Keyed by model because a step may be a different model than the one before
 * it — that is the entire point of the model/effort comparison. Pricing every
 * row at Opus rates would silently overstate a Sonnet run by about 1.6x.
 */
const RATES = {
  'claude-opus-5':    [5, 25, 6.25, 0.5],
  'claude-opus-4-8':  [5, 25, 6.25, 0.5],
  'claude-sonnet-5':  [3, 15, 3.75, 0.3],
  'claude-haiku-4-5': [1, 5, 1.25, 0.1],
};
const SEARCH_USD = 0.01;
const unknownModels = new Set();

function parts(r) {
  const rate = RATES[r.model];
  if (!rate) { if (r.model) unknownModels.add(r.model); return null; }
  return {
    input: (r.input_tokens || 0) * rate[0] / 1e6,
    output: (r.output_tokens || 0) * rate[1] / 1e6,
    write: (r.cache_creation_input_tokens || 0) * rate[2] / 1e6,
    read: (r.cache_read_input_tokens || 0) * rate[3] / 1e6,
    search: (r.web_search_requests || 0) * SEARCH_USD,
  };
}

/**
 * The recorded figure when the meter had a rate, ours when it did not.
 *
 * The meter writes null rather than 0 for an unrecognised model, on purpose.
 * Rendering that as $0.00 would be the exact failure this app is about, so
 * the page prices it from the card above and says so in the banner.
 */
function callCost(r) {
  if (typeof r.cost_usd === 'number') return r.cost_usd;
  const p = parts(r);
  if (!p) return null;
  return p.input + p.output + p.write + p.read + p.search;
}

/** Group calls into runs, in the order the runs first appeared. */
function byRun() {
  const order = [];
  const map = new Map();
  for (const r of all) {
    const key = r.run_id || '—';
    if (!map.has(key)) { map.set(key, []); order.push(key); }
    map.get(key).push(r);
  }
  return order.map((id, i) => {
    const rs = map.get(id);
    const sum = (k) => rs.reduce((a, r) => a + (r[k] || 0), 0);
    // Split by whether the call ran a server tool — see render() for why.
    const part = (list) => ({
      calls: list.length,
      cw: list.reduce((a, r) => a + (r.cache_creation_input_tokens || 0), 0),
      cr: list.reduce((a, r) => a + (r.cache_read_input_tokens || 0), 0),
    });
    const priced = rs.map(callCost);
    return {
      id, n: i + 1, calls: rs.length,
      label: rs[0].beat_label || null,
      note: rs[0].beat_note || null,
      model: rs[0].model || '',
      cost: priced.reduce((a, c) => a + (c || 0), 0),
      unpriced: rs.filter((r) => r.cost_usd === null && !RATES[r.model]).length,
      inferred: rs.filter((r) => r.cost_usd === null && RATES[r.model]).length,
      errs: rs.filter((r) => r.status !== 'ok').length,
      cw: sum('cache_creation_input_tokens'),
      cr: sum('cache_read_input_tokens'),
      inp: sum('input_tokens'),
      out: sum('output_tokens'),
      srch: sum('web_search_requests'),
      clean: part(rs.filter((r) => !r.web_search_requests)),
      dirty: part(rs.filter((r) => r.web_search_requests > 0)),
    };
  });
}

/**
 * Writes over reads, on the calls that ran no server tool.
 *
 * One number for "is the cache working". Above 1 the prefix is being written
 * more than it is read back, which is the broken shape; on the build this
 * app ships with, reads are flat zero and the ratio has no ceiling.
 */
function ratio(p) {
  if (!p.cw && !p.cr) return { text: '—', sub: 'no cache traffic', hot: false };
  if (!p.cr) return { text: '∞', sub: 'read back zero times', hot: true };
  const v = p.cw / p.cr;
  return {
    text: (v >= 10 ? v.toFixed(0) : v.toFixed(2)) + ' : 1',
    sub: n(Math.round(p.cw / (p.calls || 1))) + ' written / ' +
         n(Math.round(p.cr / (p.calls || 1))) + ' read per call',
    hot: v > 1,
  };
}

function render() {
  if (!all.length) return;
  const runs = byRun();
  const cur = runs[runs.length - 1];
  // Tiles describe THE CURRENT RUN, not all history. Averaging a broken run
  // together with a fixed one hides the only thing worth seeing.
  el('cost').textContent = usd(cur.cost);
  el('costPer').textContent = usd(cur.cost / (cur.calls || 1)) + ' / call'
    + (cur.model ? '  ·  ' + cur.model : '');
  el('calls').textContent = n(cur.calls);
  el('errs').textContent = n(cur.errs) + ' errored';

  // 🔴 The prefix numbers come from calls that ran NO server tool.
  //
  // The _20260209 web tools run dynamic filtering inside a code-execution
  // container and cache their own growing prefix in there. On a searching
  // call that shows up as tens or hundreds of thousands of cache tokens that
  // have nothing to do with our breakpoint. Averaging them in makes our own
  // caching unreadable, so they are reported separately below.
  const wr = ratio(cur.clean);
  el('wr').textContent = wr.text;
  el('wr').style.color = wr.hot ? 'var(--hot)' : 'var(--cool)';
  el('wrSub').textContent = wr.sub;

  const missTok = cur.inp + cur.cw;
  const allTok = missTok + cur.cr;
  el('missPct').textContent = allTok
    ? ((missTok / allTok) * 100).toFixed(0) + '%'
    : '—';
  el('missSub').textContent =
    n(missTok) + ' of ' + n(allTok) + ' input tokens paid full rate';

  el('in').textContent = n(cur.inp);
  el('out').textContent = n(cur.out) + ' output';

  const note = el('toolNote');
  note.classList.toggle('hide', cur.dirty.calls === 0);
  note.textContent =
    cur.dirty.calls +
    ' of these calls ran a server tool. Those report the container’s own ' +
    'cache — ' + n(Math.round(cur.dirty.cr / (cur.dirty.calls || 1))) +
    ' read/call — which is not our breakpoint and is excluded above.';

  // Where the money went. This is the tail argument, made arithmetically.
  // Summed per call at that call's own rate, not at one model's rate.
  const rows0 = all.filter((r) => (r.run_id || '—') === cur.id);
  const acc = { input: 0, output: 0, write: 0, read: 0, search: 0 };
  for (const r of rows0) {
    const p = parts(r);
    if (!p) continue;
    for (const k of Object.keys(acc)) acc[k] += p[k];
  }
  const buckets = [
    ['input', acc.input, '#ff8a5c'],
    ['output', acc.output, '#8b9099'],
    ['cache write', acc.write, '#c9a5ff'],
    ['cache read', acc.read, '#5ccfa8'],
    ['web search', acc.search, '#7fb3ff'],
  ];
  const big = Math.max(...buckets.map((b) => b[1]), 1e-9);
  const totB = buckets.reduce((a, b) => a + b[1], 0) || 1;
  el('money').innerHTML = buckets.map(([k, v, c]) =>
    '<div class="r"><span class="lbl">' + k + '</span>'
    + '<span class="amt">' + usd(v) + '</span>'
    + '<span class="pct">' + Math.round((v / totB) * 100) + '%</span>'
    + '<span class="bar"><i style="width:' + (v / big) * 100
    + '%;background:' + c + '"></i></span></div>').join('');

  const unpriced = runs.reduce((a, r) => a + r.unpriced, 0);
  const inferred = runs.reduce((a, r) => a + r.inferred, 0);
  const warn = el('unpriced');
  warn.classList.toggle('hide', unpriced === 0 && inferred === 0);
  if (unpriced) {
    warn.textContent = unpriced + ' call' + (unpriced === 1 ? '' : 's') +
      ' could not be priced — no published rate for ' +
      [...unknownModels].join(', ') + '. Cost shown is an undercount.';
  } else if (inferred) {
    warn.textContent = inferred + ' call' + (inferred === 1 ? '' : 's') +
      ' were priced by this page, not by the meter — it holds no rate for ' +
      [...new Set(all.filter((r) => r.cost_usd === null).map((r) => r.model))]
        .join(', ') + '.';
  }

  // Newest run on top, so a re-run lands above the one it is beating.
  const shown = runs.slice().reverse();
  el('runRows').innerHTML = shown.map((r, i) => {
    const cls = i === 0 ? 'cur' : 'old';
    const label = r.label
      ? r.label
      : 'Run ' + r.n +
        '<span class="rid">' + String(r.id).slice(0, 8) + '</span>';
    const rr = ratio(r.clean);
    let html = '<tr class="' + cls + '">'
      + '<td>' + label + '</td>'
      + '<td>' + n(r.calls) + '</td>'
      + '<td class="' + (r.cw ? '' : 'zero') + '">' + per2(r.cw, r.calls) + '</td>'
      + '<td class="' + (r.cr ? '' : 'zero') + '">' + per2(r.cr, r.calls) + '</td>'
      + '<td class="' + (rr.hot ? 'miss' : 'hit') + '">' + rr.text + '</td>'
      + '<td>' + n(r.srch) + '</td>'
      + '<td>' + usd(r.cost) + '</td>'
      + '</tr>';
    // The delta line: only under the newest run, only once there is a
    // previous run to compare it against.
    if (i === 0 && shown.length > 1) {
      const prev = shown[1];
      if (prev.cost > 0) {
        const pct = ((prev.cost - r.cost) / prev.cost) * 100;
        const dir = pct >= 0 ? 'cheaper' : 'more expensive';
        html += '<tr class="delta"><td colspan="7">'
          + Math.abs(pct).toFixed(1) + '% ' + dir + ' than '
          + (prev.label || 'Run ' + prev.n)
          + '  ·  ' + usd(prev.cost) + ' → ' + usd(r.cost)
          + '</td></tr>';
      }
    }
    return html;
  }).join('');

  const rows = all.slice(-LAST_N).reverse();
  el('rows').innerHTML = rows.map((r) => {
    const t = new Date(r.ts).toLocaleTimeString('en-US', { hour12: false });
    const c = (v) => '<td class="' + (v ? '' : 'zero') + '">' + n(v || 0) + '</td>';

    // Per-call cost, split the way the bill is actually split.
    const p = parts(r) || { input: 0, output: 0, write: 0, read: 0, search: 0 };
    const cost = callCost(r);

    const missTok = (r.input_tokens || 0) + (r.cache_creation_input_tokens || 0);
    const allTok = missTok + (r.cache_read_input_tokens || 0);
    const miss = allTok ? (missTok / allTok) * 100 : 100;

    return '<tr class="main">'
      + '<td>' + t + '</td>'
      + c(r.input_tokens)
      + c(r.cache_creation_input_tokens)
      + c(r.cache_read_input_tokens)
      + c(r.output_tokens)
      + '<td class="v-only ' + (r.web_search_requests ? '' : 'zero') + '">'
      + n(r.web_search_requests || 0) + '</td>'
      + '<td class="' + (miss > 50 ? 'miss' : 'hit') + '">'
      + miss.toFixed(0) + '%</td>'
      + '<td class="v-only">' + n(Math.round(r.latency_ms / 100) / 10) + 's</td>'
      + '<td>' + (cost === null ? '—' : usd(cost)) + '</td>'
      + '</tr>'
      + '<tr class="sub v-only"><td colspan="9">'
      + 'in ' + usd(p.input) + '  ·  write ' + usd(p.write)
      + '  ·  read ' + usd(p.read) + '  ·  out ' + usd(p.output)
      + '  ·  search ' + usd(p.search)
      + (r.status === 'ok' ? '' : '  ·  <span class="err">' + r.status + '</span>')
      + '</td></tr>';
  }).join('');
}

// Clean by default. The toggle sticks, so a reload keeps the same view.
const btn = el('mode');
function setMode(verbose) {
  document.body.classList.toggle('clean', !verbose);
  btn.textContent = verbose ? 'CLEAN VIEW' : 'VERBOSE';
  try { localStorage.setItem('delegate.verbose', verbose ? '1' : '0'); } catch {}
}
let verbose = false;
try { verbose = localStorage.getItem('delegate.verbose') === '1'; } catch {}
setMode(verbose);
btn.onclick = () => { verbose = !verbose; setMode(verbose); };

// The call log steals the frame during a step, so it starts closed.
const callsBtn = el('callsToggle');
callsBtn.onclick = () => {
  const wrap = el('callsWrap');
  const open = wrap.classList.toggle('hide');
  callsBtn.textContent = open ? 'SHOW' : 'HIDE';
};

const stepBtn = el('step');
const poke = (route) => fetch(route, { method: 'POST' });
stepBtn.onclick = () => poke('/next');

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey) return;
  if (e.key === 'v') btn.click();
  if (!REPLAY) return;
  if (e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); poke('/next'); }
  if (e.key === 'r') poke('/reset');
});

const src = new EventSource('/events');
src.onmessage = (e) => { all.push(...JSON.parse(e.data)); render(); };
src.addEventListener('reset', () => { all.length = 0; location.reload(); });
src.onerror = () => { el('live').style.color = '#ff8a5c'; };
src.onopen = () => { el('live').style.color = '#5ccfa8'; };
</script>
</body>
</html>`

createServer((req, res) => {
  if (req.url === '/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    if (records.length) {
      res.write(`data: ${JSON.stringify(records)}\n\n`)
    }
    clients.add(res)
    req.on('close', () => clients.delete(res))
    return
  }
  // Both verbs, so the page can POST and a script can advance with curl.
  if (req.url === '/next') {
    releaseNext()
    res.writeHead(204).end()
    return
  }
  if (req.url === '/reset') {
    resetReplay()
    res.writeHead(204).end()
    return
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(PAGE)
}).listen(PORT, () => {
  console.log(`usage dashboard  http://localhost:${PORT}`)
  if (replay) {
    console.log(`replaying        ${replay.steps.length} steps`)
    replay.steps.forEach((b, i) =>
      console.log(`  ${i + 1}. ${b.label}  (${b.records.length} calls)`))
    console.log('advance          space / → in the page, or POST /next')
  } else {
    console.log(`tailing          ${FILE}`)
  }
})
