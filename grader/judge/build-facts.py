"""Precompute the FACTS block the judge is handed for each run.

The judge does the judging; this does the counting. Everything here is measured
off the run's own artifacts and checked against grader/price-ledger.json — no
opinion, no model call. Written out as JSON so the facts are an inspectable
artifact rather than something assembled inside the request builder.

  python3 grader/judge/build-facts.py [--task=t-dog] [--only=cell/rep,...]

Writes grader/judge/facts/<task>/<cell>__<rep>.json
"""
import argparse, glob, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
GRADER = os.path.dirname(HERE)
REPO = os.path.dirname(GRADER)
sys.path.insert(0, GRADER)
import deterministic as D                                        # noqa: E402

LEDGER = D.LEDGER
STATUTES = json.load(open(os.path.join(GRADER, 'statute-ledger.json')))


def roster():
    """Local providers verified to exist, with what they publish.

    Labelled non-exhaustive on purpose: the judge must not read absence from
    this list as evidence a provider does not exist.
    """
    out = []
    for p in LEDGER['providers']:
        if 'PRICES_NOT_PUBLISHED' in (p.get('flags') or []):
            money = 'publishes no prices'
        else:
            bits = []
            for pr in p['prices'][:4]:
                bits.append(f"{pr.get('item', '?')} {pr.get('display', '')}".strip())
            money = '; '.join(bits)
            if len(p['prices']) > 4:
                money += f"; +{len(p['prices']) - 4} more"
        note = ''
        if 'AVERSIVE_TOOLS' in (p.get('flags') or []):
            note = '  [method uses e-collar / aversive tools]'
        out.append(f"- {p['name']} ({p['domain']}) — {money}{note}")
    # The ledger's `pending` field is my own TODO list, not data -- it contains
    # notes like "t-compliance ledger, not yet built". Curated here instead, so
    # a work note can never reach the judge as a local dog trainer.
    for nm in ('South Bay Dog Training (southbaydog.training)',
               'Canine High School (caninehighschool.com)',
               'Lynn Brown / lynnthedogtrainer.com'):
        out.append(f"- {nm} — operates locally; prices not verified against "
                   f"the ledger yet")
    return '\n'.join(out)


ROSTER = roster()


def subtask_tree(tree, limit=200):
    lines = []

    def walk(nodes, depth=0):
        for n in nodes or []:
            title = (n.get('title') or '').strip()
            desc = re.sub(r'\s+', ' ', (n.get('description') or '')).strip()
            if len(desc) > limit: desc = desc[:limit] + ' …[truncated]'
            who = n.get('assignee') or ''
            lines.append('  ' * depth + f"- {title}"
                         + (f"  [{who}]" if who else '')
                         + (f"\n{'  ' * depth}    {desc}" if desc else ''))
            walk(n.get('subtasks') or n.get('children'), depth + 1)

    walk(tree.get('subtasks') or tree.get('children'))
    return '\n'.join(lines) or '(the agent wrote no subtasks)'


