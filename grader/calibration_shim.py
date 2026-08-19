"""Shared loaders + the feature set for the round-1 calibration.

Imported by calibration-analysis.py (the sweep) and fit-round1.py (the fit).
Original docstring:

What Ashwin's blind ranking actually says, and what it says about the graders.

Round 1: 8 blind pairs + 2 solo ship/no-ship reads on t-dog. A/B were randomised
and every label stripped, so this is the only signal in the project that is not
downstream of a rubric I wrote.

Three questions, in order:
  1. Does the OLD rubric (grade.json, 100 pts, 13 LLM-judge items) reproduce his
     ordering?
  2. Does the judge-free half (deterministic.py) reproduce it?
  3. Which measurable features DO reproduce it — i.e. what should the new rubric
     weight?

Read the CAVEAT block at the bottom of the output before trusting any weight.
"""
import json, os, re, sys, itertools, statistics as st

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import deterministic as D                                    # noqa: E402

# ---------------------------------------------------------------- his answers
# AA = A clearly better · Aa = A slightly · tie · Bb = B slightly · BB = B clearly
HIS = dict(pair1='AA', pair2='Bb', pair3='Aa', pair4='Aa', pair5='Aa',
           pair6='AA', pair7='AA', pair8='BB')
SHIP = dict(ship1='bad', ship2='ship')
STRENGTH = {'AA': 2, 'Aa': 1, 'tie': 0, 'Bb': -1, 'BB': -2}
SHIP_PTS = {'ship': 3, 'minor': 2, 'no': 1, 'bad': 0}

# ------------------------------------------------------- the withheld answer key
# `calibration-key-round1.json` maps each blind pair to the two runs behind it.
# It is withheld from the public cut by exact path and again by pattern, because
# publishing it would retroactively unblind the only signal in this project that
# is not downstream of a rubric I wrote.
#
# HIS, SHIP and STRENGTH above are inline and need none of it, so the three
# scripts that import only those work without the key — and used to die anyway,
# because this module called json.load() at import time. Six entry points in the
# public cut opened with a FileNotFoundError traceback, which reads as "this repo
# is broken" rather than "this input is deliberately absent".
#
# With the key absent: PAIRS and SHIPS are empty, and require_key() stops the two
# analyses that walk them with one sentence and exit code 0. Zero on purpose —
# the withholding is a documented property of the public cut, not a runtime
# error, so the pre-publish check can hold every shipped entry point to one bar:
# it runs, it explains itself, and it never prints a traceback.
KEY_PATH = os.path.join(HERE, 'calibration-key-round1.json')
HAVE_KEY = os.path.exists(KEY_PATH)
KEY = json.load(open(KEY_PATH)) if HAVE_KEY else None
PAIRS = ({f"pair{p['pair']}": (p['A'], p['B'], p['title']) for p in KEY['pairs']}
         if HAVE_KEY else {})
SHIPS = {f"ship{s['item']}": s['run'] for s in KEY['ship']} if HAVE_KEY else {}


def require_key(what='This analysis'):
    """Exit with an explanation rather than a traceback when the key is absent."""
    if HAVE_KEY:
        return
    print(f"{what} needs grader/calibration-key-round1.json, and that file is "
          f"withheld from the public cut on purpose: it maps each blind pair to "
          f"the runs behind it, so publishing it would unblind the ranking. "
          f"This analysis cannot be re-run here — its output is quoted in "
          f"grader/README.md, and the two judge-free analyses "
          f"(deterministic.py, score-sweep.py) do run.", file=sys.stderr)
    sys.exit(0)


