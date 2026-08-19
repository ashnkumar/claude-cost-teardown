"""Fit a quality model to Ashwin's round-1 blind ranking — and test whether the
fit is identified at all.

Round 1 gives 8 pairwise directions + 2 absolute reads. That is few enough that
"my model reproduces all 8" is nearly worthless on its own: with a big feature
menu and a free ratio, lots of models do. So this script does the fit AND the
thing that makes the fit honest:

  1. single-feature leaderboard         — what one number gets you
  2. exhaustive 2-feature search        — HOW MANY models reach 8/8?
  3. leave-one-out on the chosen model
  4. consensus projection               — project the cells under EVERY 8/8
                                          model and report only what is stable
                                          across all of them

(4) is the point. The weights are not identified by 8 comparisons, but a cell
ordering that holds under every model consistent with his ranking is a
conclusion we can actually use.

NOT IN SCOPE: grounding. He could not see it — the calibration page rendered 411
<cite> tags as invisible markup and carried no source list, and he said so in
pair 3. Grounding stays with the ledger, unweighted by him, until round 2 shows
sources on screen.
"""
import collections, glob, itertools, json, os, statistics as st, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from calibration_shim import (PAIRS, SHIPS, HIS, SHIP, STRENGTH, load,   # noqa
                             features, require_key)

# Everything below walks PAIRS, which is empty without the answer key.
require_key('The round-1 weight fit')

# Features a report can be judged on. Every one was named by him unprompted;
# `chars` is in as the null hypothesis — "he just prefers longer reports".
MENU = ['chars', 'week_chars', 'options_detailed', 'advance', 'next_moves',
        'tables', 'creds', 'verified', 'sources', 'per_week_sections',
        'punt', 'not_published', 'unmatched', 'fetch_ratio']
# Scale each feature so a "ratio" grid means something comparable.
SCALE = dict(chars=1 / 1000, week_chars=1 / 1000, sources=1.0, verified=1.0,
             fetch_ratio=10.0)

RUNS = {}
for a, b, _ in PAIRS.values():
    RUNS.setdefault(a, None); RUNS.setdefault(b, None)
for r in SHIPS.values(): RUNS.setdefault(r, None)
for k in list(RUNS):
    r = load(k); r['f'] = features(r); RUNS[k] = r

ORDERED = sorted(PAIRS, key=lambda s: int(s[4:]))


def val(f, feat):
    return f[feat] * SCALE.get(feat, 1.0)


def hits(score):
    """How many of his 8 directions a scoring function reproduces."""
    n = 0
    for k in ORDERED:
        a, b, _ = PAIRS[k]
        d = score(RUNS[a]['f']) - score(RUNS[b]['f'])
        if d != 0 and (d > 0) == (STRENGTH[HIS[k]] > 0): n += 1
    return n


W = 108
print('=' * W); print('1. SINGLE FEATURE — what one number buys you'.center(W)); print('=' * W)
solo = sorted(((hits(lambda f, x=m: val(f, x)), m) for m in MENU), reverse=True)
for h, m in solo:
    print(f"   {m:<22}{h}/8")
print(f"\n   Best single feature: {solo[0][1]} at {solo[0][0]}/8.")

print()
print('=' * W); print('2. TWO FEATURES — is 8/8 even meaningful?'.center(W)); print('=' * W)
GRID = [0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 5.0, 8.0]
perfect = []
for f1, f2 in itertools.combinations(MENU, 2):
    for w in GRID:
        for s1, s2 in ((1, 1), (1, -1), (-1, 1)):
            sc = (lambda f, a=f1, b=f2, r=w, p=s1, q=s2:
                  p * val(f, a) + q * r * val(f, b))
            if hits(sc) == 8:
                perfect.append((f1, f2, w, s1, s2))
                break
print(f"   {len(perfect)} of {len(list(itertools.combinations(MENU, 2))) * len(GRID) * 3}"
      f" two-feature models reproduce all 8 directions.")
cnt = collections.Counter()
for f1, f2, *_ in perfect: cnt[f1] += 1; cnt[f2] += 1
print("\n   How often each feature appears in a model that fits all 8:")
for m, c in cnt.most_common():
    print(f"   {m:<22}{c:>3} / {len(perfect)}")
if not perfect:
    print("   NONE — no two-feature model fits. Need a third feature or his "
          "ranking is not a function of these.")

# The model we adopt: the two highest-consensus features, sign +, ratio picked
# as the midpoint of the interval that satisfies all 8.
F1, F2 = [m for m, _ in cnt.most_common(2)] if len(cnt) >= 2 else ('week_chars',
                                                                   'next_moves')
ok_ratios = [w for f1, f2, w, s1, s2 in perfect
             if {f1, f2} == {F1, F2} and s1 > 0 and s2 > 0]
RATIO = st.median(ok_ratios) if ok_ratios else 1.0
print(f"\n   ADOPTED: {F1} + {RATIO} x {F2}"
      f"   (ratios that work: {sorted(set(ok_ratios)) or 'n/a'})")


def q(f):
    return val(f, F1) + RATIO * val(f, F2)