def facts_for(task, cell, rep):
    d = os.path.join(REPO, 'experiments', cell, rep)
    raw = json.load(open(os.path.join(d, 'result.json')))
    tree = raw.get('final_task_tree') or {}
    report = tree.get('report') or {}
    md = report.get('markdown') or ''
    srcs = report.get('sources') or []

    fetched, searches, fetches = [], 0, 0
    tp = os.path.join(d, 'trace.jsonl')
    if os.path.exists(tp):
        for line in open(tp):
            e = json.loads(line)
            t = e.get('type')
            if t == 'web_fetch':
                fetches += 1
                if e.get('url'): fetched.append(e['url'])
            elif t == 'web_search':
                searches += 1

    g = D.grounding(md, srcs, fetched)
    norm = lambda u: re.sub(r'^https?://(www\.)?', '', u or '').rstrip('/')
    fetched_n = {norm(u) for u in fetched}

    named = sorted({nm for a, nm in D.ALIAS if a in md.lower()})

    detail = {'UNMATCHED': [], 'UNPUBLISHED': []}
    for kind, who, amt in g['detail']:
        if kind == 'UNMATCHED':
            pub = sorted(D._amounts(who)) or ['none recorded']
            detail['UNMATCHED'].append(
                f"{who} given {amt}; the ledger's verified figures for them are "
                f"{', '.join('$' + str(x) for x in pub)}")
        elif kind == 'UNPUBLISHED':
            detail['UNPUBLISHED'].append(
                f"{who} given a price of {amt}; this provider publishes no "
                f"prices at all on its own site")

    dead = []
    for nm, c in D.DEAD_CLAIMS:
        if c.get('cited_url') in {s.get('url') for s in srcs}:
            dead.append(f"{nm}: \"{c['claim']}\" cites {c['cited_url']} "
                        f"which does not resolve")

    src_lines = []
    for s in srcs:
        u = s.get('url', '')
        mark = '' if norm(u) in fetched_n else '   [NOT OPENED]'
        src_lines.append(f"- {(s.get('title') or '(untitled)')} — {u}{mark}")

    return dict(
        task=task, cell=cell, rep=rep,
        chars=len(md), words=len(md.split()),
        n_sources=len(srcs), n_fetched=len(fetched_n),
        n_searches=searches, n_fetches=fetches,
        n_verified=g['verified'], n_unmatched=g['unmatched'],
        n_unpublished=g['unpublished'], n_dead=len(dead),
        unmatched_detail='; '.join(detail['UNMATCHED']) or 'none',
        unpublished_detail='; '.join(detail['UNPUBLISHED']) or 'none',
        dead_detail='; '.join(dead) or 'none',
        provider_roster=ROSTER,
        providers_named=', '.join(named) or 'none recognised',
        subtask_tree=subtask_tree(tree),
        sources_list='\n'.join(src_lines) or '(no sources listed)',
        report_markdown=md,
    )


# ─────────────────────────────────────────────────────── t-compliance
# Different task, different ground truth: law instead of prices. Same
# discipline -- the ledger is a whitelist of discriminating cells, and the
# judge is told so.
STALE_BIPA_HINTS = [
    ('cothron', 'cites Cothron v. White Castle'),
    ('per scan', 'describes damages as accruing per scan'),
    ('per-scan', 'describes damages as accruing per scan'),
    ('each scan', 'describes damages as accruing per scan'),
    ('every scan', 'describes damages as accruing per scan'),
]
AMENDMENT_HINTS = ['103-0769', 'sb 2979', 'sb2979', 'single recovery',
                   'august 2024 amendment', '2024 amendment', 'one recovery',
                   'per method of collection']


def statute_block():
    out = []
    for st in STATUTES['states']:
        out.append(f"### {st['state']} — {st['statute']}")
        out.append(f"  private right of action : "
                   f"{'YES' if st['private_right_of_action'] else 'NO'}"
                   f"  ({st['pra_note']})")
        out.append(f"  penalties               : {st['damages']}")
        out.append(f"  consent                 : {st['consent_required']}")
        out.append(f"  retention               : {st['retention_rule']}")
        if st.get('effective'):
            out.append(f"  effective               : {st['effective']}")
        if st.get('electronic_signature_ok') is not None:
            out.append(f"  electronic signature ok : "
                       f"{st['electronic_signature_ok']}"
                       f"  ({st.get('electronic_signature_note', '')})")
        if st.get('amendment_2024'):
            a = st['amendment_2024']
            out.append(f"  AMENDMENT {a['cite']} effective {a['effective']}:")
            out.append(f"    {a['what_changed']}")
            out.append(f"    {a['retroactive']}")
            out.append(f"    WHY IT MATTERS: {a['why_it_matters']}")
        if st.get('enforcement_reality'):
            out.append(f"  enforcement reality     : {st['enforcement_reality']}")
        if st.get('other_duties'):
            out.append(f"  other duties            : {st['other_duties']}")
        out.append('')
    sh = STATUTES['the_shape_of_the_answer']
    out.append('Structural context (not scored directly):')
    out.append(f"  dedicated statutes: {sh['dedicated_biometric_statutes']}")
    out.append(f"  only state with a private right of action: {sh['only_pra']}")
    out.append(f"  the wider layer: {sh['wider_layer']}")
    return '\n'.join(out)


