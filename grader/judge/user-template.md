# The user message — one report per call

Everything below is interpolated by `grader/judge/run-judge.mjs`. The order is
deliberate: FACTS first so the judge has the measurements before it forms an
impression, then the artifacts, then the report last so it is freshest.

The transcript is NEVER included. Its length varies with the treatment being
measured, so including it would leak the experimental condition into the score.

---

```
## FACTS — measured, not judged

These were computed from the run, not read out of the report. They are context
for scoring, not scores. In particular the character count exists ONLY to inform
the density items — it is not a quality signal in either direction.

Report length             {{chars}} characters, {{words}} words
Sources cited             {{n_sources}}
Sources actually opened   {{n_fetched}} of those {{n_sources}}
Web searches run          {{n_searches}}
Pages fetched             {{n_fetches}}

Price claims checked against the provider ledger:
  verified exactly        {{n_verified}}
  CONTRADICTED            {{n_contradicted}}   {{contradicted_detail}}
  provider publishes no   {{n_unpublished}}    {{unpublished_detail}}
    price at all
  claims resting on a     {{n_dead}}           {{dead_detail}}
    citation that 404s

Local providers known to operate in this area (from the ledger — this is not an
exhaustive census of the market, only what has been verified to exist):
{{provider_roster}}

Providers this report names: {{providers_named}}

## THE SUBTASK TREE the agent wrote back

This exists so you can score C5 — whether the report is self-contained or whether
it defers its substance to these. Do not score the subtasks' own quality.

{{subtask_tree}}

## SOURCES the report cites

{{sources_list}}

## THE REPORT

{{report_markdown}}
```

---

## Notes on the fields

- `contradicted_detail` etc. are one-line strings like
  `In Tune $150 (published $195-$325)` so the judge can quote the specific claim
  rather than trusting a bare count.
- `provider_roster` is every provider in `price-ledger.json` with a verified
  address in the South Bay, one per line, with its price range. This is what B6
  is scored against. It is explicitly labelled non-exhaustive so the judge does
  not treat "not in the roster" as "does not exist".
- `subtask_tree` is titles plus the first 200 characters of each description.
  Full descriptions would let a report pass C5 by having good subtasks, which is
  exactly the trade he rejected.
- `sources_list` is `title — url`, in citation order, with `[NOT OPENED]` marked
  on any the agent cited without fetching.
