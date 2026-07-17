"""PDF engine for my_pdf desktop app.

Reads a JSON task from stdin, writes a JSON result to stdout.
Input:  {"task": "merge", "params": {...}}
Output: {"ok": true, "result": {...}} or {"ok": false, "error": "..."}

External tools (optional, per feature):
  - Ghostscript (gswin64c) -> best compression
  - LibreOffice (soffice)  -> office -> pdf conversion
  - ocrmypdf + Tesseract   -> OCR
"""

import json
import os
import shutil
import subprocess
import sys


def find_tool(*names):
    for n in names:
        p = shutil.which(n)
        if p:
            return p
    # common install locations on Windows not always on PATH
    candidates = {
        "gswin64c": [r"C:\Program Files\gs"],
        "soffice": [r"C:\Program Files\LibreOffice\program\soffice.exe"],
        "tesseract": [r"C:\Program Files\Tesseract-OCR\tesseract.exe"],
    }
    for n in names:
        for c in candidates.get(n, []):
            if c.endswith(".exe") and os.path.isfile(c):
                return c
            if os.path.isdir(c):  # ghostscript: gs\gs10.x\bin\gswin64c.exe
                for root, _dirs, files in os.walk(c):
                    if "gswin64c.exe" in files:
                        return os.path.join(root, "gswin64c.exe")
    return None


def unique_path(path):
    """Never overwrite: report_compressed.pdf -> report_compressed (2).pdf."""
    if not os.path.exists(path):
        return path
    stem, ext = os.path.splitext(path)
    i = 2
    while os.path.exists(f"{stem} ({i}){ext}"):
        i += 1
    return f"{stem} ({i}){ext}"


def unique_dir(path):
    if not os.path.exists(path):
        return path
    i = 2
    while os.path.exists(f"{path} ({i})"):
        i += 1
    return f"{path} ({i})"


def open_pdf(path):
    """Open with a clear error instead of a cryptic one when locked."""
    import fitz
    doc = fitz.open(path)
    if doc.needs_pass:
        doc.close()
        raise RuntimeError(
            f"{os.path.basename(path)} is password protected. "
            "Unlock it first, then try again.")
    return doc


def run(cmd, **kw):
    return subprocess.run(
        cmd, capture_output=True, text=True,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), **kw
    )


def emit_progress(done, total):
    """Progress lines stream to stdout; the app turns them into a live bar."""
    print(json.dumps({"progress": done, "total": total}), flush=True)


def parse_page_ranges(spec, page_count):
    """'1-3,5,7-' -> zero-based page indexes. ':' works the same as '-'."""
    pages = []
    try:
        for part in spec.replace(" ", "").replace(":", "-").split(","):
            if not part:
                continue
            if "-" in part:
                a, _, b = part.partition("-")
                start = int(a) if a else 1
                end = int(b) if b else page_count
                pages.extend(range(start - 1, min(end, page_count)))
            else:
                pages.append(int(part) - 1)
    except ValueError:
        raise ValueError(
            f'Could not read the page selection "{spec}". '
            'Use numbers, commas and ranges, like 1,3,5 or 2:8.')
    return [p for p in pages if 0 <= p < page_count]


# ---------------------------------------------------------------- tasks

def task_info(p):
    import fitz
    doc = fitz.open(p["input"])
    info = {
        "pages": doc.page_count,
        "encrypted": doc.needs_pass,
        "size_bytes": os.path.getsize(p["input"]),
        "metadata": doc.metadata,
    }
    doc.close()
    return info


def task_merge(p):
    import fitz
    out = fitz.open()
    for path in p["inputs"]:
        src = open_pdf(path)
        out.insert_pdf(src)
        src.close()
    outp = unique_path(p["output"])
    out.save(outp, garbage=3, deflate=True)
    out.close()
    return {"output": outp}


def task_split(p):
    import fitz
    src = open_pdf(p["input"])
    base = os.path.splitext(os.path.basename(p["input"]))[0]
    outdir = unique_dir(p["output_dir"])
    os.makedirs(outdir, exist_ok=True)
    outputs = []
    mode = p.get("mode", "all")  # "all" = one file per page, "ranges"
    if mode == "ranges":
        for i, spec in enumerate(p["ranges"], 1):
            pages = parse_page_ranges(spec, src.page_count)
            if not pages:
                continue
            out = fitz.open()
            for pg in pages:
                out.insert_pdf(src, from_page=pg, to_page=pg)
            path = os.path.join(outdir, f"{base}_part{i}.pdf")
            out.save(path, garbage=3, deflate=True)
            out.close()
            outputs.append(path)
    else:
        for pg in range(src.page_count):
            out = fitz.open()
            out.insert_pdf(src, from_page=pg, to_page=pg)
            path = os.path.join(outdir, f"{base}_page{pg + 1}.pdf")
            out.save(path)
            out.close()
            outputs.append(path)
            emit_progress(pg + 1, src.page_count)
    src.close()
    return {"outputs": outputs}


