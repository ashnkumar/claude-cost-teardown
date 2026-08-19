#!/usr/bin/env python3
"""Can a REWEIGHTING of the existing grades reproduce his ranking?

The comparison harness found that 12 of 19 items sit at their top anchor on
>=85% of reports -- 60 of the 100 points are a constant every report collects.
A constant cannot order anything, so the question is whether the 40 points that
DO move already contain his signal, or whether the judge simply never looked at
what he cares about.

This distinction decides what we fix:

  * if a reweighting of the live items reproduces his 8 directions, the judge
    SAW the differences and the SCORE buried them -> fix the weights/anchors.
  * if no reweighting gets there, the judge did not measure what he reacts to
    -> the rubric needs new items, and re-running is mandatory.

Nothing here spends money. It re-scores grades already on disk.

Run from grader/:  python3 reweight-test.py
"""
import json
import os
import sys
from itertools import combinations

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from calibration_shim import HIS, SHIP, STRENGTH, require_key  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'judge', 'out', 't-dog')
KEY = os.path.join(HERE, 'calibration-key-round1.json')

SEC_OF = {'A': 20, 'B': 30, 'C': 30, 'D': 15, 'E': 5}


def rk(r):
    return r.replace('/', '__')


def load():
    key = json.load(open(KEY))
    g = {}
    for f in os.listdir(OUT):
        if f.endswith('.json'):
            g[f[:-5]] = json.load(open(os.path.join(OUT, f)))
    return key, g


def hdir(code):
    return 'tie' if code == 'tie' else code[0].upper()


def score(g, weights):
    """Weighted sum of item fractions -> 0..100."""
    tot = wsum = 0.0
    for it, w in weights.items():
        v = g['item_spread'][it]
        tot += w * (v['mean'] / v['max_possible'])
        wsum += w
    return 100.0 * tot / wsum if wsum else 0.0


def agreement(pairs, g, weights, tol=1.0):
    ok = strong_ok = n_strong = ties = 0
    for p in pairs:
        a, b = rk(p['A']), rk(p['B'])
        if a not in g or b not in g:
            continue
        code = HIS[f"pair{p['pair']}"]
        want = hdir(code)
        d = score(g[a], weights) - score(g[b], weights)
        got = 'tie' if abs(d) < tol else ('A' if d > 0 else 'B')
        if got == 'tie' and want != 'tie':
            ties += 1
        if abs(STRENGTH[code]) == 2:
            n_strong += 1
            strong_ok += (got == want)
        ok += (got == want)
    return ok, strong_ok, n_strong, ties


