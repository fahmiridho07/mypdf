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

## Blank until a live run

- Claude field accuracy, per provider latency, input/output tokens, and
  estimated API cost: all unmeasured. The provider returns usage when the
  API responds; record it here after a keyed run.
- Robustness on real world layouts, etalase scans, and rotated pages:
  untested by design (synthetic samples only).

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