def task_extract_pages(p):
    import fitz
    src = open_pdf(p["input"])
    pages = parse_page_ranges(p["pages"], src.page_count)
    if not pages:
        raise ValueError("That page selection matches no pages in this file.")
    out = fitz.open()
    for pg in pages:
        out.insert_pdf(src, from_page=pg, to_page=pg)
    outp = unique_path(p["output"])
    out.save(outp, garbage=3, deflate=True)
    out.close()
    src.close()
    return {"output": outp, "pages": len(pages)}


def task_compress(p):
    """Compress via Ghostscript. Either a preset level (screen/ebook/printer)
    or custom image downsampling (dpi 30..300, jpeg quality 10..95)."""
    inp, outp = p["input"], unique_path(p["output"])
    open_pdf(inp).close()  # fail early with a clear message if locked
    gs = find_tool("gswin64c", "gs")
    before = os.path.getsize(inp)
    if gs:
        args = [gs, "-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.5",
                "-dNOPAUSE", "-dQUIET", "-dBATCH"]
        if p.get("mode") == "custom":
            dpi = max(30, min(300, int(p.get("dpi", 120))))
            quality = max(10, min(95, int(p.get("quality", 70))))
            args += [
                "-dDownsampleColorImages=true",
                "-dColorImageDownsampleType=/Bicubic",
                f"-dColorImageResolution={dpi}",
                "-dDownsampleGrayImages=true",
                "-dGrayImageDownsampleType=/Bicubic",
                f"-dGrayImageResolution={dpi}",
                "-dDownsampleMonoImages=true",
                f"-dMonoImageResolution={min(600, dpi * 2)}",
                "-dAutoFilterColorImages=false",
                "-dAutoFilterGrayImages=false",
                "-dColorImageFilter=/DCTEncode",
                "-dGrayImageFilter=/DCTEncode",
                f"-dJPEGQ={quality}",
            ]
        else:
            level = p.get("level", "ebook")  # screen | ebook | printer
            args.append(f"-dPDFSETTINGS=/{level}")
        r = run(args + [f"-sOutputFile={outp}", inp])
        if r.returncode != 0:
            raise RuntimeError(f"Ghostscript gagal: {r.stderr[:500]}")
        engine = "ghostscript"
    else:
        import fitz
        doc = fitz.open(inp)
        doc.save(outp, garbage=4, deflate=True, clean=True)
        doc.close()
        engine = "pymupdf (install Ghostscript untuk kompresi lebih kuat)"
    after = os.path.getsize(outp)
    if after >= before:  # keep the smaller original
        shutil.copyfile(inp, outp)
        after = before
    return {"output": outp, "before": before, "after": after, "engine": engine}


def task_rotate(p):
    doc = open_pdf(p["input"])
    angle = int(p.get("angle", 90))
    pages = (parse_page_ranges(p["pages"], doc.page_count)
             if p.get("pages") else range(doc.page_count))
    for pg in pages:
        page = doc[pg]
        page.set_rotation((page.rotation + angle) % 360)
    outp = unique_path(p["output"])
    doc.save(outp, garbage=3, deflate=True)
    doc.close()
    return {"output": outp}


def task_watermark(p):
    import fitz
    doc = open_pdf(p["input"])
    text = p["text"]
    fontsize = int(p.get("fontsize", 48))
    opacity = float(p.get("opacity", 0.15))
    for page in doc:
        r = page.rect
        page.insert_textbox(
            fitz.Rect(0, r.height / 2 - fontsize, r.width, r.height / 2 + fontsize),
            text, fontsize=fontsize, fontname="helv",
            color=(0.5, 0.5, 0.5), fill_opacity=opacity,
            align=fitz.TEXT_ALIGN_CENTER, rotate=0, overlay=True,
        )
    outp = unique_path(p["output"])
    doc.save(outp, garbage=3, deflate=True)
    doc.close()
    return {"output": outp}


def task_protect(p):
    import pikepdf
    outp = unique_path(p["output"])
    with pikepdf.open(p["input"]) as pdf:
        pdf.save(outp, encryption=pikepdf.Encryption(
            owner=p["password"], user=p["password"], R=6))
    return {"output": outp}


def task_unlock(p):
    import pikepdf
    outp = unique_path(p["output"])
    try:
        with pikepdf.open(p["input"], password=p.get("password", "")) as pdf:
            pdf.save(outp)
    except pikepdf.PasswordError:
        raise RuntimeError("That password does not open this PDF. Check it and try again.")
    return {"output": outp}