STATUTE_BLOCK = statute_block()
US_STATES = ['Alabama','Alaska','Arizona','Arkansas','California','Colorado',
 'Connecticut','Delaware','Florida','Georgia','Hawaii','Idaho','Illinois',
 'Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland',
 'Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana',
 'Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York',
 'North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania',
 'Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah',
 'Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming']


def compliance_facts(task, cell, rep):
    d = os.path.join(REPO, 'experiments', cell, rep)
    raw = json.load(open(os.path.join(d, 'result.json')))
    tree = raw.get('final_task_tree') or {}
    report = tree.get('report') or {}
    md = report.get('markdown') or ''
    srcs = report.get('sources') or []

    fetched, searches, fetches = [], 0, 0
    tp = os.path.join(d, 'trace.jsonl')
    if os.path.exists(tp):
        for line in open(tp):
            e = json.loads(line)
            t = e.get('type')
            if t == 'web_fetch':
                fetches += 1
                if e.get('url'): fetched.append(e['url'])
            elif t == 'web_search':
                searches += 1
    norm = lambda u: re.sub(r'^https?://(www\.)?', '', u or '').rstrip('/')
    fetched_n = {norm(u) for u in fetched}

    low = md.lower()
    named = [s for s in US_STATES if re.search(rf'\b{re.escape(s)}\b', md)]
    stale = sorted({why for k, why in STALE_BIPA_HINTS if k in low})
    amended = sorted({h for h in AMENDMENT_HINTS if h in low})

    src_lines = []
    for s in srcs:
        u = s.get('url', '')
        mark = '' if norm(u) in fetched_n else '   [NOT OPENED]'
        src_lines.append(f"- {(s.get('title') or '(untitled)')} — {u}{mark}")

    return dict(
        task=task, cell=cell, rep=rep,
        chars=len(md), words=len(md.split()),
        n_sources=len(srcs), n_fetched=len(fetched_n),
        n_searches=searches, n_fetches=fetches,
        n_states_named=len(named),
        states_named=', '.join(named) or 'none',
        tables=md.count('|---'),
        bipa_stale_signals='; '.join(stale) or 'none detected',
        bipa_amendment_signals='; '.join(amended) or 'NONE — the report never '
            'mentions the August 2024 amendment by any of its markers',
        statute_ledger=STATUTE_BLOCK,
        subtask_tree=subtask_tree(tree),
        sources_list='\n'.join(src_lines) or '(no sources listed)',
        report_markdown=md,
    )


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--task', default='t-dog')
    ap.add_argument('--only', default='')
    a = ap.parse_args()

    want = set(a.only.split(',')) if a.only else None
    prefix = '' if a.task == 't-dog' else a.task + '-'
    outdir = os.path.join(HERE, 'facts', a.task)
    os.makedirs(outdir, exist_ok=True)

    n = skipped = 0
    for p in sorted(glob.glob(os.path.join(REPO, 'experiments', '*', 'rep-*',
                                           'result.json'))):
        raw = json.load(open(p))
        if raw.get('dry_run') or raw.get('status') != 'ok': continue
        if raw.get('task_id') != a.task: continue
        rep = os.path.basename(os.path.dirname(p))
        cell = os.path.basename(os.path.dirname(os.path.dirname(p)))
        if want and f'{cell}/{rep}' not in want: continue
        f = (compliance_facts if a.task == 't-compliance' else facts_for)(
            a.task, cell, rep)
        if not f['report_markdown']:
            skipped += 1; continue
        json.dump(f, open(os.path.join(outdir, f'{cell}__{rep}.json'), 'w'),
                  indent=1)
        n += 1
    print(f'{a.task}: wrote {n} facts files to {outdir}'
          + (f' ({skipped} runs had no report)' if skipped else ''))
