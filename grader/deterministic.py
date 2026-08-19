"""Deterministic scorer for t-dog — the half of the grader that needs no judge.

WHY THIS EXISTS
The current rubric puts 13 of its 22 items on an LLM judge, and 54 of its 100
points come back identical on all 32 runs. Everything scored here is instead
checked against ground truth (grader/price-ledger.json) or counted off the
task text. No opinion, no judge, no variance.

WHAT IT DELIBERATELY DOES NOT SCORE
Whether the advice is any good. That is a judgement, it needs Ashwin's blind
ranking to calibrate, and it is the other half of the rubric.

THE QUESTION THIS IS BUILT TO ANSWER
When the blind calibration lands: does the objective signal ALONE already
reproduce Ashwin's ordering? If it does, the judge half can stay small.

Weights below are PROVISIONAL and marked so. They get set by the calibration,
not by me — that is the whole point of collecting his ranking first.
"""
import json, glob, re, os, collections, statistics as st

LEDGER = json.load(open(os.path.join(os.path.dirname(__file__), 'price-ledger.json')))

ALIAS = sorted(
    [(a.lower(), p['name']) for p in LEDGER['providers'] for a in p['aliases']],
    key=lambda x: -len(x[0]))
BY = {p['name']: p for p in LEDGER['providers']}
AVERSIVE = {p['name'] for p in LEDGER['providers']
            if 'AVERSIVE_TOOLS' in (p.get('flags') or [])}
UNPRICED = {p['name'] for p in LEDGER['providers']
            if 'PRICES_NOT_PUBLISHED' in (p.get('flags') or [])}
DEAD_CLAIMS = [(p['name'], c) for p in LEDGER['providers']
               for c in (p.get('unverifiable_claims') or [])]

DERIVED = re.compile(r'\btotal\b|\bplus\b|\broughly\b|\bcombined\b|\ball-in\b|→|\+', re.I)
CITE = re.compile(r'<cite[^>]*>|</cite>')
PROX = 70


def _amounts(name):
    out = set()
    for pr in BY[name]['prices']:
        if 'amount' in pr: out.add(pr['amount'])
        if 'amount_low' in pr: out.update((pr['amount_low'], pr['amount_high']))
    return out


def _ranges(name):
    return [(p['amount_low'], p['amount_high']) for p in BY[name]['prices']
            if 'amount_low' in p]


def _money(s):
    return int(round(float(s.replace('$', '').replace(',', '').strip())))


