---
name: Bug report
about: Something broke or behaved unexpectedly
title: ""
labels: bug
---

**What happened?**
A clear description of the problem.

**Steps to reproduce**
1. Open the ... tool
2. Pick a file that ...
3. Click ...

**What did you expect instead?**

**Error message shown in the app (if any)**

```
paste it here
```

**Environment**
- MyPDF version:
- Windows version:
- Which optional tools are installed (Ghostscript / LibreOffice / Tesseract):

**Engine check (optional but very helpful)**
Output of:

```powershell
echo '{"task":"doctor","params":{}}' | python engine/pdf_engine.py
```
