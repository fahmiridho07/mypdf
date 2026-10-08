# Release readiness report, MyPDF v0.3.0 (2026-10-08)

Branch: `release/v0.3.0-readiness`. No tag has been pushed; the latest
published release is still v0.2.0. Release notes in
`docs/release-v0.3.0-draft.md` are a draft and must not be published until
the clean Windows QA checklist (`docs/qa-checklist-v0.3.0.md`) passes.

## Completed work

- Fixed misleading packaging claims (README + release workflow): the Windows
  installer bundles the Python runtime and engine libraries, while
  Ghostscript, LibreOffice, and Tesseract remain optional per feature
  helpers. The app already detects and reports them; docs now agree.
- OCR resilience: a stale `TESSDATA_PREFIX` pointing at a missing folder no
  longer breaks even English OCR (invalid value is dropped for the child
  process, valid custom setups untouched). Missing language data now yields
  `Tesseract has no language data for 'ind'...` instead of a traceback dump.
  OCR options carry a tessdata hint in both languages.
- OCR timeout now kills the child process instead of leaking it.
- Engine errors normalized to English (office2pdf, ocrmypdf missing,
  unknown task, compress fallback engine name).
- UI: output paths use `/` so source runs on Linux/macOS no longer produce
  backslash filenames; OCR missing helper notice names only what is actually
  missing; `img2pdf` accepts a single image; image files get thumbnails.
- `prepare-python.ps1` pins all five dependencies and verifies bundled
  imports after install.
- CI now covers the previous blind spots: Rust `cargo check`, engine smoke
  with `pdf2docx` installed (real conversion path), and a Windows job that
  prepares the exact bundled runtime and runs the smoke suite on it.
- Regression tests added: image thumbnails, empty rearrange order, bad page
  spec. Suite grew from 33 to 37 checks.
- Fresh `docs/screenshot.png` captured from the running v0.3.0 app.

## Test evidence (this machine, 2026-10-08)

- `python tests/engine_smoke.py`: 37 passed, 0 failed (system Python 3.10).
- `src-tauri/python-embed/python.exe tests/engine_smoke.py`: 37/37.
- `npm run build`: clean (tsc + vite).
- `cargo check --manifest-path src-tauri/Cargo.toml`: exit 0.
- End to end on real files: office2pdf RTF to PDF ok; OCR English on an
  image only PDF produced searchable text; OCR `ind+eng` without language
  data gives the friendly error; compress via Ghostscript reports
  `engine: ghostscript`.
- Verified by code inspection: the app makes no network requests (no fetch in
  `src/`, fonts bundled, no updater plugin), outputs never overwrite
  (`unique_path`/`unique_dir` on every task), no secrets in the repo.

## Unresolved risks (not verifiable from here)

- No clean Windows machine available: installer build from the tag, install,
  first launch with no system Python, and the full QA checklist are untested.
- Installer size unknown until a release build runs (bundled runtime on disk
  is ~335 MB; expect a large download).
- Winget submission is still in moderation (`continue-on-error` covers it).
- Landing page (`fahmiridho.me/mypdf/`) is built and validated locally in the
  `web_portofolio` repo but not committed or deployed; deployment needs owner
  approval. Domain email is not configured (owner action, see
  `docs/startup-application-draft.md`).

## Human actions required

1. Run the QA checklist on a clean Windows 10/11 machine or VM.
2. Only then: push the `v0.3.0` tag, confirm the installer artifact, publish
   the release notes.
3. Review, commit, and deploy the landing page; confirm `fahmiridho.me/mypdf/`.
4. Configure and test the domain email before any startup application.
5. Submit the startup application by hand only with truthful details.
