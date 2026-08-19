#!/usr/bin/env python3
"""Score the LLM judge against Ashwin's blind ranking.

The only external standard we have is his 8 pair directions + 2 ship reads.
This does four things:

  1. PAIR AGREEMENT   -- does the judge order each pair the way he did?
  2. SECTION AGREEMENT -- would ANY single section have ordered them better?
                          (if section B alone beats the 100-pt total, the total
                          is diluting his signal with items he doesn't care
                          about)
  3. ITEM INFORMATION -- per item, how much does it actually vary across the
                          corpus? An item that is max on every report carries
                          zero bits and just inflates everyone equally. This is
                          the saturation diagnosis, quantified.
  4. SHIP CHECK       -- the two reports he judged absolutely.

Run from grader/:  python3 compare-judge.py
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

SECTIONS = {'A': ('decision', 20), 'B': ('local options', 30),
            'C': ('four-week plan', 30), 'D': ('density', 15),
            'E': ('grounding', 5)}


def runkey(run):
    """'live-append/rep-6' -> 'live-append__rep-6'"""
    return run.replace('/', '__')


def load():
    key = json.load(open(KEY))
    graded = {}
    for f in os.listdir(OUT):
        if f.endswith('.json'):
            graded[f[:-5]] = json.load(open(os.path.join(OUT, f)))
    return key, graded


def direction(delta, tol=1.0):
    """Judge's call on a pair. tol = below this it is calling a tie."""
    if abs(delta) < tol:
        return 'tie'
    return 'A' if delta > 0 else 'B'


def his_direction(code):
    """'AA'/'Aa' -> A ; 'BB'/'Bb' -> B ; 'tie' -> tie"""
    if code == 'tie':
        return 'tie'
    return code[0].upper()