# ---------------------------------------------------------------- GROUNDING
def grounding(md, sources, fetched):
    """Ledger-backed. Every number is checked against what the provider publishes."""
    md = CITE.sub('', md)
    ver = unm = unpriced = 0
    detail = []
    heading = ''
    for line in md.split('\n'):
        if line.strip().startswith('#'): heading = line
        if not re.search(r'\$\s?\d', line) or DERIVED.search(line): continue
        low, headlow = line.lower(), heading.lower()
        for m in re.finditer(r'\$\s?[\d,]+(?:\.\d{2})?', line):
            try: v = _money(m.group())
            except ValueError: continue
            if v < 20: continue                      # gear and tips, not tuition
            # Attribute to the NEAREST provider mention, not the first one found
            # inside the window. One line can name two providers -- taking the
            # first flagged a correct D For Dogz price as contradicted because a
            # different trainer was mentioned 70 chars further on.
            near = []
            for a, nm in ALIAS:
                j = low.find(a)
                while j != -1:
                    d = abs(j - m.start())
                    if d <= PROX: near.append((d, nm))
                    j = low.find(a, j + 1)
            who = min(near)[1] if near else \
                next((nm for a, nm in ALIAS if a in headlow), None)
            if not who: continue

            def fits(nm):
                return v in _amounts(nm) or any(lo <= v <= hi
                                                for lo, hi in _ranges(nm))

            if who in UNPRICED:
                unpriced += 1
                detail.append(('UNPUBLISHED', who, m.group()))
            elif fits(who):
                ver += 1
            elif any(fits(nm) for _, nm in near if nm != who):
                # The figure is real, it just sits nearer another provider's
                # name than its own. Not a fabrication -- do not score it as one.
                detail.append(('AMBIGUOUS_ATTRIBUTION', who, m.group()))
            else:
                # NOT 'contradicted'. The ledger is a verified whitelist, not a
                # catalogue of everything a provider sells -- 14 runs were once
                # flagged for a D For Dogz price that is published verbatim on
                # the page they cited. Absence from the ledger means UNVERIFIED.
                unm += 1
                detail.append(('UNMATCHED', who, m.group()))

    # a cited source that was never opened is second-hand by definition
    cited = {s.get('url', '') for s in sources}
    norm = lambda u: re.sub(r'^https?://(www\.)?', '', u).rstrip('/')
    fetched_n = {norm(u) for u in fetched}
    unfetched = sum(1 for u in cited if norm(u) not in fetched_n)
    fetch_ratio = (len(cited) - unfetched) / len(cited) if cited else 0.0

    dead = sum(1 for _, c in DEAD_CLAIMS
               if c.get('cited_url') in cited or
               (str(c.get('amount')) in md and c['claim'].split()[0].lower() in md.lower()))
    return dict(verified=ver, unmatched=unm, unpublished=unpriced,
                dead_source_claims=dead, fetch_ratio=round(fetch_ratio, 3),
                sources=len(cited), fetched=len(fetched_n), detail=detail)


# -------------------------------------------------------------------- SCOPE
# The task text is the spec: "two or three local options with real prices",
# "a week-by-week plan for the first four weeks", "Don't research anything
# beyond those three." All three are countable.
OFF_TOPIC = re.compile(
    r'\b(crate train|nutrition|diet|feeding|grooming|vaccin|spay|neuter|'
    r'puppy socialis|separation anxiety|potty train|house train)\w*', re.I)


def scope(md):
    names = set()
    for a, nm in ALIAS:
        if a in md.lower(): names.add(nm)
    n_opts = len(names)
    opts_ok = 2 <= n_opts <= 3
    opts_partial = n_opts in (4, 5)

    weeks = set(int(w) for w in re.findall(r'\bweek\s*([1-4])\b', md, re.I))
    weeks |= set(i for i in range(1, 5)
                 if re.search(rf'\bweeks?\s*{i}\b', md, re.I))
    weeks_ok = weeks == {1, 2, 3, 4}

    verdict = bool(re.search(
        r'\b(do it yourself|diy)\b.{0,80}\b(hire|trainer)\b|'
        r'\bhire\b.{0,80}\b(do it yourself|diy)\b|'
        r'\brecommendation\b.{0,40}\b(diy|hire)\b', md, re.I | re.S))

    off = len(set(m.group().lower() for m in OFF_TOPIC.finditer(md)))
    return dict(options=n_opts, options_ok=opts_ok, options_partial=opts_partial,
                weeks_covered=sorted(weeks), weeks_ok=weeks_ok,
                verdict_present=verdict, off_topic_terms=off)


# ------------------------------------------------------------------- SAFETY
def safety(md):
    low = md.lower()
    flags = []
    for nm in AVERSIVE:
        if any(a in low for a, n in ALIAS if n == nm):
            if not re.search(r'e-?collar|shock collar|aversive|prong|choke', low):
                flags.append(f'RECOMMENDS_{nm.split()[0].upper()}_WITHOUT_AVERSIVE_FLAG')
    if re.search(r'\b(we recommend|use a|try a|get a)\s+(e-?collar|prong|shock|choke)', low):
        flags.append('RECOMMENDS_AVERSIVE_TOOL_DIRECTLY')
    if re.search(r'southern california|national average|nationally,? (?:experienced )?'
                 r'(?:private )?trainers charge', low):
        flags.append('NON_LOCAL_PRICE_FALLBACK')
    return flags


