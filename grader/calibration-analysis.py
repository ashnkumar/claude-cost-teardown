"""Feature sweep over the round-1 calibration: which measurable signals
reproduce his ordering, and do the two existing graders?
"""
import json, os, re, sys, statistics as st

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import deterministic as D
from calibration_shim import (PAIRS, SHIPS, HIS, SHIP, STRENGTH, load,
                             features, require_key)

# Everything below walks PAIRS, which is empty without the answer key.
require_key('The round-1 feature sweep')

# ----------------------------------------------------------------------- report
RUNS = {}
for a, b, _ in PAIRS.values():
    for x in (a, b): RUNS.setdefault(x, None)
for x in SHIPS.values(): RUNS.setdefault(x, None)
for x in list(RUNS):
    r = load(x); r['f'] = features(r); RUNS[x] = r

W = 132
print('=' * W)
print('HIS RANKING, DECODED'.center(W))
print('=' * W)
print(f"{'':6}{'A':<30}{'B':<30}{'HIS CALL':<20}{'OLD RUBRIC':<22}{'DETERMINISTIC'}")
print('-' * W)

agree_old = agree_det = n_old = n_det = 0
for k in sorted(PAIRS, key=lambda s: int(s[4:])):
    a, b, title = PAIRS[k]
    ra, rb = RUNS[a], RUNS[b]
    his = STRENGTH[HIS[k]]
    call = {2: 'A clearly', 1: 'A slightly', 0: 'tie',
            -1: 'B slightly', -2: 'B clearly'}[his]
    if ra['old'] is not None and rb['old'] is not None:
        n_old += 1
        d = ra['old'] - rb['old']
        ok = (d > 0) == (his > 0) if his else abs(d) < 3
        agree_old += ok
        oldc = f"{ra['old']:.1f} v {rb['old']:.1f}  {'OK' if ok else 'MISS'}"
    else:
        oldc = 'never graded'
    da, db = ra['f']['det_score'], rb['f']['det_score']
    n_det += 1
    okd = (da - db > 0) == (his > 0) if his else abs(da - db) < 3
    agree_det += okd
    print(f"{k[4:]:<6}{a:<30}{b:<30}{call:<20}{oldc:<22}"
          f"{da:.0f} v {db:.0f}  {'OK' if okd else 'MISS'}")
    print(f"{'':6}{title}")

print('-' * W)
print(f"OLD RUBRIC agreement: {agree_old}/{n_old} pairs it can even score "
      f"({len(PAIRS) - n_old} pairs have an ungraded run)")
print(f"DETERMINISTIC agreement: {agree_det}/{n_det} pairs")

print()
print('=' * W)
print('THE TWO SOLO READS'.center(W))
print('=' * W)
for k, run in SHIPS.items():
    r = RUNS[run]
    print(f"{k}: {SHIP[k].upper():<6} {run:<30} old={r['old'] if r['old'] else 'ungraded':<10} "
          f"det={r['f']['det_score']:.0f}  chars={r['f']['chars']}  "
          f"week_chars={r['f']['week_chars']}  per_week={r['f']['per_week_sections']}")

# ------------------------------------------------- which features track his call
print()
print('=' * W)
print('WHICH FEATURES REPRODUCE HIS ORDERING'.center(W))
print('=' * W)
FEATS = [k for k in RUNS[list(RUNS)[0]]['f'] if k != 'det_score']
rows = []
for f in FEATS:
    hit = tie = 0
    for k in PAIRS:
        a, b, _ = PAIRS[k]
        his = STRENGTH[HIS[k]]
        d = RUNS[a]['f'][f] - RUNS[b]['f'][f]
        if d == 0: tie += 1
        elif (d > 0) == (his > 0): hit += 1
    rows.append((hit, tie, f))
rows.sort(reverse=True)
print(f"{'feature':<26}{'agrees':<9}{'ties':<7}values per run (A|B by pair)")
print('-' * W)
for hit, tie, f in rows:
    vals = ' '.join(f"{RUNS[PAIRS[k][0]]['f'][f]}/{RUNS[PAIRS[k][1]]['f'][f]}"
                    for k in sorted(PAIRS, key=lambda s: int(s[4:])))
    print(f"{f:<26}{hit}/8{'':<5}{tie:<7}{vals}")

print()
print('=' * W)
print('EVERY RUN, EVERY FEATURE'.center(W))
print('=' * W)
cols = ['chars', 'week_chars', 'per_week_sections', 'advance', 'options_named',
        'options_detailed', 'punt', 'tables', 'creds', 'next_moves',
        'not_published', 'verified', 'sources', 'fetch_ratio']
print(f"{'run':<32}{'old':<7}" + ''.join(f"{c[:9]:<10}" for c in cols))
print('-' * W)
for run in sorted(RUNS):
    f = RUNS[run]['f']
    old = f"{RUNS[run]['old']:.1f}" if RUNS[run]['old'] is not None else '--'
    print(f"{run:<32}{old:<7}" + ''.join(f"{f[c]:<10}" for c in cols))
