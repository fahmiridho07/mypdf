# MyPDF Smart Intake, proof of concept (experiment, not shipped)

A narrow end to end demo of the proposed AI document workflow: batch PDF
invoices in, structured CSV plus organized copies out, with validation
flags and human review in between.

## Honesty statement

- This is an experiment in `experiments/`, outside the shipped app. The
  v0.3.0 Tauri app contains no AI and makes no network calls; that does
  not change.
- The default provider is a local regex extractor. It measures the
  pipeline (extract, validate, review, export), not AI quality.
- The Claude provider is real integration code but has never run here:
  no `ANTHROPIC_API_KEY` exists on this machine. Accuracy, latency, and
  cost numbers for Claude are blank until a keyed live run happens.
- All sample invoices are synthetic (see `make_samples.py`).

## Layout

- `provider.py`: provider interface, local mock, Claude API provider.
- `validate.py`: field checks, pure functions.
- `pipeline.py`: CLI workflow (extract, extract fields, validate, CSV,
  optional organize).
- `make_samples.py`: generates 5 synthetic invoices into `samples/`.
- `test_smart_intake.py`: plain script tests, repo convention.
- `EVALUATION.md`: measured results and limits.

## Run

```powershell
python experiments/smart-intake/make_samples.py
python experiments/smart-intake/test_smart_intake.py
python experiments/smart-intake/pipeline.py --in experiments/smart-intake/samples --out experiments/smart-intake/results
```

Live Claude run (needs a key, sends document text to Anthropic):

```powershell
$env:ANTHROPIC_API_KEY="..."
$env:CLAUDE_MODEL="..."  # a current model id from the Claude docs
python experiments/smart-intake/pipeline.py --in <folder> --out <folder> --provider claude --yes
```

Without `--yes`, the Claude path prints exactly what will leave the
machine and asks for typed confirmation. Organized file copies are only
written with `--confirm-rename`; otherwise the run is a dry run that
never touches the originals.
