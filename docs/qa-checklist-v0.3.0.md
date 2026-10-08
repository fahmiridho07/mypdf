# Manual QA checklist, MyPDF v0.3.0 on clean Windows

Run on a Windows 10/11 machine or VM with no Python, no Ghostscript,
no LibreOffice, and no Tesseract installed. Build the installer from the
release branch first (`./scripts/prepare-python.ps1`, then
`npm run tauri build`), or use the CI artifact from the `v0.3.0` tag pipeline.

## Install and launch

- [ ] `MyPDF_0.3.0_x64-setup.exe` installs without errors.
- [ ] Note the installer file size here: ______ MB.
- [ ] App launches with no system Python on PATH.
- [ ] Home screen renders, greeting, quick cards, recent work section.
- [ ] Settings page opens; language toggle EN/ID works.

## Core tools (use a 3+ page PDF)

- [ ] Merge two PDFs, page count adds up.
- [ ] Arrange: reorder, rotate, duplicate, remove a page, undo with Ctrl Z.
- [ ] Split per page and by custom ranges (`1:3; 4:10`).
- [ ] Pick pages keeps only the selected pages.
- [ ] Rotate whole file and selected pages.
- [ ] PDF to Images renders PNGs; Images to PDF builds one PDF.
- [ ] Lock with password, then Unlock with the right and wrong password.
- [ ] Watermark stamps faint text on every page.
- [ ] Extract Text produces a readable .txt.
- [ ] Page numbers with a skipped cover page.
- [ ] Metadata edits survive a reopen.
- [ ] Compress Balanced on a photo heavy PDF shrinks it and reports savings.

## Optional tool honesty (clean machine has none of these)

- [ ] Office to PDF shows the LibreOffice guidance, does not crash.
- [ ] OCR shows the Tesseract guidance, does not crash.
- [ ] PDF to Word works out of the box (bundled, no extra install).
- [ ] Home shows the Ghostscript notice; compress still produces output.

## With helpers installed (second pass)

- [ ] Install Ghostscript, compress gains strength (report sizes).
- [ ] Install LibreOffice, Office to PDF converts a .docx.
- [ ] Install Tesseract, OCR with English works on a scanned page.
- [ ] OCR with Indonesian+English fails with the clear language data message
      until `ind.traineddata` is added to the tessdata folder.

## Safety

- [ ] Rerunning a tool never overwrites an existing output file.
- [ ] Cancel stops a long job (OCR or large convert) and reports it calmly.
- [ ] Locked PDFs give the friendly unlock first message in every tool.
- [ ] No network activity during any task (offline install machine).

## Sign off

Tester: ______  Date: ______  Result: PASS / FAIL
Notes: ______