print()
print('=' * W); print('3. THE ADOPTED MODEL, PAIR BY PAIR'.center(W)); print('=' * W)
print(f"{'':4}{'his call':<13}{'model':<20}{'margin':<10}{'':6}{F1[:12]+' Δ':<16}{F2[:12]+' Δ'}")
print('-' * W)
mags = []
for k in ORDERED:
    a, b, _ = PAIRS[k]
    his = STRENGTH[HIS[k]]
    qa, qb = q(RUNS[a]['f']), q(RUNS[b]['f'])
    ok = (qa - qb > 0) == (his > 0)
    mags.append((abs(his), abs(qa - qb)))
    lbl = {2: 'A clearly', 1: 'A slightly', -1: 'B slightly', -2: 'B clearly'}[his]
    print(f"{k[4:]:<4}{lbl:<13}{f'{qa:.1f} v {qb:.1f}':<20}{qa - qb:+.1f}{'':<6}"
          f"{RUNS[a]['f'][F1] - RUNS[b]['f'][F1]:<+16}"
          f"{RUNS[a]['f'][F2] - RUNS[b]['f'][F2]:+}")
strong = [m for s, m in mags if s == 2]; slight = [m for s, m in mags if s == 1]
print('-' * W)
print(f"   direction {hits(q)}/8 | 'clearly' margins "
      f"{sorted(f'{m:.1f}' for m in strong)} vs 'slightly' "
      f"{sorted(f'{m:.1f}' for m in slight)}")
print("   -> margin size DOES track his confidence" if strong and slight and
      min(strong) > max(slight) else
      "   -> margin size does NOT track his confidence; direction only")

print()
print('=' * W); print('4. LEAVE-ONE-OUT'.center(W)); print('=' * W)
loo = 0
for held in ORDERED:
    best, bw = -1, None
    for w in GRID:
        sc = lambda f, r=w: val(f, F1) + r * val(f, F2)
        s = sum(((sc(RUNS[PAIRS[k][0]]['f']) - sc(RUNS[PAIRS[k][1]]['f'])) > 0)
                == (STRENGTH[HIS[k]] > 0) for k in ORDERED if k != held)
        if s > best: best, bw = s, w
    sc = lambda f, r=bw: val(f, F1) + r * val(f, F2)
    a, b, _ = PAIRS[held]
    ok = ((sc(RUNS[a]['f']) - sc(RUNS[b]['f'])) > 0) == (STRENGTH[HIS[held]] > 0)
    loo += ok
    print(f"   hold out {held:<7} refit ratio={bw:<5} -> "
          f"{'predicts it' if ok else 'MISSES it'} ({best}/7 on the rest)")
print(f"   LEAVE-ONE-OUT: {loo}/8")

print()
print('=' * W); print('5. THE TWO ABSOLUTE READS — where his ship line sits'.center(W)); print('=' * W)
SHIP_Q = q(RUNS[SHIPS['ship2']]['f']); BAD_Q = q(RUNS[SHIPS['ship1']]['f'])
for k, run in SHIPS.items():
    f = RUNS[run]['f']
    print(f"   {SHIP[k].upper():<7} q={q(f):5.1f}   {F1}={f[F1]:<7} {F2}={f[F2]:<4} {run}")

# --------------------------------------------------------------- 6. projection
by = collections.defaultdict(list)
for p in sorted(glob.glob(os.path.join(REPO, 'experiments', '*', 'rep-*',
                                       'result.json'))):
    raw = json.load(open(p))
    if raw.get('dry_run') or raw.get('status') != 'ok': continue
    if raw.get('task_id') != 't-dog': continue
    cell = os.path.basename(os.path.dirname(os.path.dirname(p)))
    run = f"{cell}/{os.path.basename(os.path.dirname(p))}"
    r = load(run)
    by[cell].append(features(r))

STAGE1 = ['off-append', 'naive-append', 'live-append', 'live-append-effort-low',
          'live-append-sonnet', 'live-append-sonnet-effort-low']
print()
print('=' * W)
print('6. CONSENSUS PROJECTION — only what holds under EVERY 8/8 model'.center(W))
print('=' * W)
print("Each cell scored under all {} models that fit his ranking, then asked:\n"
      "does it clear his 'ship it' read, and does it clear his 'embarrassing' "
      "one?".format(len(perfect)))
print()
print(f"{'cell':<32}{'n':<4}{'q (adopted)':<14}{'>= ship read':<16}"
      f"{'> embarrassing':<17}{'week chars':<12}{'opts'}")
print('-' * W)
for cell in STAGE1 + [c for c in sorted(by) if c not in STAGE1]:
    if cell not in by: continue
    fs = by[cell]
    mean_q = st.mean(q(f) for f in fs)
    above_ship = below_bad = 0
    for f1, f2, w, s1, s2 in perfect:
        sc = lambda f: s1 * val(f, f1) + s2 * w * val(f, f2)
        m = st.mean(sc(f) for f in fs)
        if m >= sc(RUNS[SHIPS['ship2']]['f']): above_ship += 1
        if m <= sc(RUNS[SHIPS['ship1']]['f']): below_bad += 1
    n = len(perfect) or 1
    star = '  <<<' if cell in STAGE1 else ''
    print(f"{cell:<32}{len(fs):<4}{mean_q:<14.1f}"
          f"{f'{100*above_ship//n}% of models':<16}"
          f"{f'{100*(n-below_bad)//n}% of models':<17}"
          f"{st.mean(f['week_chars'] for f in fs):<12.0f}"
          f"{st.mean(f['options_detailed'] for f in fs):.1f}{star}")
print('-' * W)
print(f"   his 'ship it'      q = {SHIP_Q:.1f}")
print(f"   his 'embarrassing' q = {BAD_Q:.1f}")
