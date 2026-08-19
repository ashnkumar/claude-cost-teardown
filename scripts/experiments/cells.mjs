// The experiment matrix. A cell = caching strategy × context strategy
// (+ the one server-side lever, fetchcap). naive-append is the app as built;
// its rep-1 is the banked baseline run, so the matrix never re-runs it first.
export const CELLS = {
  'off-append': { cache: 'off', context: 'append' },
  'naive-append': { cache: 'naive', context: 'append' },
  'prefix-append': { cache: 'prefix', context: 'append' },
  // Both fixes composed naively — volatile block still above the messages.
  'fullvol-append': { cache: 'fullvol', context: 'append' },
  'full-append': { cache: 'full', context: 'append' },
  'prefix-window': { cache: 'prefix', context: 'window' },
  'prefix-droptools': { cache: 'prefix', context: 'droptools' },
  'prefix-compact': { cache: 'prefix', context: 'compact' },
  'full-window': { cache: 'full', context: 'window' },
  'full-droptools': { cache: 'full', context: 'droptools' },
  'full-compact': { cache: 'full', context: 'compact' },
  'full-append-fetchcap': {
    cache: 'full', context: 'append', fetchcap: 25000,
  },
  // 25k never bound (largest observed fetch ≈20k tokens); 8k binds on about
  // half the fetches, so this one actually measures the lever.
  'full-append-fetchcap8k': {
    cache: 'full', context: 'append', fetchcap: 8000,
  },
  // droptools minus the state destruction: fetched docs elided, client
  // tool_results (the only copy of the subtask ids) kept verbatim.
  'full-droptools2': { cache: 'full', context: 'droptools2' },
  // full-append without the information loss: run context stays live and is
  // appended to the newest message each turn. Measures whether keeping the
  // agent current costs anything once the bookmark is at the bottom.
  'live-append': { cache: 'live', context: 'append' },
  // The output axis. Every context tactic above targets INPUT tokens; once
  // caching is composed correctly, output is the largest bucket left ($0.67
  // of $1.86) and it sat flat at ~$0.70 across every cell from $7.91 down.
  // These two are the only lever we have that can move it. Layered on
  // live-append so the winner composes rather than competes.
  'live-append-effort-medium': {
    cache: 'live', context: 'append', effort: 'medium',
  },
  'live-append-effort-low': {
    cache: 'live', context: 'append', effort: 'low',
  },
  // The model axis. Nothing to do with caching — which is the point: a team
  // can compose the cache perfectly and still be paying 2-3x more than the
  // task needs. Layered on live-append so every lever composes with fix 1.
  'live-append-sonnet': {
    cache: 'live', context: 'append', model: 'claude-sonnet-5',
  },
  'live-append-sonnet-effort-medium': {
    cache: 'live', context: 'append', model: 'claude-sonnet-5',
    effort: 'medium',
  },
  'live-append-sonnet-effort-low': {
    cache: 'live', context: 'append', model: 'claude-sonnet-5', effort: 'low',
  },
  // The context tactics, re-based onto fix 1. The originals ran on `full`,
  // which freezes the run context into the opener — same cache geometry, but
  // it loses state. Re-basing costs a re-run and buys a table where every
  // row shares one base, so a tactic's delta is the tactic and nothing else.
  'live-window': { cache: 'live', context: 'window' },
  'live-droptools': { cache: 'live', context: 'droptools' },
  'live-droptools2': { cache: 'live', context: 'droptools2' },
  'live-compact': { cache: 'live', context: 'compact' },
  'live-append-fetchcap8k': {
    cache: 'live', context: 'append', fetchcap: 8000,
  },
}

// Stage-1a order: cache families alternate so live-web drift never
// correlates with one treatment. prefix-append is the live smoke (run
// separately, first); naive-append rep-1 is banked.
export const MATRIX_DEFAULT = [
  'off-append',
  'full-append',
  'fullvol-append',
  'prefix-window',
  'full-window',
  'prefix-droptools',
  'full-droptools',
  'prefix-compact',
  'full-compact',
  'full-append-fetchcap',
]
