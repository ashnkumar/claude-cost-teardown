#!/usr/bin/env python3
"""Score the head-to-head judge against Ashwin's blind ranking.

The absolute rubric got 4/8 on these same pairs, with three of the four misses
being ties on pairs where he had a clear direction. This measures the
replacement on the same standard, and adds two checks the absolute instrument
could not support:

  * MARGIN AGREEMENT -- he answered with a strength (AA = much better,
    Aa = lean). The judge answers CLEAR or SLIGHT. Those should line up, and a
    judge that gets the direction right while calling every gap CLEAR is not
    really tracking him.
  * POSITION BIAS -- every pair was judged in both orders. A pair whose winner
    flips when the reports swap places is not a measurement.

Run from grader/:  python3 score-pairwise.py [--task=t-dog]
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from calibration_shim import HIS, STRENGTH  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
TASK = 't-dog'
# The 8 blind calibration pairs and the production reference sweep are both
# "pairwise" runs, and the sweep once overwrote the calibration in place. They
# now live in separate directories, and --calibration is how you ask for the
# one this instrument was validated against.
RUN = 'pairwise'
for a in sys.argv[1:]:
    if a.startswith('--task='):
        TASK = a.split('=', 1)[1]
    elif a == '--calibration':
        RUN = 'calibration'

RES = os.path.join(HERE, 'judge', 'out', f'{TASK}-{RUN}', 'results.json')
DIMS = ['LOCAL_OPTIONS', 'FOUR_WEEK_PLAN', 'DECISION', 'DENSITY', 'GROUNDING']


def hdir(code):
    return 'EQUAL' if code == 'tie' else code[0].upper()


def main():
    if not os.path.exists(RES):
        sys.exit(f'no results at {RES} -- run run-pairwise.mjs first')
    data = json.load(open(RES))
    pairs = data['pairs']

    print('=' * 78)
    print('HEAD-TO-HEAD vs HIS BLIND RANKING')
    print(f"  {data['model']} effort={data['effort']}  mode={data['mode']}")
    print('=' * 78)
    print(f"{'pair':<7}{'his':<5}{'str':<5}{'judge':<7}{'margin':<9}"
          f"{'votes':<9}{'order':<10}ok")
    print('-' * 78)

    ok = strong_ok = n_strong = flipped = margin_ok = margin_n = 0
    misses = []
    for p in pairs:
        pid = p['id']
        if not pid.startswith('pair'):
            continue
        code = HIS.get(pid)
        if code is None:
            continue
        want = hdir(code)
        strength = abs(STRENGTH[code])
        ov = p['OVERALL']
        got = ov['winner']
        # CLEAR when every usable vote called it clear; SLIGHT when none did.
        cv, uv = ov['clear_votes'], ov['usable_votes']
        margin = 'CLEAR' if cv and cv == uv else ('SLIGHT' if cv == 0 else 'MIXED')
        hit = (got == want)
        ok += hit
        if strength == 2:
            n_strong += 1
            strong_ok += hit
        if p['position_bias']:
            flipped += 1
        # margin check only where the direction is right -- a margin on a wrong
        # call is not informative
        if hit:
            margin_n += 1
            want_margin = 'CLEAR' if strength == 2 else 'SLIGHT'
            margin_ok += (margin == want_margin)
        if not hit:
            misses.append((pid, want, code, got, margin, p))
        print(f"{pid:<7}{want:<5}{code:<5}{got:<7}{margin:<9}"
              f"{cv}/{uv} clear{'':<1}"
              f"{'FLIPPED' if p['position_bias'] else 'stable':<10}"
              f"{'YES' if hit else 'no'}")

    n = sum(1 for p in pairs if p['id'].startswith('pair') and p['id'] in HIS)
    print('-' * 78)
    print(f'  direction agreement : {ok}/{n}    '
          f'(absolute rubric got 4/8 on these same pairs)')
    print(f'  his STRONG calls    : {strong_ok}/{n_strong}   '
          f'the ones that must be right')
    print(f'  margin agreement    : {margin_ok}/{margin_n} of the correct calls '
          f'also matched CLEAR vs SLIGHT')
    print(f'  position bias       : {flipped}/{n} pairs flipped when the reports '
          f'swapped places')
    print(f'  ties                : 0 by construction -- OVERALL forbids EQUAL')

    # ---- per-dimension agreement: which dimension tracks him best? ----
    print()
    print('=' * 78)
    print('PER-DIMENSION  --  order the pairs using ONE dimension at a time')
    print('=' * 78)
    print(f"{'dimension':<20}{'agree':>8}{'strong':>9}{'EQUALs':>9}"
          f"{'flips':>8}")
    print('-' * 78)
    for d in DIMS:
        a = s = eq = fl = 0
        for p in pairs:
            pid = p['id']
            if pid not in HIS:
                continue
            want = hdir(HIS[pid])
            rec = p.get(d) or {}
            got = rec.get('winner', 'EQUAL')
            if got == 'EQUAL':
                eq += 1
            if not rec.get('order_consistent', True):
                fl += 1
            if got == want:
                a += 1
                if abs(STRENGTH[HIS[pid]]) == 2:
                    s += 1
        print(f"{d:<20}{a:>4}/{n}{s:>6}/{n_strong}{eq:>9}{fl:>8}")
    print('-' * 78)
    print('  EQUALs is not a defect on a dimension -- two reports really can be')
    print('  level on the decision. It IS a defect if a dimension he called a')
    print('  killer comes out EQUAL on most pairs.')

    # ---- the misses, with the judge's own reasoning ----
    if misses:
        print()
        print('=' * 78)
        print('MISSES  --  read the judge\'s reason before assuming it is wrong')
        print('=' * 78)
        for pid, want, code, got, margin, p in misses:
            print(f"\n{pid}: he said {code} ({want}), judge said {got} ({margin})")
            print(f"  A = {p['A']}")
            print(f"  B = {p['B']}")
            for call in data['detail']:
                if call['id'] != pid:
                    continue
                for c in call['calls'][:1]:
                    for d in ['OVERALL'] + DIMS:
                        rec = c['dims'].get(d) or {}
                        w = rec.get('winner_ab', '?')
                        why = (rec.get('why') or '')[:150]
                        print(f"    {d:<16} {w:<6} {why}")
                break


if __name__ == '__main__':
    main()