def task_pdf2img(p):
    doc = open_pdf(p["input"])
    dpi = int(p.get("dpi", 150))
    fmt = p.get("format", "png")
    outdir = unique_dir(p["output_dir"])
    os.makedirs(outdir, exist_ok=True)
    base = os.path.splitext(os.path.basename(p["input"]))[0]
    outputs = []
    for pg in range(doc.page_count):
        pix = doc[pg].get_pixmap(dpi=dpi)
        path = os.path.join(outdir, f"{base}_page{pg + 1}.{fmt}")
        pix.save(path)
        outputs.append(path)
        emit_progress(pg + 1, doc.page_count)
    doc.close()
    return {"outputs": outputs}


def task_img2pdf(p):
    import fitz
    out = fitz.open()
    for path in p["inputs"]:
        img = fitz.open(path)
        rect = img[0].rect
        pdfbytes = img.convert_to_pdf()
        img.close()
        pdf = fitz.open("pdf", pdfbytes)
        page = out.new_page(width=rect.width, height=rect.height)
        page.show_pdf_page(rect, pdf, 0)
        pdf.close()
    outp = unique_path(p["output"])
    out.save(outp, garbage=3, deflate=True)
    out.close()
    return {"output": outp}


def task_office2pdf(p):
    soffice = find_tool("soffice")
    if not soffice:
        raise RuntimeError(
            "LibreOffice belum terinstall. Install dengan: "
            "winget install TheDocumentFoundation.LibreOffice")
    import tempfile
    outp = unique_path(p["output"])
    # Convert into a scratch dir first: soffice always writes <stem>.pdf and
    # would silently overwrite an existing file in the target folder.
    with tempfile.TemporaryDirectory(prefix="mypdf_") as tmp:
        r = run([soffice, "--headless", "--convert-to", "pdf",
                 "--outdir", tmp, p["input"]], timeout=300)
        produced = os.path.join(
            tmp, os.path.splitext(os.path.basename(p["input"]))[0] + ".pdf")
        if not os.path.isfile(produced):
            raise RuntimeError(f"Conversion failed: {r.stderr[:500] or r.stdout[:500]}")
        shutil.move(produced, outp)
    return {"output": outp}


