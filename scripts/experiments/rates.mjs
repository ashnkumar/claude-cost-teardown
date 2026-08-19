/**
 * One rate card, for anything that turns tokens into dollars.
 *
 * $/1M tokens: input, output, cache write, cache read. Cache write is
 * 5-minute ephemeral (1.25x input); cache read is 0.1x input.
 *
 * List price on purpose. Sonnet 5 carries an introductory discount ($2/$10)
 * through 2026-08-31, so the card is billed less than this table says — but a
 * cost claim that expires in three weeks is not a claim worth publishing.
 *
 * This file exists because the repo had grown five copies of these numbers,
 * three of them Opus-only. A run priced at the wrong card is not a rounding
 * error: pricing a Sonnet run at Opus rates overstates it by about 1.6x.
 */
export const RATES = {
  'claude-opus-5': [5, 25, 6.25, 0.5],
  'claude-opus-4-8': [5, 25, 6.25, 0.5],
  'claude-sonnet-5': [3, 15, 3.75, 0.3],
  'claude-haiku-4-5': [1, 5, 1.25, 0.1],
}

/** Web search bills per request, outside the four token fields. */
export const SEARCH_USD = 10 / 1000

/** Null for a model with no published rate — never zero. */
export function tokenCost(model, t) {
  const rate = RATES[model]
  if (!rate) return null
  return (
    (t.input ?? 0) * rate[0] +
    (t.output ?? 0) * rate[1] +
    (t.cacheWrite ?? 0) * rate[2] +
    (t.cacheRead ?? 0) * rate[3]
  ) / 1e6
}
