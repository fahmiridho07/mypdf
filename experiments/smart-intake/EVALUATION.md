# Smart Intake evaluation (2026-10-08, mock provider)

## Method

5 synthetic invoices (`make_samples.py`), pipeline with `--provider mock`,
compared field by field against the known ground truth baked into the
generator. This measures the pipeline and the narrow regex extractor, not
AI quality. No API key exists on this machine, so Claude columns are blank.

## Results

| doc | fields 7/7 | flags as designed |
|---|---|---|
| inv-01-sederhana.pdf (IDR, PPN) | exact | clean |
| inv-02-english.pdf (USD, Sep date) | exact | clean |
| inv-03-minimal.pdf (no colons, dotted IDR) | exact | clean |
| inv-04-missing-tax.pdf | tax null, rest exact | missing:tax |
| inv-05-bad-math.pdf (total 1150 vs 1100) | values as printed | inconsistent_total with arithmetic shown |

Field accuracy (mock, synthetic narrow set): 35/35 exact, 2/2 designed
flags fired, 0 false flags. Total pipeline time: 884 ms for 5 docs
(dominated by engine subprocess startup, not extraction).

## Live Gemini run (2026-10-08, gemini-3.8-flash, partial)

Integration proven end to end: the first 2 of 5 synthetic docs extracted
live with correct vendor/total and clean flags (inv-01 1665000, inv-02
2640.0). Then the key hit `HTTP 429: exceeded current quota` and every
later call failed, including a single doc probe. The batch continued and
recorded `provider_error` rows instead of aborting.

No token, latency, or field accuracy numbers were captured (the 2 early
successes were console only, later overwritten by error rows). Rerun with
a billed key, then fill: per doc latency and input/output tokens from
`review.json` usage, field scores vs ground truth, cost from current
pricing dated that day.

Side findings, fixed in code: `gemini-2.5-flash` is retired for new users
(404 names `gemini-3.8-flash`); the provider now retries transient 5xx and
honors `Retry-After` on 429 instead of hammering quota.

## Limits of this POC

- Mock regex handles a handful of layouts and two number formats; anything
  else yields nulls plus flags, which is the honest failure mode.
- No human review UI yet: review is `review.json` plus the flags column.
- Organized copies are filename sanitized copies; originals never touched.
- The shipped Tauri app is untouched: no AI, no network calls added.

## Live run protocol (needs ANTHROPIC_API_KEY + CLAUDE_MODEL)

1. `pipeline.py --in <real or synthetic dir> --out <dir> --provider claude`
   (consent prompt appears; nothing is sent without YES).
2. Copy the per doc latency and token usage from `review.json` into the
   table above; compute cost from current Claude pricing, dated.
3. Score each field against human read values; report misses as a list,
   not a single percentage alone.
4. Do not claim production readiness from fewer than 50 diverse real
   documents with a second reviewer.