# ------------------------------------------------------------------ run loading
def load(run):
    d = os.path.join(REPO, 'experiments', run)
    r = json.load(open(os.path.join(d, 'result.json')))
    rep = (r.get('final_task_tree') or {}).get('report') or {}
    md = rep.get('markdown') or ''
    srcs = rep.get('sources') or []
    fetched = []
    tp = os.path.join(d, 'trace.jsonl')
    if os.path.exists(tp):
        for line in open(tp):
            e = json.loads(line)
            if e.get('type') == 'web_fetch' and e.get('url'):
                fetched.append(e['url'])
    old = None
    gp = os.path.join(d, 'grade.json')
    if os.path.exists(gp):
        g = json.load(open(gp))
        old = g.get('score_total') or g.get('total')
    return dict(run=run, md=md, srcs=srcs, fetched=fetched, old=old,
                cost=r.get('cost_usd_total') or (r.get('cost') or {}).get('total_usd'),
                tree=r.get('final_task_tree') or {})


# -------------------------------------------------------------------- features
# Every one of these is something he named unprompted in a "why" line. Nothing
# here was chosen because it was easy to measure.
# The week block is found by its CONTENT, not by one heading pattern. Reports
# disagree about everything cosmetic: some number their sections with `#`, some
# with `##`; some give each week its own heading, some put all four in one table.
# An earlier heading that merely says "check this in Week 1" is not the block.
WEEK_SECTION = re.compile(r'(four[- ]week|weeks?\s*1\s*[-–—]?\s*4|weeks?\s*1|'
                          r'week[- ]by[- ]week|first four|4[- ]week)', re.I)
WEEK_MARKER = re.compile(r'^(#{1,6})\s.*\bweek\s*([1-4])\b|'
                         r'^\**\s*week\s*([1-4])\b', re.I)
WEEK_ITEM = WEEK_MARKER
ADVANCE = re.compile(
    r"move on when|advance when|ready when|don'?t (?:move|progress|advance) until|"
    r"only when|before you move|criteri|progress(?:ion)? (?:gate|rule)|"
    r"you'?ll know .{0,40}when|when (?:she|he|they) can", re.I)
PUNT = re.compile(r"in the subtask|see the subtask|in each (?:subtask|description)|"
                  r"what'?s in the tree|each of these is a subtask|"
                  r"details? (?:are )?in the subtask", re.I)
CRED = re.compile(r'CPDT-KA|KPA-CTP|KPA\b|IAABC|CCPDT|CBCC|VSA-CDT|'
                  r'certified (?:professional )?dog trainer', re.I)
NEXT = re.compile(r'^#{2,4}\s.*(what to do this week|your next|next \w+ moves|'
                  r'do this week|start here|bottom line)', re.I)
NOTPUB = re.compile(r'not (?:publicly )?(?:advertis|publish|listed)|'
                    r'price on call|call for (?:a )?(?:price|quote)|'
                    r'prices? (?:are )?not (?:on|listed)', re.I)


def sections(md):
    """(level, heading, body) for every heading in the report."""
    out, cur = [], None
    for line in md.split('\n'):
        m = re.match(r'^(#{1,6})\s+(.*)', line)
        if m:
            if cur: out.append(cur)
            cur = [len(m.group(1)), m.group(2), []]
        elif cur:
            cur[2].append(line)
    if cur: out.append(cur)
    return [(l, h, '\n'.join(b)) for l, h, b in out]


