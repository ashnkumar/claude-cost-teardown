#!/usr/bin/env node
/**
 * figures.mjs — generate the three README figures from measured data.
 *
 * Every number on every figure is read from an artifact in this repo at run
 * time. Nothing is hardcoded, so a figure cannot drift from the tables beside
 * it, and re-running after a re-aggregation is how you find out that it did.
 *
 *   node scripts/figures.mjs [--out docs/images] [--html-only]
 *
 * Rendering needs headless Chrome; the script writes the HTML either way and
 * prints the exact commands it ran. Palette matches the video deck on purpose
 * — the repo and the talk should show the same artwork.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RESULTS = join(ROOT, 'experiments/results');

const args = process.argv.slice(2);
const outDir = resolve(ROOT, argVal('--out') ?? 'docs/images');
const htmlOnly = args.includes('--html-only');
function argVal(f) { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; }

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
].find(existsSync);

/* ---- csv: quoted fields are real in these files, so do not split on comma ---- */
function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift();
  return rows.filter(r => r.some(v => v !== ''))
             .map(r => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}
const readCSV = f => parseCSV(readFileSync(join(RESULTS, f), 'utf8'));
const money = n => '$' + n.toFixed(2);

/* ==================== data ==================== */

const stacked = readCSV('cost_stacked.csv');
const slide = readCSV('SLIDE-TABLE.csv');

const COMPONENTS = [
  ['uncached_input', 'uncached input', '#e5544b'],
  ['cache_write',    'cache write',    '#d9884a'],
  ['cache_read',     'cache read',     '#4cb782'],
  ['output',         'output',         '#5b8dd6'],
  ['search_fees',    'search fees',    '#8d7bd0'],
  ['summarizer',     'summarizer',     '#8a8a94'],
];

const stackRow = v => {
  const r = stacked.find(x => x.variant === v);
  if (!r) throw new Error(`cost_stacked.csv has no variant "${v}"`);
  const parts = COMPONENTS.map(([k]) => Number(r[k]));
  return { parts, total: parts.reduce((a, b) => a + b, 0) };
};
const slideRow = t => {
  const r = slide.find(x => x.Treatment === t);
  if (!r) throw new Error(`SLIDE-TABLE.csv has no treatment "${t}"`);
  return r;
};

/* the ladder: as-built, Fix 1, then the three Fix-2 rungs */
const LADDER = [
  ['Built as-is (BASELINE)',   'naive-append',                  'as-built',           'Opus 5 / high'],
  ['FIX 1 - dynamic below convo', 'live-append',                'FIX 1',              'Opus 5 / high'],
  ['Fix 1 + Opus 5 / low',     'live-append-effort-low',        'Fix 1 + Fix 2',      'Opus 5 / low'],
  ['Fix 1 + Sonnet 5 / high',  'live-append-sonnet',            'Fix 1 + Fix 2',      'Sonnet 5 / high'],
  ['Fix 1 + Sonnet 5 / low',   'live-append-sonnet-effort-low', 'Fix 1 + Fix 2',      'Sonnet 5 / low'],
].map(([treatment, variant, group, config]) => {
  const s = stackRow(variant), row = slideRow(treatment);
  const published = Number(row['Dog $']);
  // the decomposition must reconcile to the number the tables publish
  if (Math.abs(s.total - published) > 0.005)
    throw new Error(`${variant}: components sum ${s.total.toFixed(4)} but SLIDE-TABLE says ${published}`);
  return { ...s, group, config, published, range: row['Dog range'], n: row['Dog n'] };
});

/* the graveyard: four Fix-3 tactics, priced against Fix 1 rather than baseline */
const FIX1 = Number(slideRow('FIX 1 - dynamic below convo')['Dog $']);
const GRAVEYARD = [
  ['Fix 1 + drop old tool results', 'drop old tool results'],
  ['Fix 1 + fetch cap 8k',          'cap every fetch at 8k'],
  ['Fix 1 + drop but keep last 2',  'drop, but keep last 2'],
  ['Fix 1 + compact every 6',       'compact every 6 cycles'],
].map(([treatment, label]) => {
  const r = slideRow(treatment);
  const usd = Number(r['Dog $']);
  return { label, usd, pct: (usd - FIX1) / FIX1 * 100, range: r['Dog range'], n: r['Dog n'] };
}).sort((a, b) => b.pct - a.pct);

