#!/usr/bin/env python3
"""Turn a reference-anchored head-to-head sweep into a quality index, and join it
to cost.

Every report was compared against ONE fixed reference -- the build-as-is baseline
-- in both orders. This converts those per-dimension verdicts into a single signed
number per report:

    +2  this report wins the dimension, CLEAR
    +1  wins it, SLIGHT
     0  EQUAL, or the two orders disagreed (a flip is not a result)
    -1  the baseline wins, SLIGHT
    -2  the baseline wins, CLEAR

summed over the SCORING dimensions and averaged across the two orders. The index
is signed on purpose: "better or worse than what you would have shipped" is the
honest quantity, and rescaling it to a 0-100 score would invent precision the
instrument does not have.

DENSITY IS DEDUCTED FROM THE SCORE AND REPORTED BESIDE IT. On the eight
calibration pairs, density agreed with the human 1 time in 8 and 0 times in 4 on
the pairs he felt strongest about -- it actively pointed away from his choices,
because in this corpus the reports carrying the detail he wants are the longer
ones. It stays visible because he asked for it and it is real; it stays out of the
ranking because measured against him it anti-predicts.

Run from grader/:  python3 score-sweep.py [--task=t-dog]
"""
import csv
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

TASK = 't-dog'
for a in sys.argv[1:]:
    if a.startswith('--task='):
        TASK = a.split('=', 1)[1]

SCORING = {
    't-dog': ['LOCAL_OPTIONS', 'FOUR_WEEK_PLAN', 'DECISION', 'GROUNDING'],
    't-compliance': ['STATE_COVERAGE', 'REQUIRED_FIELDS', 'LAUNCH_DECISION',
                     'GROUNDING'],
}[TASK]
REPORTED = ['DENSITY']

RES = os.path.join(HERE, 'judge', 'out', f'{TASK}-pairwise', 'results.json')
CSV = os.path.join(REPO, 'experiments', 'results', 'results.csv')
OUT = os.path.join(REPO, 'experiments', 'results',
                   f'quality-{TASK}.csv')


def dim_points(call, dim):
    """One call's verdict on one dimension, as a signed number."""
    rec = call['dims'].get(dim) or {}
    if rec.get('unusable') or rec.get('missing'):
        return None
    w = rec.get('winner_ab')
    if w == 'EQUAL':
        return 0
    mag = 2 if rec.get('margin') == 'CLEAR' else 1
    # 'A' is always the report under test; 'B' is always the reference, because
    # judgePair translates slot winners back to A/B before recording.
    return mag if w == 'A' else -mag