def features(r):
    md, secs = r['md'], sections(r['md'])
    g = D.grounding(md, r['srcs'], r['fetched'])
    s = D.scope(md)

    # --- the week-by-week block: how much of it there is, and how it is shaped
    # Score every candidate section by how many of weeks 1-4 its own subtree
    # actually covers, and take the winner. That survives both heading-level
    # disagreement and passing mentions of "Week 1" in unrelated prose.
    def subtree(i):
        lvl, _, body = secs[i]
        out = [body]
        for lvl2, h2, b2 in secs[i + 1:]:
            if lvl2 <= lvl: break
            out.append('#' * lvl2 + ' ' + h2 + '\n' + b2)
        return '\n'.join(out)

    def weeks_in(text):
        """Weeks 1-4 covered — as headings, as bold labels, or as table rows.
        The table case matters: a report can hold all four weeks in a grid whose
        first column is just `| **1** |`."""
        got, week_col = set(), False
        for line in text.split('\n'):
            m = WEEK_MARKER.match(line)
            if m:
                got.add(m.group(2) or m.group(3)); continue
            if re.match(r'^\|\s*(?:\*\*)?\s*week\b', line, re.I): week_col = True
            row = re.match(r'^\|\s*(?:\*\*)?\s*(?:week\s*)?([1-4])\s*(?:\*\*)?\s*\|',
                           line, re.I)
            if row and (week_col or re.search(r'week', line, re.I)):
                got.add(row.group(1))
        return got

    # Most weeks covered wins; then the DEEPEST such section (the H1 title's
    # subtree is the whole report and would otherwise always win); then the
    # tightest.
    best = (0, -99, 0, '')
    for i, (lvl, h, _) in enumerate(secs):
        t = subtree(i)
        n = len(weeks_in(t))
        if n < 2 and not (WEEK_SECTION.search(h) and weeks_in(t)):
            continue
        cand = (n, lvl, -len(t), t)
        if cand[:3] > best[:3]: best = cand
    week_body = best[3]
    week_chars = len(week_body)
    per_week = len(weeks_in(week_body))
    advance = len(ADVANCE.findall(week_body))

    # --- per-option depth: he penalised "detail on the recommendation only"
    named, opt_chars = set(), []
    for a, nm in D.ALIAS:
        if a in md.lower(): named.add(nm)
    for i, (lvl, h, body) in enumerate(secs):
        who = next((nm for a, nm in D.ALIAS if a in h.lower()), None)
        if not who: continue
        chunk = len(body)
        for lvl2, h2, b2 in secs[i + 1:]:
            if lvl2 <= lvl: break
            chunk += len(h2) + len(b2)
        opt_chars.append((who, chunk))
    best = {}
    for who, c in opt_chars:
        best[who] = max(best.get(who, 0), c)
    detailed = {w for w, c in best.items() if c >= 350}
    # A provider written up as a TABLE COLUMN or ROW counts too. The
    # heading-only version scored a full comparison matrix -- Who / Format /
    # Price / Typical total / Evenings-weekends / Contact across three
    # providers -- as ZERO, because the providers were columns rather than
    # headings. It was measuring format, not depth, and it manufactured a
    # clean separation between the cheap and expensive cells that does not
    # survive this fix. Left in the record deliberately.
    lines = md.split('\n')
    for i, l in enumerate(lines):
        if not l.strip().startswith('|'): continue
        cells = [c.strip() for c in l.strip('|').split('|')]
        col_hits = {nm for c in cells for a, nm in D.ALIAS if a in c.lower()}
        if len(col_hits) >= 2:
            filled = 0
            for l2 in lines[i + 1:]:
                if not l2.strip().startswith('|'): break
                if set(l2.replace('|', '').strip()) <= set('- :'): continue
                if len([c for c in l2.strip('|').split('|') if c.strip()]) >= 3:
                    filled += 1
            if filled >= 3: detailed |= col_hits
        if len([c for c in cells if c]) >= 3:
            detailed |= {nm for a, nm in D.ALIAS if a in (cells[0] or '').lower()}
    detailed = len(detailed)

    return dict(
        chars=len(md),
        week_chars=week_chars,
        per_week_sections=per_week,
        advance=advance,
        options_named=len(named),
        options_with_own_section=len(best),
        options_detailed=detailed,
        punt=len(PUNT.findall(md)),
        tables=md.count('|---'),
        creds=len(set(x.lower() for x in CRED.findall(md))),
        next_moves=sum(1 for l, h, _ in secs if NEXT.match('#' * l + ' ' + h)),
        not_published=len(NOTPUB.findall(md)),
        verified=g['verified'],
        unmatched=g['unmatched'],
        unpublished=g['unpublished'],
        fetch_ratio=g['fetch_ratio'],
        sources=g['sources'],
        weeks_ok=int(s['weeks_ok']),
        det_score=D.score(md, r['srcs'], r['fetched'])[0],
    )