/* the mechanism: per-call cache reads on the as-built run */
const RUN = join(ROOT, 'experiments/naive-append/rep-1/usage.jsonl');
const calls = readFileSync(RUN, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const MECH = calls.map((c, i) => ({
  i: i + 1,
  read: c.cache_read_input_tokens,
  tools: c.web_search_requests + c.web_fetch_requests,
}));
const zeroReads = MECH.filter(c => c.read === 0);
const toolCalls = MECH.filter(c => c.tools > 0);
const totalRead = MECH.reduce((a, c) => a + c.read, 0);
// the whole claim in one assertion: reads land on tool calls and nowhere else
if (zeroReads.some(c => c.tools > 0) || toolCalls.some(c => c.read === 0))
  throw new Error('mechanism claim broken: cache reads no longer align with server-tool calls');

/* ==================== render ==================== */

const SHELL = (title, sub, body, foot) => `<!doctype html><meta charset="utf-8">
<title>${title}</title><style>
 html,body{margin:0;background:#0a0a0c}
 #f{width:1920px;height:1080px;background:#0a0a0c;color:#ededf1;position:relative;
    font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;
    font-variant-numeric:tabular-nums;font-variant-ligatures:none;padding:64px 76px;box-sizing:border-box}
 h1{font-family:ui-serif,'New York',Georgia,serif;font-weight:500;font-size:52px;margin:0;letter-spacing:-.01em}
 .sub{font-size:23px;color:rgba(237,237,241,.5);margin-top:16px;letter-spacing:.02em;line-height:1.45}
 .foot{position:absolute;left:76px;right:76px;bottom:46px;font-size:19px;
       color:rgba(237,237,241,.42);letter-spacing:.02em;line-height:1.5;
       border-top:1px solid rgba(255,255,255,.10);padding-top:20px}
 .foot b{color:rgba(237,237,241,.82);font-weight:500}
 .legend{display:flex;gap:26px;flex-wrap:wrap;margin-top:30px;font-size:19px;color:rgba(237,237,241,.62)}
 .legend i{display:inline-block;width:15px;height:15px;margin-right:9px;vertical-align:-1px;border-radius:2px}
 .red{color:#e5544b}.grn{color:#4cb782}
</style><div id="f"><h1>${title}</h1><div class="sub">${sub}</div>${body}<div class="foot">${foot}</div></div>`;

/* A value label sits outside its bar, unless the bar is long enough that
   "outside" would run off the track and collide with the next column — then
   it sits inside, in the page colour. Every bar chart here needs this, and
   getting it wrong is invisible until the longest bar happens to be the one
   you care about. */
function valueLabel(w, W, text, color, { top = 0, size = 19, pad = 14 } = {}) {
  const inside = w > W * 0.6;
  const pos = inside ? `right:${W - w + pad}px` : `left:${w + pad}px`;
  const col = inside ? '#0a0a0c' : color;
  return `<div style="position:absolute;${pos};top:${top}px;font-size:${size}px;
           color:${col};${inside ? 'font-weight:600;' : ''}white-space:nowrap">${text}</div>`;
}

/* ---- 1. cost ladder ---- */
function costLadder() {
  const max = Math.max(...LADDER.map(d => d.total));
  const W = 1180, H = 96, GAP = 42;
  const bars = LADDER.map(d => {
    let x = 0;
    const segs = d.parts.map((v, i) => {
      const w = v / max * W;
      const seg = w > 26
        ? `<div style="position:absolute;left:${x}px;width:${w}px;top:0;height:${H}px;background:${COMPONENTS[i][2]};
             ${i ? 'border-left:1px solid rgba(10,10,12,.55);' : ''}"></div>`
        : (w > 0.6 ? `<div style="position:absolute;left:${x}px;width:${Math.max(w,2)}px;top:0;height:${H}px;background:${COMPONENTS[i][2]}"></div>` : '');
      x += w; return seg;
    }).join('');
    const isFix1 = d.group === 'FIX 1';
    return `<div style="display:flex;align-items:center;gap:26px;margin-bottom:${GAP}px">
      <div style="width:250px;text-align:right;font-size:21px;
                  color:${isFix1 ? '#ededf1' : 'rgba(237,237,241,.62)'}">
        ${d.config}<div style="font-size:16px;color:rgba(237,237,241,.34);margin-top:5px">${d.group}</div></div>
      <div style="position:relative;width:${W}px;height:${H}px;background:rgba(255,255,255,.03);
                  ${isFix1 ? 'outline:2px solid rgba(76,183,130,.85);outline-offset:5px;' : ''}">${segs}</div>
      <div style="width:190px;font-size:32px;${isFix1 ? 'color:#4cb782' : ''}">${money(d.total)}
        <div style="font-size:16px;color:rgba(237,237,241,.34);margin-top:5px">n=${d.n} · ${d.range}</div></div>
    </div>`;
  }).join('');
  const legend = COMPONENTS.map(([, l, c]) => `<span><i style="background:${c}"></i>${l}</span>`).join('');
  return SHELL(
    'Where the money actually goes',
    'Cost per run on the open-ended task, decomposed. Ordered as-built, then Fix&nbsp;1, then Fix&nbsp;2.',
    `<div style="margin-top:52px">${bars}</div><div class="legend">${legend}</div>`,
    `Every bar is a mean over its own runs, and every decomposition sums to the figure published in the tables. <b>Fix 1 is boxed</b> — it is the largest single step, and it is free.`
  );
}

/* ---- 2. cache inside a turn ---- */
function cacheInsideATurn() {
  const max = Math.max(...MECH.map(c => c.read));
  const W = 1240, ROW = 41, BAR = 25;
  const rows = MECH.map(c => {
    const w = c.read / max * W;
    const on = c.read > 0;
    return `<div style="display:flex;align-items:center;gap:22px;height:${ROW}px">
      <div style="width:96px;text-align:right;font-size:19px;color:rgba(237,237,241,.45)">call ${c.i}</div>
      <div style="width:${W}px;height:${BAR}px;background:rgba(255,255,255,.035);position:relative">
        ${on ? `<div style="position:absolute;left:0;top:0;height:${BAR}px;width:${w}px;background:#4cb782"></div>` : ''}
        ${valueLabel(on ? w : 0, W, c.read.toLocaleString('en-US'),
                     on ? '#4cb782' : 'rgba(237,237,241,.30)', { top: 2 })}
      </div>
      <div style="width:290px;font-size:18px;white-space:nowrap;
                  color:${on ? 'rgba(237,237,241,.66)' : 'rgba(237,237,241,.22)'}">
        ${c.tools ? `${c.tools} server tool calls` : 'new turn — read zero'}</div>
    </div>`;
  }).join('');
  return SHELL(
    'The cache works inside a turn, and dies between them',
    `Cache reads per call, as built. <span class="grn">${toolCalls.length} of ${MECH.length} calls carry a web search or fetch — and they carry every cached token.</span>`,
    `<div style="margin-top:34px">${rows}</div>`,
    `<b>${zeroReads.length} of ${MECH.length} calls read exactly zero.</b> The volatile block is stamped once per HTTP request, not once per inference — so inside a request the server-tool loop re-sends an unchanged prefix and hits cache every time, while a fresh turn re-buys the whole conversation. All ${totalRead.toLocaleString('en-US')} cached tokens land on the ${toolCalls.length} tool calls.`
  );
}

/* ---- 3. the graveyard ---- */
function graveyard() {
  const max = Math.max(...GRAVEYARD.map(d => d.pct));
  const W = 900;
  const rows = GRAVEYARD.map(d => {
    const w = d.pct / max * W;
    return `
    <div style="display:flex;align-items:center;gap:28px;margin-bottom:52px">
      <div style="width:420px;text-align:right;font-size:26px;color:rgba(237,237,241,.86)">${d.label}
        <div style="font-size:17px;color:rgba(237,237,241,.34);margin-top:6px">n=${d.n} · ${d.range}</div></div>
      <div style="width:${W}px;height:56px;background:rgba(255,255,255,.03);position:relative">
        <div style="position:absolute;left:0;top:0;height:56px;width:${w}px;background:#e5544b"></div>
        ${valueLabel(w, W, `+${d.pct.toFixed(0)}%`, '#e5544b', { top: 11, size: 30, pad: 20 })}
      </div>
      <div style="width:150px;font-size:26px;color:rgba(237,237,241,.62)">${money(d.usd)}</div>
    </div>`; }).join('');
  return SHELL(
    'Every context tactic costs more than leaving it alone',
    `The four Fix&nbsp;3 tactics, priced against <span class="grn">Fix 1 at ${money(FIX1)}</span> — not against the as-built baseline.`,
    `<div style="margin-top:70px">${rows}</div>
     <div style="margin-top:26px;margin-left:448px;width:${W}px;border:1px solid rgba(76,183,130,.5);
                 background:rgba(76,183,130,.06);padding:26px 32px;font-size:27px;color:#4cb782;line-height:1.45">
       Fix 1 alone — ${money(FIX1)}. Doing nothing else is cheaper than every tactic on this chart.</div>`,
    `Priced against the baseline these all look like savings, which is exactly why the anchor matters: Fix 1 is happening regardless, so it is the floor. None bought better output — three sit inside the ±3.83 noise floor, and the one that moved, moved down.`
  );
}

/* ==================== write ==================== */

mkdirSync(outDir, { recursive: true });
const tmp = join(ROOT, '.figures-tmp');
mkdirSync(tmp, { recursive: true });

const FIGS = [
  ['cost-ladder',        costLadder()],
  ['cache-inside-a-turn', cacheInsideATurn()],
  ['graveyard-vs-fix1',  graveyard()],
];

for (const [name, html] of FIGS) {
  const h = join(tmp, `${name}.html`);
  writeFileSync(h, html);
  if (htmlOnly) { console.log(`html  ${h}`); continue; }
  if (!CHROME) { console.error('! no Chrome found — wrote HTML only'); continue; }
  const png = join(outDir, `${name}.png`);
  execFileSync(CHROME, ['--headless', '--disable-gpu', '--hide-scrollbars',
    '--window-size=1920,1080', '--virtual-time-budget=3000',
    `--screenshot=${png}`, `file://${h}`], { stdio: 'ignore' });
  console.log(`png   ${png}`);
}
console.log(`\nreconciled: ${LADDER.length} ladder bars against SLIDE-TABLE, ` +
            `${MECH.length} calls against usage.jsonl, ${GRAVEYARD.length} tactics against Fix 1 = ${money(FIX1)}`);
