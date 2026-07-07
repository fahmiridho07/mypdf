# MyPDF, agent instructions

Local first desktop PDF toolbox (private alternative to online converters).
Read `README.md` first. Docs and UI copy are in English. Do not use dashes in
user facing copy; page ranges are written with colons, like `1:3`.

## Architecture, do not break it

```
React UI (src/) → Tauri command `run_engine` (src-tauri/) → engine/pdf_engine.py
```

- Rust stays a single thin `run_engine` command; the Python script is embedded
  via `include_str!`. New PDF logic ALWAYS goes into `engine/pdf_engine.py`,
  never into Rust or the UI.
- Engine contract: read one JSON task from stdin as UTF 8 bytes
  (`{"task": "...", "params": {...}}`). stdout carries optional progress lines
  (`{"progress": n, "total": t}`) followed by exactly one result line
  (`{"ok": ..., ...}`). Anything else goes to stderr.
- Outputs must never overwrite existing files; use `unique_path` / `unique_dir`.
- Files never leave the machine. Adding any network call is forbidden.

## Definition of done

```powershell
# Engine, verified headless without the UI:
echo '{"task":"doctor","params":{}}' | python engine/pdf_engine.py
echo '{"task":"<changed-task>","params":{...}}' | python engine/pdf_engine.py
# UI / TS:
npm run build
```

Engine output must be valid JSON with no traceback. Exercise the changed task
on a real PDF.

## Hard rules

1. **External tools are always optional.** Ghostscript, LibreOffice and
   Tesseract/ocrmypdf are detected via the `doctor` task; when missing, return
   a clear JSON error, never crash.
2. **New tasks** are registered in the `pdf_engine.py` dispatch, take params
   from stdin JSON, and are documented in the README task list.
3. Core engine libraries: PyMuPDF (fitz), pikepdf, Pillow. Ask before adding a
   new Python dependency (mind the AGPL license of the project).
4. OCR language data depends on the local `TESSDATA_PREFIX` setup (see README);
   never hardcode a tessdata path.
