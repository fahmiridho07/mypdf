# MyPDF v0.3.0, draft release notes (DO NOT PUBLISH YET)

Publish only after the clean Windows QA checklist passes
(`docs/qa-checklist-v0.3.0.md`). No `v0.3.0` tag until then.

## What is new since v0.2.0

- Windows installer runs out of the box: bundled Python 3.11 runtime with
  PyMuPDF, pikepdf, Pillow, pdf2docx, and ocrmypdf. No system Python needed.
- Compress can now fit a size: tell it the MB limit and it tries progressively
  stronger settings until the file fits.
- Long jobs can be cancelled from the UI.
- Arrange keeps internal links and bookmarks, renumbered to the new page
  positions, and preserves visible digital signature stamps.
- New tools: PDF to Word, page numbers with skippable covers, metadata editor.
- Images to PDF accepts a single image; file lists show image thumbnails.
- OCR gives a clear error when Tesseract language data is missing and ignores
  a stale `TESSDATA_PREFIX`. Indonesian OCR still needs `ind.traineddata`
  (see README).
- Interface in English and Bahasa Indonesia, recent work history, output files
  never overwrite existing ones.

## Install (Windows)

1. Download `MyPDF_0.3.0_x64-setup.exe` from the assets below.
2. Run it. Windows SmartScreen may warn about an unrecognized app because the
   installer is not code signed. Click **More info**, then **Run anyway**.
   Every release is built in public from this repository by GitHub Actions,
   so you can verify exactly what you are running.

## Optional helpers (not bundled, per feature)

- Strong compression: Ghostscript.
- Office to PDF: LibreOffice.
- OCR: Tesseract. English works immediately; other languages need their
  `.traineddata` file in the Tesseract tessdata folder.

The app detects what is installed and tells you exactly what is missing.

## Privacy

Everything runs locally on your machine. The app makes no network requests.

## License

AGPL 3.0. Source code for this release is in this repository at the `v0.3.0`
tag. Bundled Python packages (PyMuPDF, pikepdf, Pillow, pdf2docx, ocrmypdf)
and optional helpers keep their own licenses, see README.