def main():
    # This one reads the answer key directly, not through the shim's PAIRS,
    # so guarding the shim was not enough to keep it out of a traceback.
    require_key('The judge-vs-blind-ranking comparison')
    key, graded = load()
    missing = []

    # ---------- 1. pair agreement on the 100-point total ----------
    print('=' * 78)
    print('1. PAIR AGREEMENT  --  judge score_mean vs his blind direction')
    print('=' * 78)
    print(f"{'#':<3}{'his':<5}{'str':<4}{'A':<32}{'A':>6}{'B':>6}"
          f"{'  d':>7}{'  judge':>8}  ok")
    print('-' * 78)

    rows, agree, ties = [], 0, 0
    for p in key['pairs']:
        n = p['pair']
        ka, kb = runkey(p['A']), runkey(p['B'])
        if ka not in graded or kb not in graded:
            missing.append((n, p['A'] if ka not in graded else p['B']))
            continue
        sa = graded[ka]['score_mean']
        sb = graded[kb]['score_mean']
        d = sa - sb
        jd = direction(d)
        hcode = HIS[f'pair{n}']
        hd = his_direction(hcode)
        ok = (jd == hd)
        if jd == 'tie' and hd != 'tie':
            ties += 1
        agree += ok
        rows.append(dict(n=n, ka=ka, kb=kb, his=hd, hcode=hcode,
                         strength=abs(STRENGTH[hcode]), sa=sa, sb=sb, d=d,
                         judge=jd, ok=ok))
        print(f"{n:<3}{hd:<5}{hcode:<4}{p['A']:<32}{sa:>6.1f}{sb:>6.1f}"
              f"{d:>+7.1f}{jd:>8}  {'YES' if ok else 'no'}")
        print(f"{'':<8}{'':<4}{p['B']:<32}")

    n_pairs = len(rows)
    print('-' * 78)
    print(f'agreement: {agree}/{n_pairs}   '
          f'(judge called {ties} tie(s) where he had a direction)')

    # separate the pairs he felt strongly about (AA/BB) from the leans
    strong = [r for r in rows if r['strength'] == 2]
    weak = [r for r in rows if r['strength'] == 1]
    print(f"  strong calls (AA/BB): {sum(r['ok'] for r in strong)}/{len(strong)}"
          f"   leans (Aa/Bb): {sum(r['ok'] for r in weak)}/{len(weak)}")
    print('  the strong ones are the ones that must be right.')

    # ---------- 2. would a single section have done better? ----------
    print()
    print('=' * 78)
    print('2. SECTION AGREEMENT  --  which section carries his signal?')
    print('=' * 78)
    print('  Each row: order the same 8 pairs using ONLY that section\'s score.')
    print('  A section that beats the 100-pt total is being diluted by the rest.')
    print()
    print(f"{'section':<22}{'pts':>5}{'agree':>8}{'strong':>8}"
          f"{'  mean |margin|':>16}{'  ties':>7}")
    print('-' * 78)

    sec_rows = []
    for sec, (name, maxpts) in SECTIONS.items():
        a = s_a = t = 0
        margins = []
        for r in rows:
            va = graded[r['ka']]['sections_mean'][sec]
            vb = graded[r['kb']]['sections_mean'][sec]
            # tolerance scales with the section's size, so a 30-pt section
            # isn't held to the same absolute tie threshold as a 5-pt one
            tol = maxpts / 30.0
            jd = direction(va - vb, tol=tol)
            margins.append(abs(va - vb))
            if jd == 'tie' and r['his'] != 'tie':
                t += 1
            if jd == r['his']:
                a += 1
                if r['strength'] == 2:
                    s_a += 1
        sec_rows.append((sec, a))
        print(f"{sec + '. ' + name:<22}{maxpts:>5}{a:>4}/{n_pairs}"
              f"{s_a:>5}/{len(strong)}{sum(margins) / len(margins):>16.2f}"
              f"{t:>7}")
    print('-' * 78)
    print(f"{'TOTAL (all 100)':<22}{100:>5}{agree:>4}/{n_pairs}"
          f"{sum(r['ok'] for r in strong):>5}/{len(strong)}"
          f"{sum(abs(r['d']) for r in rows) / n_pairs:>16.2f}{ties:>7}")

    # best pair of sections, equally weighted -- cheap check for whether a
    # two-section rubric would have been enough
    print()
    print('  best 2-section combinations (equal weight, normalised to 100):')
    combos = []
    for s1, s2 in combinations(SECTIONS, 2):
        m1, m2 = SECTIONS[s1][1], SECTIONS[s2][1]
        a = 0
        for r in rows:
            g1, g2 = graded[r['ka']], graded[r['kb']]
            va = 50 * g1['sections_mean'][s1] / m1 + 50 * g1['sections_mean'][s2] / m2
            vb = 50 * g2['sections_mean'][s1] / m1 + 50 * g2['sections_mean'][s2] / m2
            if direction(va - vb, tol=1.0) == r['his']:
                a += 1
        combos.append((a, s1 + '+' + s2))
    for a, name in sorted(combos, reverse=True)[:5]:
        print(f"    {name:<8} {a}/{n_pairs}")

    # ---------- 3. item information ----------
    print()
    print('=' * 78)
    print('3. ITEM INFORMATION  --  which items actually discriminate?')
    print('=' * 78)
    print(f'  Across all {len(graded)} graded reports. "at max" = fraction of')
    print('  reports scoring the item\'s top anchor. An item at max everywhere')
    print('  is a constant: it raises every score and separates nothing.')
    print()
    print(f"{'item':<7}{'max':>5}{'mean':>7}{'sd':>6}{'range':>10}"
          f"{'at max':>9}{'at zero':>9}   verdict")
    print('-' * 78)

    items = {}
    for g in graded.values():
        for it, v in g['item_spread'].items():
            items.setdefault(it, []).append((v['mean'], v['max_possible']))

    dead = []
    for it in sorted(items):
        vals = [v for v, _ in items[it]]
        mp = items[it][0][1]
        n = len(vals)
        mu = sum(vals) / n
        sd = (sum((v - mu) ** 2 for v in vals) / n) ** 0.5
        at_max = sum(1 for v in vals if v >= mp - 1e-9) / n
        at_zero = sum(1 for v in vals if v <= 1e-9) / n
        if at_max >= 0.85:
            verdict = 'DEAD -- max almost everywhere'
            dead.append(it)
        elif sd < 0.35 * (mp / 4):
            verdict = 'weak'
        else:
            verdict = 'discriminates'
        print(f"{it:<7}{mp:>5}{mu:>7.2f}{sd:>6.2f}"
              f"{min(vals):>5.1f}-{max(vals):<4.1f}{at_max * 100:>8.0f}%"
              f"{at_zero * 100:>8.0f}%   {verdict}")
    print('-' * 78)
    dead_pts = sum(items[it][0][1] for it in dead)
    print(f'  {len(dead)} of {len(items)} items are at max on >=85% of reports, '
          f'worth {dead_pts} of 100 points.')
    print('  Those points are a floor every report gets for free.')

    # what the spread actually looks like
    scores = sorted(g['score_mean'] for g in graded.values())
    mu = sum(scores) / len(scores)
    sd = (sum((s - mu) ** 2 for s in scores) / len(scores)) ** 0.5
    print()
    print(f'  score distribution over {len(scores)} reports: '
          f'{scores[0]:.0f} .. {scores[-1]:.0f}, mean {mu:.1f}, sd {sd:.1f}')
    print(f'  {sum(1 for s in scores if s >= 90)} of {len(scores)} '
          f'score 90 or above.')

    # ---------- 4. ship check ----------
    print()
    print('=' * 78)
    print('4. SHIP CHECK  --  the two he judged absolutely')
    print('=' * 78)
    for s in key['ship']:
        k = runkey(s['run'])
        if k not in graded:
            print(f"  ship{s['item']}: {s['run']} NOT GRADED")
            continue
        g = graded[k]
        verdict = SHIP[f"ship{s['item']}"]
        rank = sorted(graded, key=lambda x: -graded[x]['score_mean']).index(k) + 1
        print(f"  he said {verdict.upper():<5} -> judge {g['score_mean']:.1f}"
              f"   rank {rank} of {len(graded)}")
        secs = ' '.join(f"{a}={b:.0f}/{SECTIONS[a][1]}"
                        for a, b in g['sections_mean'].items())
        print(f"    {secs}")
    print()
    print('  The test: his SHIP report must outrank his BAD one, and it should')
    print('  not sit below reports he ranked lower in the pairs.')

    if missing:
        print()
        print('MISSING GRADES:')
        for n, run in missing:
            print(f'  pair {n}: {run}')


if __name__ == '__main__':
    main()