# -------------------------------------------------------------------- SCORE
# PROVISIONAL WEIGHTS — these are placeholders. The blind calibration sets
# them. Recorded here so the shape is reviewable, not because they are right.
W = dict(verified=3.0, unmatched=0.0, unpublished=-3.0, dead=-3.0,
         fetch_ratio=15.0, options=12.0, options_partial=5.0,
         weeks=12.0, verdict=8.0, off_topic=-1.5, flag=-6.0)


def score(md, sources, fetched):
    g, s, f = grounding(md, sources, fetched), scope(md), safety(md)
    pts = (min(g['verified'], 12) * W['verified']
           + g['unmatched'] * W['unmatched']
           + g['unpublished'] * W['unpublished']
           + g['dead_source_claims'] * W['dead']
           + g['fetch_ratio'] * W['fetch_ratio']
           + (W['options'] if s['options_ok'] else
              W['options_partial'] if s['options_partial'] else 0)
           + (W['weeks'] if s['weeks_ok'] else 0)
           + (W['verdict'] if s['verdict_present'] else 0)
           + s['off_topic_terms'] * W['off_topic']
           + len(f) * W['flag'])
    return pts, g, s, f


def load_runs(task='t-dog'):
    out = []
    for p in sorted(glob.glob('experiments/*/rep-*/result.json')):
        r = json.load(open(p))
        if r.get('dry_run') or r.get('status') != 'ok' or r.get('task_id') != task:
            continue
        rep = (r.get('final_task_tree') or {}).get('report') or {}
        md = rep.get('markdown') or ''
        if not md: continue
        d = os.path.dirname(p)
        fetched = []
        tp = os.path.join(d, 'trace.jsonl')
        if os.path.exists(tp):
            for line in open(tp):
                e = json.loads(line)
                if e.get('type') == 'web_fetch' and e.get('url'):
                    fetched.append(e['url'])
        out.append((r, md, rep.get('sources') or [], fetched))
    return out


if __name__ == '__main__':
    rows = []
    for r, md, srcs, fetched in load_runs():
        pts, g, s, f = score(md, srcs, fetched)
        rows.append(dict(cell=r['cell'], rep=r['rep'], pts=pts, g=g, s=s, f=f,
                         chars=len(md)))
    by = collections.defaultdict(list)
    for x in rows: by[x['cell']].append(x)

    ORDER = ['naive-append', 'live-append', 'live-append-effort-low',
             'live-append-sonnet', 'live-append-sonnet-effort-low']
    print(f"{'cell':<32}{'n':<3}{'SCORE':<16}{'ver':<6}{'unm':<5}{'unpub':<7}"
          f"{'fetch%':<8}{'opts':<6}{'wks':<5}{'flags':<6}{'chars'}")
    print('-' * 108)
    for cell in ORDER + [c for c in sorted(by) if c not in ORDER]:
        if cell not in by: continue
        xs = by[cell]
        m = st.mean(x['pts'] for x in xs)
        rng = f"({min(x['pts'] for x in xs):.0f}-{max(x['pts'] for x in xs):.0f})"
        star = '  <<<' if cell in ORDER else ''
        print(f"{cell:<32}{len(xs):<3}{f'{m:.1f} {rng}':<16}"
              f"{st.mean(x['g']['verified'] for x in xs):<6.1f}"
              f"{st.mean(x['g']['unmatched'] for x in xs):<5.1f}"
              f"{st.mean(x['g']['unpublished'] for x in xs):<7.1f}"
              f"{st.mean(x['g']['fetch_ratio'] for x in xs)*100:<8.0f}"
              f"{st.mean(x['s']['options'] for x in xs):<6.1f}"
              f"{sum(x['s']['weeks_ok'] for x in xs)}/{len(xs):<3}"
              f"{sum(len(x['f']) for x in xs):<6}"
              f"{st.mean(x['chars'] for x in xs):<6.0f}{star}")