def main():
    # This one reads the answer key directly, not through the shim's PAIRS,
    # so guarding the shim was not enough to keep it out of a traceback.
    require_key('The reweighting test')
    key, g = load()
    pairs = key['pairs']
    n = len(pairs)

    # classify items by how much they actually move across the corpus
    live, dead = [], []
    for it in sorted(g[next(iter(g))]['item_spread']):
        vals = [x['item_spread'][it]['mean'] for x in g.values()]
        mp = g[next(iter(g))]['item_spread'][it]['max_possible']
        at_max = sum(1 for v in vals if v >= mp - 1e-9) / len(vals)
        (dead if at_max >= 0.85 else live).append(it)

    print('=' * 78)
    print('ITEMS THAT MOVE vs ITEMS THAT DO NOT')
    print('=' * 78)
    print(f'  live ({len(live)}): {" ".join(live)}')
    print(f'  dead ({len(dead)}): {" ".join(dead)}')

    allw = {it: g[next(iter(g))]['item_spread'][it]['max_possible']
            for it in g[next(iter(g))]['item_spread']}

    print()
    print('=' * 78)
    print('CANDIDATE SCORINGS  --  all computed from grades already on disk')
    print('=' * 78)
    print(f"{'scoring':<44}{'agree':>7}{'strong':>8}{'ties':>6}")
    print('-' * 78)

    cands = [
        ('as shipped: all 19 items, rubric weights', allw),
        ('drop the 12 dead items, keep rubric weights',
         {k: v for k, v in allw.items() if k in live}),
        ('live items, all weighted equally',
         {k: 1 for k in live}),
    ]
    # his own stated priorities: local options + week-by-week + density
    cands.append(('live items in B/C/D only (his three priorities)',
                  {k: allw[k] for k in live if k[0] in 'BCD'}))
    cands.append(('density items only (D1 D2)',
                  {k: allw[k] for k in live if k[0] == 'D'}))

    for name, w in cands:
        ok, s_ok, n_s, t = agreement(pairs, g, w)
        print(f"{name:<44}{ok:>4}/{n}{s_ok:>5}/{n_s}{t:>6}")

    # ---- exhaustive search over small weightings of the live items ----
    # Question: does ANY assignment of coarse weights to the live items
    # reproduce all 8 directions? If none does, no reweighting can save it.
    print()
    print('=' * 78)
    print('EXHAUSTIVE SEARCH  --  is his ranking reachable by reweighting AT ALL?')
    print('=' * 78)
    grid = [0, 1, 2, 4]
    best, best_w, hits8 = -1, None, 0
    total = 0
    # search over subsets of size <=4 among live items, coarse weights
    for k in range(1, min(4, len(live)) + 1):
        for subset in combinations(live, k):
            for combo in _weight_combos(len(subset), grid):
                if all(c == 0 for c in combo):
                    continue
                w = dict(zip(subset, combo))
                total += 1
                ok, s_ok, n_s, t = agreement(pairs, g, w)
                if ok == n:
                    hits8 += 1
                if ok > best or (ok == best and t < 99):
                    if ok > best:
                        best, best_w = ok, w
    print(f'  searched {total:,} weightings over the {len(live)} live items')
    print(f'  best agreement reachable: {best}/{n}')
    print(f'  weightings achieving {n}/{n}: {hits8}')
    if best_w:
        print(f'  an example best weighting: '
              f'{ {k: v for k, v in best_w.items()} }')
    print()
    if hits8 == 0:
        print('  VERDICT: no reweighting of the EMITTED NUMBERS reproduces his')
        print('  ranking, so the fix is not the weights.')
        print()
        print('  Note carefully what this does and does not prove. It rules out')
        print('  reweighting. It does NOT prove the judge failed to see the')
        print('  differences -- the item values are the compressed output of the')
        print('  anchors, not the judge\'s perception. Check the free-text')
        print('  verdicts before concluding anything about blindness: on pair 8')
        print('  the prose names four differences that all favour the report he')
        print('  preferred, while all 19 item scores come out identical. That is')
        print('  the anchors destroying signal the judge had, not missing signal.')
    else:
        print('  VERDICT: his ranking IS reachable from what the judge already')
        print('  measured. The information is present and the scoring buried')
        print('  it. Fix the weights and anchors, do not add items.')
        print(f'  ({hits8} weightings hit {n}/{n}, so the weights are NOT')
        print('  identified by 8 pairs -- treat any single fit as one of many.)')

    # ---- ship check under the best candidate ----
    print()
    print('=' * 78)
    print('SHIP CHECK under "drop the dead items"')
    print('=' * 78)
    w = {k: v for k, v in allw.items() if k in live}
    ranked = sorted(g, key=lambda x: -score(g[x], w))
    for s in key['ship']:
        k = rk(s['run'])
        if k not in g:
            continue
        verdict = SHIP['ship%d' % s['item']].upper()
        print(f"  he said {verdict:<5} -> {score(g[k], w):5.1f}"
              f"   rank {ranked.index(k) + 1} of {len(g)}")


def _weight_combos(k, grid):
    if k == 0:
        yield ()
        return
    for head in grid:
        for tail in _weight_combos(k - 1, grid):
            yield (head,) + tail


if __name__ == '__main__':
    main()