def main():
    if not os.path.exists(RES):
        sys.exit(f'no sweep results at {RES}')
    data = json.load(open(RES))
    mode = data.get('mode', '')
    if not mode.startswith('reference:'):
        sys.exit(f'{RES} is not a reference sweep (mode={mode})')
    reference = mode.split(':', 1)[1]

    detail = {d['id']: d for d in data['detail']}

    # cost per run, keyed the way the sweep names things
    # Join on TASK + cell + rep. Stripping the "t-compliance:" prefix to get the
    # cell name collides compliance rows onto dog rows of the same cell -- which
    # silently paired dog reports with compliance costs, e.g. a $23.50 compliance
    # figure landing on a $7.29 dog run.
    cost, model, effort = {}, {}, {}
    if os.path.exists(CSV):
        for r in csv.DictReader(open(CSV)):
            if r['status'] != 'ok' or r['task_id'] != TASK:
                continue
            # results.csv writes "t-compliance:cell"; the sweep names runs from
            # the facts filenames, which use "t-compliance-cell".
            cell = r['variant'].replace(':', '-')
            key = f"{cell}/{r['rep']}"
            try:
                cost[key] = float(r['cost_usd_total'] or 0)
            except ValueError:
                pass
            model[key] = r.get('model')
            effort[key] = r.get('effort')

    rows = []
    for p in data['pairs']:
        run = p['id'][4:] if p['id'].startswith('ref:') else p['id']
        calls = detail.get(p['id'], {}).get('calls', [])
        if not calls:
            continue
        per_dim, flips, unusable = {}, 0, 0
        for dim in SCORING + REPORTED:
            vals = [dim_points(c, dim) for c in calls]
            good = [v for v in vals if v is not None]
            unusable += sum(1 for v in vals if v is None)
            if not good:
                per_dim[dim] = None
                continue
            # A sign disagreement between the two orders is position bias on that
            # dimension. Record it as 0 rather than averaging a contradiction.
            if len({v > 0 for v in good if v != 0}) > 1:
                flips += 1
                per_dim[dim] = 0.0
            else:
                per_dim[dim] = sum(good) / len(good)
        idx = sum(v for d, v in per_dim.items() if d in SCORING and v is not None)
        rows.append(dict(
            run=run,
            quality_index=round(idx, 2),
            **{f'q_{d.lower()}': per_dim.get(d) for d in SCORING},
            density_vs_baseline=per_dim.get('DENSITY'),
            dim_flips=flips,
            unusable_dims=unusable,
            calls=len(calls),
            cost_usd=cost.get(run),
            model=model.get(run),
            effort=effort.get(run),
        ))

    # the reference itself is 0 by definition
    rows.append(dict(run=reference, quality_index=0.0,
                     **{f'q_{d.lower()}': 0.0 for d in SCORING},
                     density_vs_baseline=0.0, dim_flips=0, unusable_dims=0,
                     calls=0, cost_usd=cost.get(reference),
                     model=model.get(reference), effort=effort.get(reference)))

    rows.sort(key=lambda r: -r['quality_index'])
    with open(OUT, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    # ---- per-cell rollup, with an explicit publishability verdict ----------
    # Downstream tooling must not have to decide whether a quality difference is
    # real. The within-cell spread IS the noise floor: two runs of the SAME
    # configuration differ by this much, so a between-cell gap smaller than it is
    # not a quality difference. Emitting the verdict here keeps that judgment in
    # one place instead of in every consumer.
    import statistics as stats
    from collections import defaultdict
    cells = defaultdict(list)
    for r in rows:
        cells[r['run'].rsplit('/', 1)[0]].append(r)

    spreads = [max(x['quality_index'] for x in v) - min(x['quality_index'] for x in v)
               for v in cells.values() if len(v) >= 3]
    floor = stats.mean(spreads) if spreads else None

    cell_rows = []
    for cell, v in sorted(cells.items()):
        idx = [x['quality_index'] for x in v]
        costs = [x['cost_usd'] for x in v if x['cost_usd'] is not None]
        cell_rows.append(dict(
            cell=cell, n=len(v),
            quality_mean=round(stats.mean(idx), 2),
            quality_min=min(idx), quality_max=max(idx),
            quality_spread=round(max(idx) - min(idx), 2),
            cost_mean=round(stats.mean(costs), 4) if costs else None,
            model=v[0].get('model'), effort=v[0].get('effort'),
            noise_floor=round(floor, 2) if floor else None,
        ))

    # TWO WELL-DEFINED COMPARISONS, not a clustering.
    #
    # Two earlier attempts were both wrong, and the way they were wrong is worth
    # recording so nobody re-derives them:
    #
    #  1. "differs from the baseline by more than the floor" -- on t-compliance
    #     the reference is a strong single run, so nearly every cell sits 4-7
    #     points below it and all 13 looked publishable while being within 1.3
    #     points of each other. A uniform shift is not discrimination.
    #  2. Tie groups cut at adjacent gaps -- single-linkage chaining. Every
    #     adjacent gap is under the floor, so all 20 dog cells collapsed into one
    #     band even though the extremes differ by 11.3 points. Chaining says
    #     nothing resolves when plenty does.
    #
    # There is no honest partition here, because the cells form a continuum. What
    # IS well defined is a specific pairwise comparison against a named cell. So
    # emit exactly the two the tables make, and let each carry its own verdict.
    FIX1 = {'t-dog': 'live-append',
            't-compliance': 't-compliance-live-append'}[TASK]
    fix1_mean = next((c['quality_mean'] for c in cell_rows if c['cell'] == FIX1),
                     None)
    for c in cell_rows:
        # Did this treatment change quality vs what you would have shipped?
        # For the cache-geometry and context cells the answer should be no, and
        # that is the finding: cost moves 4x and quality does not.
        c['vs_baseline'] = c['quality_mean']
        c['differs_from_baseline'] = bool(floor and abs(c['quality_mean']) > floor)
        # Did going cheaper cost quality? This is the fix-2 comparison.
        if fix1_mean is None:
            c['vs_fix1'] = c['differs_from_fix1'] = None
        else:
            gap = c['quality_mean'] - fix1_mean
            c['vs_fix1'] = round(gap, 2)
            c['differs_from_fix1'] = bool(floor and abs(gap) > floor)
        # Render a bare number only when at least one comparison resolves;
        # otherwise the honest cell is "no measurable change".
        c['render'] = ('number' if (c['differs_from_baseline']
                                    or c['differs_from_fix1'])
                       else 'within-noise')
    # SELF-CONSISTENCY GUARD on the baseline comparison.
    #
    # The reference is ONE run, so its idiosyncrasy is baked into every
    # vs_baseline number. There is a clean tell for when that has gone wrong: the
    # reference's OWN cell should sit within the noise floor of it, because those
    # are runs of the same configuration. If it does not, the reference is
    # atypical for its own cell and vs_baseline is measuring the run rather than
    # the treatment -- so suppress it and fall back to vs_fix1.
    #
    # This fires on t-compliance, where the reference is a strong outlier and 12
    # of 13 cells looked significant against it, including its own cell.
    ref_cell = reference.rsplit('/', 1)[0]
    ref_own = next((c for c in cell_rows if c['cell'] == ref_cell), None)
    baseline_trustworthy = not (ref_own and floor
                               and abs(ref_own['quality_mean']) > floor)
    if not baseline_trustworthy:
        for c in cell_rows:
            c['differs_from_baseline'] = None
            c['render'] = 'number' if c['differs_from_fix1'] else 'within-noise'

    ordered = sorted(cell_rows, key=lambda c: -c['quality_mean'])
    cell_out = OUT.replace('.csv', '-cells.csv')
    with open(cell_out, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(cell_rows[0].keys()))
        w.writeheader()
        w.writerows(cell_rows)

    print('=' * 78)
    print(f'PUBLISHABILITY   noise floor (mean within-cell spread, n>=3) = '
          f'{floor:.2f} index points' if floor else 'PUBLISHABILITY  n/a')
    print(f'  gaps must exceed {floor:.2f} to be a quality difference at this n.'
          if floor else '')
    print(f"{'cell':<38}{'n':>3}{'vs base':>9}{'vs fix1':>9}  render")
    print('  ' + '-' * 74)
    for c in ordered:
        vb = (f"{c['vs_baseline']:+.2f}"
              + ('*' if c['differs_from_baseline'] else
                 ('?' if c['differs_from_baseline'] is None else ' ')))
        vf = ('—' if c['vs_fix1'] is None
              else f"{c['vs_fix1']:+.2f}" + ('*' if c['differs_from_fix1'] else ' '))
        print(f"  {c['cell'].replace('t-compliance-', ''):<38}{c['n']:>3}"
              f"{vb:>9}{vf:>9}  {c['render']}")
    print('  ' + '-' * 74)
    print('  * = gap exceeds the noise floor, so the difference is real.')
    if not baseline_trustworthy:
        print(f'  ? = vs_baseline SUPPRESSED. The reference run is atypical for its'
              f' own cell\n      ({ref_cell} mean {ref_own["quality_mean"]:+.2f},'
              f' floor {floor:.2f}), so vs_baseline\n      measures that one run,'
              f' not the treatment. Use vs_fix1.')
    n_res = sum(1 for c in cell_rows if c['render'] == 'number')
    print(f'  {n_res} of {len(cell_rows)} cells resolve on at least one comparison.')
    print(f'  wrote {cell_out}')

    lo = min(r['quality_index'] for r in rows)
    hi = max(r['quality_index'] for r in rows)
    print('=' * 78)
    print(f'QUALITY INDEX vs {reference}   (task {TASK})')
    print(f'  scoring dimensions: {" ".join(SCORING)}')
    print(f'  reported, NOT scored: DENSITY  (agreed with him 1/8 on calibration)')
    print(f'  range {lo:+.1f} .. {hi:+.1f}   theoretical {-2*len(SCORING)} .. '
          f'{2*len(SCORING)}')
    print('=' * 78)
    print(f"{'run':<40}{'index':>7}{'cost':>8}{'dens':>7}{'flip':>6}")
    print('-' * 78)
    for r in rows:
        c = f"${r['cost_usd']:.2f}" if r['cost_usd'] is not None else '—'
        d = f"{r['density_vs_baseline']:+.1f}" if r['density_vs_baseline'] is not None else '—'
        star = '  <-- baseline' if r['run'] == reference else ''
        print(f"{r['run']:<40}{r['quality_index']:>+7.1f}{c:>8}{d:>7}"
              f"{r['dim_flips']:>6}{star}")
    print('-' * 78)
    tot_fl = sum(r['dim_flips'] for r in rows)
    tot_un = sum(r['unusable_dims'] for r in rows)
    print(f'  {len(rows)} runs. {tot_fl} dimension verdicts flipped across orders '
          f'(scored 0). {tot_un} unusable (quote did not verify).')
    print(f'  wrote {OUT}')


if __name__ == '__main__':
    main()