def task_ocr(p):
    try:
        import ocrmypdf  # noqa: F401
    except ImportError:
        raise RuntimeError(
            "ocrmypdf belum terinstall. Install dengan: pip install ocrmypdf "
            "(dan Tesseract: winget install UB-Mannheim.TesseractOCR)")
    import re
    lang = p.get("lang", "ind+eng")
    outp = unique_path(p["output"])
    doc = open_pdf(p["input"])
    total = doc.page_count
    doc.close()
    args = [sys.executable, "-m", "ocrmypdf", "-l", lang,
            "--skip-text", "-v1", p["input"], outp]
    proc = subprocess.Popen(
        args, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True,
        errors="replace",
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    seen = set()
    tail = []
    for line in proc.stderr:
        tail.append(line)
        tail = tail[-30:]
        # "N Grafting" is logged near the end of each page's pipeline
        m = re.match(r"\s*(\d+) Grafting\b", line)
        if m and int(m.group(1)) not in seen:
            seen.add(int(m.group(1)))
            emit_progress(len(seen), total)
    proc.wait(timeout=1800)
    if proc.returncode != 0:
        raise RuntimeError(f"OCR failed: {''.join(tail)[:800]}")
    return {"output": outp}


def task_pdf2docx(p):
    import contextlib
    import logging
    import re
    try:
        from pdf2docx import Converter
    except ImportError:
        raise RuntimeError(
            "The pdf2docx package is not installed. "
            "Run: pip install pdf2docx, then try again.")
    doc = open_pdf(p["input"])  # friendly error if locked
    total = doc.page_count
    doc.close()
    outp = unique_path(p["output"])

    # pdf2docx logs to stdout, which must stay JSON only. Send its output to
    # stderr and turn the per page log lines into progress events (the
    # converter walks the pages twice: parsing, then creating). Progress must
    # bypass the redirect, so keep a handle on the real stdout.
    real_stdout = sys.stdout

    class _Progress(logging.Handler):
        done = 0

        def emit(self, record):
            if re.search(r"\(\d+/\d+\) Page", record.getMessage()):
                self.done += 1
                real_stdout.write(json.dumps(
                    {"progress": self.done, "total": total * 2}) + "\n")
                real_stdout.flush()

    handler = _Progress()
    logging.getLogger().addHandler(handler)
    try:
        with contextlib.redirect_stdout(sys.stderr):
            cv = Converter(p["input"])
            try:
                cv.convert(outp)
            finally:
                cv.close()
    finally:
        logging.getLogger().removeHandler(handler)
    if not os.path.isfile(outp):
        raise RuntimeError("Conversion produced no output file.")
    return {"output": outp}


def task_extract_text(p):
    doc = open_pdf(p["input"])
    text = "\n\n".join(page.get_text() for page in doc)
    doc.close()
    outp = unique_path(p["output"])
    with open(outp, "w", encoding="utf-8") as f:
        f.write(text)
    return {"output": outp, "chars": len(text)}


def task_thumbnail(p):
    """First page rendered small, returned as base64 PNG data URL."""
    import base64
    import fitz
    doc = fitz.open(p["input"])
    if doc.needs_pass:
        doc.close()
        return {"thumb": None, "pages": 0, "encrypted": True,
                "size_bytes": os.path.getsize(p["input"])}
    pix = doc[int(p.get("page", 0))].get_pixmap(dpi=int(p.get("dpi", 40)))
    data = base64.b64encode(pix.tobytes("png")).decode()
    info = {"thumb": f"data:image/png;base64,{data}",
            "pages": doc.page_count, "encrypted": False,
            "size_bytes": os.path.getsize(p["input"])}
    doc.close()
    return info


def task_thumbnails(p):
    """Metadata + first page thumbnail for many files in one call."""
    result = {}
    for path in p["inputs"][:40]:
        try:
            result[path] = task_thumbnail({"input": path})
        except Exception as e:  # noqa: BLE001 - report per file
            result[path] = {"error": str(e)}
    return result


def task_page_thumbs(p):
    """Small render of every page, for the page organizer grid."""
    import base64
    doc = open_pdf(p["input"])
    limit = int(p.get("limit", 200))
    dpi = int(p.get("dpi", 28))
    thumbs = []
    count = min(doc.page_count, limit)
    for pg in range(count):
        pix = doc[pg].get_pixmap(dpi=dpi)
        thumbs.append("data:image/png;base64," + base64.b64encode(pix.tobytes("png")).decode())
        if pg % 5 == 4:
            emit_progress(pg + 1, count)
    total = doc.page_count
    doc.close()
    return {"thumbs": thumbs, "pages": total}


def task_rearrange(p):
    """Rebuild a PDF with pages in the given order; omitted pages are dropped."""
    import fitz
    src = open_pdf(p["input"])
    order = [i for i in p["order"] if isinstance(i, int) and 0 <= i < src.page_count]
    if not order:
        raise ValueError("Keep at least one page.")
    rotations = {int(k): int(v) for k, v in (p.get("rotations") or {}).items()}
    out = fitz.open()
    for pos, pg in enumerate(order):
        out.insert_pdf(src, from_page=pg, to_page=pg)
        extra = rotations.get(pg, 0)
        if extra:
            page = out[pos]
            page.set_rotation((page.rotation + extra) % 360)
    outp = unique_path(p["output"])
    out.save(outp, garbage=3, deflate=True)
    out.close()
    src.close()
    return {"output": outp, "pages": len(order)}


def task_doctor(_p):
    """Report which engines/tools are available."""
    tools = {}
    for mod in ("fitz", "pikepdf", "ocrmypdf", "pdf2docx"):
        try:
            __import__(mod)
            tools[mod] = True
        except ImportError:
            tools[mod] = False
    tools["ghostscript"] = bool(find_tool("gswin64c", "gs"))
    tools["libreoffice"] = bool(find_tool("soffice"))
    tools["tesseract"] = bool(find_tool("tesseract"))
    return tools


TASKS = {
    "info": task_info,
    "merge": task_merge,
    "split": task_split,
    "extract_pages": task_extract_pages,
    "compress": task_compress,
    "rotate": task_rotate,
    "watermark": task_watermark,
    "protect": task_protect,
    "unlock": task_unlock,
    "pdf2img": task_pdf2img,
    "img2pdf": task_img2pdf,
    "office2pdf": task_office2pdf,
    "pdf2docx": task_pdf2docx,
    "ocr": task_ocr,
    "extract_text": task_extract_text,
    "thumbnail": task_thumbnail,
    "thumbnails": task_thumbnails,
    "page_thumbs": task_page_thumbs,
    "rearrange": task_rearrange,
    "doctor": task_doctor,
}


def main():
    try:
        # Read raw bytes: the default Windows locale codec would mangle
        # file paths containing characters outside cp1252.
        req = json.loads(sys.stdin.buffer.read().decode("utf-8"))
        task = req["task"]
        if task not in TASKS:
            raise ValueError(f"Task tidak dikenal: {task}")
        result = TASKS[task](req.get("params", {}))
        print(json.dumps({"ok": True, "result": result}))
    except Exception as e:  # noqa: BLE001 - single error boundary to JSON
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(0)


if __name__ == "__main__":
    main()
