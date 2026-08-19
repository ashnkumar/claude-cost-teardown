<!--
  Every figure below comes out of the results CSV via
  `node scripts/experiments/readme-table.mjs`. Do not type a number into
  this file by hand — if it isn't generated, it isn't traceable.
-->


# claude-cost-teardown

One agent taken apart call by call: what a run actually costs, which fix is
worth doing, and in what order.

[![Watch the talk — 13 minutes, every number on screen](docs/images/talk-poster.png)](https://vimeo.com/1219355297/0ffbb575f0)

The talk is the same teardown with the charts on screen — 13 minutes.

*See the **[project page](https://voxellabs.ai/projects/inference-cost)** on voxellabs.ai.*

## Quickstart

```bash
git clone https://github.com/ashnkumar/claude-cost-teardown && cd claude-cost-teardown
npm install
node scripts/experiments/readme-table.mjs --check --readme README.md
node scripts/experiments/mechanism.mjs    --check --readme README.md
node scripts/experiments/run-cell.mjs --cell=live-append --task=t-dog --dry-run
```

Needs Node 20.6+. The two `--check` commands rebuild both tables from
`experiments/results/results.csv` and recompute every hand-typed figure in
the prose from the shipped `usage.jsonl` records, failing on any drift. The
third runs one full replicate of the harness — loop, tools, error path —
against a scripted stub and writes the same `result.json` shape a real run
produces. `run-matrix.mjs --dry-run` does that for every default cell.

To spend real money, see **Add a live replicate**; to run the app the agent
lives in, see **Run the agent itself**.

## What this measures

Startup founders keep saying the same thing about agents in production:
inference costs are skyrocketing. This repo is a systematic way to bring
them down — meter every request, change one variable at a time, and measure
what each fix is actually worth.

The agent was extracted from a personal AI operating system we built for a
client through [Voxel Labs](https://voxellabs.ai), where agents work
alongside humans to accomplish tasks. It researches a task, decomposes it,
and writes a report — and the costs below are the ones that prompted the
teardown.

Step zero is instrumentation: every Anthropic request is metered where it
is constructed — uncached input, output, cache writes, cache reads. The
same loop then runs repeatedly with one variable changed at a time. The
result is an order of operations:

- **Fix 1 — increase cache reads.** Move volatile prompt content below the cache
  breakpoint.
- **Fix 2 — model and effort.** Apply on top of Fix 1. The only lever here
  that moves latency — but every cheaper setting cost quality on the
  open-ended task, and the cheapest stopped fetching pages and wrote the
  report anyway.
- **Fix 3 — context engineering.** Sliding windows, dropping tool payloads,
  periodic compaction, fetch caps. Test these last.

**TL;DR: fix prompt structure first, then pick model and effort deliberately,
and only then consider context tactics — once Fix 1 is in, not one of them
is cheaper than leaving the loop alone.** The tables show the rest.

![Stacked cost per run on the open-ended task, decomposed into uncached
input, cache write, cache read, output and search fees, ordered as-built,
Fix 1, then Fix 2.](docs/images/cost-ladder.png)

## The numbers

Two tasks, run through the same harness. Cost is the mean across replicates
with the observed min–max beneath it; a treatment with no runs for a task
shows as "—" rather than being dropped.

**Task 1 — open-ended research.** A broad "find out about X and write it up"
task with no fixed answer set.

<!-- TABLE:DOG -->
| Treatment | Model | Effort | n | Cost | Latency | Searches | Fetches | Report | Quality vs Fix 1 |
|---|---|---|---|---:|---:|---:|---:|---:|---:|
| No caching at all | opus-5 | high | 3 | $7.91 <sub>6.92–9.54</sub> | 569s | 19.0 | 12.3 | 13,539 | no measurable change |
| Built as-is (baseline) | opus-5 | high | 3 | $4.76 <sub>4.35–5.07</sub> | 573s | 11.3 | 13.0 | 15,327 | no measurable change |
| Fix 3 — drop tool payloads | opus-5 | high | 3 | $3.92 <sub>2.99–5.39</sub> | 574s | 16.0 | 18.3 | 14,886 | no measurable change |
| Fix 3 — fetch cap, 8k tokens | opus-5 | high | 3 | $2.29 <sub>1.96–2.73</sub> | 633s | 16.3 | 19.0 | 11,120 | no measurable change |
| Fix 3 — elide fetched docs, keep tool results | opus-5 | high | 3 | $2.25 <sub>2.16–2.37</sub> | 683s | 16.7 | 17.7 | 10,639 | no measurable change |
| Fix 3 — periodic compaction | opus-5 | high | 1 | $1.93 | 568s | 20.0 | 16.0 | 7,164 | −4.2 |
| Fix 1 — cache geometry | opus-5 | high | 3 | $1.86 <sub>1.78–1.93</sub> | 540s | 13.7 | 9.7 | 13,493 | no measurable change |
| Fix 1 + Opus 5 / low | opus-5 | low | 3 | $0.82 <sub>0.67–1.06</sub> | 259s | 11.0 | 11.3 | 6,692 | −4.8 |
| Fix 1 + Sonnet 5 / high | sonnet-5 | high | 3 | $0.61 <sub>0.49–0.78</sub> | 154s | 4.0 | 2.3 | 7,377 | −6.8 |
| Fix 1 + Sonnet 5 / low | sonnet-5 | low | 3 | $0.29 <sub>0.25–0.33</sub> | 82s | 2.3 | 0.0 | 4,539 | −9.3 |

<sub>Quality is a signed margin vs the Fix 1 cell: every report was judged head-to-head against the same fixed as-built reference run, four dimensions at ±2 each, and cell means were rebased so Fix 1 sits at zero — a rebased margin can land outside ±8. The mean spread between replicates of the *same* configuration is 3.83 index points on this task, so any smaller gap is reported as no measurable change rather than as a number.</sub>
<!-- /TABLE:DOG -->

**Task 2 — regulatory compliance research.** Longer, more sources, more
fetching. The heavier of the two, and the one where the differences are
widest.

<!-- TABLE:COMPLIANCE -->
| Treatment | Model | Effort | n | Cost | Latency | Searches | Fetches | Report | Quality vs Fix 1 |
|---|---|---|---|---:|---:|---:|---:|---:|---:|
| No caching at all | opus-5 | high | 3 | $15.93 <sub>9.82–23.50</sub> | 942s | 27.3 | 6.7 | 19,734 | not resolved at n=3 |
| Built as-is (baseline) | opus-5 | high | 3 | $7.50 <sub>5.56–9.33</sub> | 806s | 27.7 | 2.0 | 18,936 | not resolved at n=3 |
| Fix 3 — drop tool payloads | opus-5 | high | 3 | $4.14 <sub>2.63–5.52</sub> | 666s | 19.3 | 4.0 | 19,446 | not resolved at n=3 |
| Fix 3 — fetch cap, 8k tokens | opus-5 | high | 3 | $2.30 <sub>1.78–2.62</sub> | 582s | 20.0 | 2.3 | 14,649 | not resolved at n=3 |
| Fix 3 — elide fetched docs, keep tool results | opus-5 | high | 3 | $2.32 <sub>1.60–2.89</sub> | 619s | 19.7 | 2.7 | 14,742 | not resolved at n=3 |
| Fix 3 — periodic compaction | opus-5 | high | 3 | $2.89 <sub>2.78–3.01</sub> | 770s | 21.3 | 3.0 | 17,025 | not resolved at n=3 |
| Fix 1 — cache geometry | opus-5 | high | 3 | $2.15 <sub>1.87–2.53</sub> | 557s | 23.0 | 2.0 | 15,114 | not resolved at n=3 |
| Fix 1 + Opus 5 / low | opus-5 | low | 3 | $0.72 <sub>0.67–0.78</sub> | 207s | 9.3 | 0.0 | 7,574 | not resolved at n=3 |
| Fix 1 + Sonnet 5 / high | sonnet-5 | high | 3 | $1.14 <sub>1.02–1.23</sub> | 384s | 10.3 | 1.7 | 9,680 | not resolved at n=3 |
| Fix 1 + Sonnet 5 / low | sonnet-5 | low | 3 | $0.63 <sub>0.61–0.65</sub> | 146s | 6.0 | 0.0 | 10,674 | not resolved at n=2 |

<sub>Same instrument and rebasing as the first table. The mean spread between replicates of the *same* configuration is 3.46 index points here, and no treatment separated from any other by more than that — so quality is not reported for this task. The instrument did not resolve it, which is not the same as the treatments being equivalent.</sub>
<!-- /TABLE:COMPLIANCE -->

**How to read the quality column:**

1. **Head-to-head, not scored in isolation.** Every report is judged against
   the same fixed reference, in both display orders. The judge sees only
   final reports, never transcripts.
2. **The noise floor is the replicate spread** — the same configuration
   compared with itself. A gap smaller than that is reported as no
   measurable change, not as a decimal.
3. **Fix 1 is the zero point.** A rebased margin is the difference of two
   ±8 quantities, so it can land outside ±8.
4. **"No measurable change" is not "quality held."** It means the gap is
   smaller than the spread between replicates of the same configuration.

This is the second quality instrument in the repo; the first saturated at
the top of its scale, and both ship — `grader/README.md` has that story.
Every verdict is backed by a quote checked to exist in its source report.

## Why Fix 1 (moving dynamic context) wins

Caching was already on. Without it the as-built run would have cost $7.06
instead of the $4.87 it was billed — it was already saving $2.19. Across
the 16 calls of that run, 11 read exactly zero cached tokens, and every
one of the 563,955 tokens that did come from cache — 100.00% of them —
landed on the 5 calls that contain a web search or fetch.

The volatile lines in the prompt are rewritten once per HTTP request.
Inside a request, the server-tool loop runs several inferences against an
unchanged prefix, so those hit cache; the next turn rewrites the block and
buys the whole conversation again at full price. **The cache worked inside
a turn and died between turns.**

![Per-call cache reads across the as-built run, showing 11 of 16 calls
reading exactly zero and all cached reads landing on the five calls
containing a web search or fetch.](docs/images/cache-inside-a-turn.png)

Moving the volatile block below the breakpoint is the whole fix. After it,
total uncached input across the whole 11-call run is 66 tokens, and caching
saves $4.97 on a run that costs $1.86, against the $2.19 it was saving
before.

It is also why the context tactics lose. Dropping results, eliding
documents and compaction rewrite history, which invalidates the cached
prefix behind the edit; compaction also pays for the summary call; a capped
fetch can make the agent fetch again. All four add work once the cache
geometry is fixed.

![The four context tactics on the open-ended task, each priced as a
percentage of the Fix 1 run rather than the as-built baseline: all four
cost more.](docs/images/graveyard-vs-fix1.png)

## Method

The design hazard: Anthropic's prompt cache is shared within an org and
stays warm, so one experiment can affect the next.

- **One variable per cell.** Same loop, same source; nothing is forked.
- **Strictly sequential runs**, one process per replicate, with a cooldown
  long enough for the cache to go cold.
- **A seed-state assertion before every run** — a half-finished task tree
  doesn't run.
- **Failed runs** are recorded, excluded from every statistic, and counted
  separately.
- **One function talks to Anthropic** and appends one usage row per call;
  billed tokens no row captured are recovered as `cost_recovered_usd`.
- **Headline cells are n=3.** n=1 cells say so — a single run is a data
  point, not a result.

Not controlled for: the live web moves, so some of the min–max spread is
the internet; cache reads inside the provider's web-search container are
excluded from the prefix figures; prices are list, not promotional; and two
tasks is two tasks — the ordering transfers, not a benchmark score.

## Add a live replicate

Runs cost real money — the most expensive cell is roughly two orders of
magnitude above the cheapest.

```bash
cp .env.example .env          # add your ANTHROPIC_API_KEY
npm install
node --env-file=.env scripts/experiments/run-matrix.mjs --cells=naive-append,live-append
node scripts/experiments/aggregate.mjs
node scripts/experiments/readme-table.mjs --readme README.md
```

Nothing in the repo loads `.env` on its own — `--env-file` hands the key to
the driver. This appends two fresh replicates to the shipped corpus and
re-renders the tables: a live check of the machinery, not a rerun of the
campaign. Don't shorten the cooldown — that is the one setting that
invalidates the result.

## Run the agent itself

```bash
npm install
npm run dev            # http://localhost:3939
```

The UI boots against `data/seed.json` with no key present. Pressing deploy
on a task makes real Anthropic calls and spends real money; the spend gate
(`lib/gate.ts`) refuses past a ceiling once you name one —
`DELEGATE_CEILING_USD=0.40 npm run dev` — and ships off so a measurement
run can reach its natural end. The gate is a projection, not a hard bound.
It sits outside the loop, unreachable from inside it, because a budget the
model can see is one it can reason its way around — make yours fail closed.

## Repository map

```
lib/anthropic/call.ts             the only place an Anthropic request is built
lib/anthropic/usage.ts            the meter: four token fields per call
lib/agent/{prompt,tools,loop}.ts  system prompt · tools · the loop
lib/gate.ts                       the spend gate, wrapping the loop from outside
app/, components/                 the task manager the agent runs inside
data/seed.json                    the 18 seeded tasks every run starts from

scripts/experiments/cells.mjs           the matrix: one object per treatment
scripts/experiments/run-matrix.mjs      sequential driver, cooldown, one proc/rep
scripts/experiments/run-cell.mjs        one replicate: seed check, run, record
scripts/experiments/strategies-*.mjs    the caching and context treatments
scripts/experiments/rates.mjs           one rate card
scripts/experiments/aggregate.mjs       runs -> results.csv
scripts/experiments/readme-table.mjs    results.csv -> the tables above
scripts/experiments/grade.mjs           quality scoring
scripts/usage-dashboard.mjs             live meter, and beat-by-beat replay

grader/                                 the quality instrument, and the one it
                                        replaced — grader/README.md tells that story
```

The agent loop is hand-rolled on the raw Messages API rather than the Agent
SDK — everything measured here is a property of the loop.

## Where the fix lives

The app ships **bug included, on purpose** — the app is the specimen, and
patching it would un-reproduce the baseline column. The measured Fix 1
lives in the harness: the `full` and `live` cells in
`scripts/experiments/strategies-cache.mjs`, plus the block in
`scripts/experiments/harness-loop.mjs` that re-appends the fresh run
context inside the latest tool result instead of rewriting the prefix.
Diff the `naive` cell against `live` and you have read the entire change.

## Limitations

- **Quality on the compliance task is unresolved at n=3** — every gap is
  smaller than the replicate spread. That is not the same as the treatments
  being equivalent.
- **Withheld treatments still ship.** `experiments/WITHDRAWN.md` names each
  with its run count and reason — including the sliding-window lineage,
  which mostly crashes; that one is a result, not a gap. `readme-table.mjs`
  prints the held-back list on every run.
- **Filter on `status == ok` before recomputing anything.** Four of the
  seven Fix 1 replicates are failed runs; averaging them in makes Fix 1
  look 53% cheaper than it is.
- **Web search carries a per-request fee.** Repricing from token counts
  alone lands $0.11 short on the as-built run — 11 searches at $10 per
  1,000. Carried as `cost_search_fees` in the results CSV.
- **Raw request/response transcripts don't ship** — they hold the full text
  of every fetched page. Every dollar figure recomputes from the shipped
  `usage.jsonl` files. The run index is the set of `result.json`
  directories, not `experiments/manifest.jsonl`.
- **One agent, one loop, two tasks.** The ordering of the fixes is the
  transferable result; the dollar figures are specific to this workload.

## License

MIT — see [LICENSE](LICENSE).
