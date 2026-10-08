"""Smart Intake pipeline: PDFs in, reviewed CSV plus organized copies out.

Local text extraction reuses the shipped engine (engine/pdf_engine.py) over
stdin/stdout JSON. The provider only ever sees extracted text, never files.

Flow per document: extract text (OCR fallback for scans), extract fields,
validate, human review, then CSV export plus organized copies.

Usage:
  python pipeline.py --in samples --out results                # mock, dry run
  python pipeline.py --in <dir> --out <dir> --provider gemini  # asks consent
  ... --yes --confirm-rename --delay 8                         # live + organize
"""

import argparse
import csv
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.normpath(os.path.join(HERE, "..", "..", "engine", "pdf_engine.py"))

sys.path.insert(0, HERE)
from provider import FIELDS, get_provider  # noqa: E402
from validate import validate  # noqa: E402


OCR_MIN_CHARS = 50  # below this, the PDF is probably a scan


def process_doc(provider, src, name, tmp, ocr_lang="eng"):
    """One document through extract, fields, validate. Never raises:
    provider failures become an error row so the batch continues."""
    t0 = time.perf_counter()
    usage = {}
    try:
        text = engine_text(src, tmp)
        if len(re.sub(r"\s+", "", text)) < OCR_MIN_CHARS:
            try:
                text = engine_ocr(src, tmp, ocr_lang)
                usage["ocr"] = True
            except Exception as e:  # noqa: BLE001 - keep nulls, flag it
                usage["ocr_error"] = str(e)[:200]
        rec, p_usage = provider.extract(text)
        usage.update(p_usage)
        flags = validate(rec)
        if "ocr_error" in usage:
            flags = flags + ["ocr_unavailable"]
    except Exception as e:  # noqa: BLE001 - batch must continue
        rec = {f: None for f in FIELDS}
        usage = {"error": str(e)[:200]}
        flags = ["provider_error"]
    ms = (time.perf_counter() - t0) * 1000
    return {"file": name, **rec,
            "flags": ";".join(flags),
            "latency_ms": round(ms, 1),
            "usage": json.dumps(usage)}


def engine_text(pdf_path, workdir):
    req = json.dumps({"task": "extract_text", "params": {
        "input": pdf_path,
        "output": os.path.join(workdir, "text.txt")}}).encode("utf-8")
    r = subprocess.run([sys.executable, ENGINE], input=req,
                       capture_output=True, timeout=120)
    lines = [l for l in r.stdout.decode("utf-8").splitlines() if l.strip()]
    res = json.loads(lines[-1])
    if not res.get("ok"):
        raise RuntimeError(f"local extraction failed: {res.get('error')}")
    with open(res["result"]["output"], encoding="utf-8") as f:
        return f.read()


def engine_ocr(pdf_path, workdir, lang):
    """OCR a scan via the engine, then read back its text. Raises with the
    engine's message when Tesseract/ocrmypdf is missing."""
    req = json.dumps({"task": "ocr", "params": {
        "input": pdf_path, "lang": lang,
        "output": os.path.join(workdir, "ocr.pdf")}}).encode("utf-8")
    r = subprocess.run([sys.executable, ENGINE], input=req,
                       capture_output=True, timeout=1800)
    lines = [l for l in r.stdout.decode("utf-8").splitlines() if l.strip()]
    res = json.loads(lines[-1])
    if not res.get("ok"):
        raise RuntimeError(res.get("error", "OCR failed"))
    return engine_text(res["result"]["output"], workdir)


def safe_name(s):
    s = re.sub(r"[^A-Za-z0-9._-]+", "_", s or "unknown")
    return s[:60].strip("_") or "unknown"


def unique_name(directory, filename):
    """Never overwrite: stem.pdf -> stem (2).pdf. Mirrors the engine."""
    path = os.path.join(directory, filename)
    if not os.path.exists(path):
        return path
    stem, ext = os.path.splitext(filename)
    i = 2
    while os.path.exists(os.path.join(directory, f"{stem} ({i}){ext}")):
        i += 1
    return os.path.join(directory, f"{stem} ({i}){ext}")


def parse_edit(raw, current):
    """Empty keeps, 'null' clears, numbers become floats, rest stays text."""
    s = raw.strip()
    if s == "":
        return current
    if s.lower() == "null":
        return None
    try:
        return float(s.replace(",", ""))
    except ValueError:
        return s


def review_records(rows, input_fn=input, auto=False):
    """Human review before export. Clean rows pass untouched; flagged rows
    ask accept/edit/skip per row. Returns (approved, skipped)."""
    approved, skipped = [], []
    for row in rows:
        flags = row["flags"].split(";") if row["flags"] else []
        if not flags or auto:
            row["status"] = "approved" if not flags else "auto_approved"
            approved.append(row)
            continue
        print(f"\n-- {row['file']} [{row['flags']}]")
        for f in FIELDS:
            print(f"   {f}: {row[f]}")
        while True:
            ans = input_fn("   accept / edit / skip? ").strip().lower()
            if ans in ("accept", "a", ""):
                row["status"] = "accepted"
                approved.append(row)
                break
            if ans in ("skip", "s"):
                row["status"] = "skipped"
                skipped.append(row)
                break
            if ans in ("edit", "e"):
                for f in FIELDS:
                    row[f] = parse_edit(
                        input_fn(f"   {f} [{row[f]}]: "), row[f])
                row["flags"] = ";".join(validate({f: row[f] for f in FIELDS}))
                row["status"] = "edited"
                approved.append(row)
                print(f"   revalidated: {row['flags'] or 'clean'}")
                break
            print("   answer accept, edit, or skip")
    return approved, skipped


def main():
    ap = argparse.ArgumentParser(description="MyPDF Smart Intake POC")
    ap.add_argument("--in", dest="indir", required=True)
    ap.add_argument("--out", dest="outdir", required=True)
    ap.add_argument("--provider", default="mock",
                    choices=["mock", "claude", "gemini"])
    ap.add_argument("--model", default=None)
    ap.add_argument("--yes", action="store_true",
                    help="skip the cloud consent prompt")
    ap.add_argument("--confirm-rename", action="store_true",
                    help="actually write organized copies (default: dry run)")
    ap.add_argument("--auto", action="store_true",
                    help="approve all rows without interactive review")
    ap.add_argument("--delay", type=float, default=0,
                    help="seconds to wait between cloud provider calls")
    ap.add_argument("--ocr-lang", default="eng",
                    help="Tesseract language for the scan fallback")
    a = ap.parse_args()

    pdfs = sorted(f for f in os.listdir(a.indir) if f.lower().endswith(".pdf"))
    if not pdfs:
        print("no PDFs found")
        return 1

    provider = get_provider(a.provider, model=a.model)
    if a.provider in ("claude", "gemini") and not a.yes:
        where = "the Anthropic API" if a.provider == "claude" else "the Google Gemini API"
        print(f"DISCLOSURE: the {a.provider} provider sends extracted document "
              f"text (not files) to {where} for classification "
              "and field extraction. Local PDF operations stay offline.")
        ans = input("Type YES to continue: ").strip()
        if ans != "YES":
            print("aborted")
            return 1

    os.makedirs(a.outdir, exist_ok=True)
    rows, total_ms = [], 0
    interactive = not a.auto and sys.stdin.isatty()
    with tempfile.TemporaryDirectory(prefix="smart_intake_") as tmp:
        for i, name in enumerate(pdfs):
            if a.delay and i > 0 and a.provider != "mock":
                time.sleep(a.delay)
            row = process_doc(provider, os.path.join(a.indir, name), name, tmp,
                              ocr_lang=a.ocr_lang)
            total_ms += row["latency_ms"]
            rows.append(row)
            flags = row["flags"].split(";") if row["flags"] else []
            n_flag = f" [{len(flags)} flags]" if flags else " [clean]"
            print(f"  {i + 1}/{len(pdfs)} {name}: "
                  f"{row['vendor']} {row['total']}{n_flag}")

    if interactive:
        print(f"\nReview {len([r for r in rows if r['flags']])} flagged "
              f"of {len(rows)} documents.")
    approved, skipped = review_records(
        rows, auto=not interactive)
    if skipped:
        print(f"skipped {len(skipped)}: "
              + ", ".join(r["file"] for r in skipped))

    review_path = os.path.join(a.outdir, "review.json")
    with open(review_path, "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=2, ensure_ascii=False)
    csv_path = os.path.join(a.outdir, "invoices.csv")
    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["file"] + FIELDS + ["flags"])
        w.writeheader()
        for r in approved:
            w.writerow({k: r[k] for k in w.fieldnames})
    print(f"wrote {review_path} and {csv_path} "
          f"({len(approved)} approved, {len(skipped)} skipped, "
          f"{round(total_ms)} ms total)")

    organize_copies(a.indir, approved, a.outdir, a.confirm_rename)
    return 0


def organize_copies(indir, approved, outdir, confirm):
    """Copy approved extractions to organized names. Failed extractions
    are never organized; collisions get (2), (3) suffixes. Originals stay
    untouched. Returns the list of written filenames."""
    planned = []
    for r in approved:
        if "provider_error" in (r["flags"].split(";") if r["flags"] else []):
            print(f"  not organizing failed extraction: {r['file']}")
            continue
        target = (f"{safe_name(r['vendor'])}_{r['invoice_date'] or 'nodate'}_"
                  f"{safe_name(str(r['total']))}.pdf")
        planned.append((r["file"], target))
    org = os.path.join(outdir, "organized")
    written = []
    if confirm:
        if planned:
            os.makedirs(org, exist_ok=True)
        for src_name, target in planned:
            dest = unique_name(org, target)
            shutil.copyfile(os.path.join(indir, src_name), dest)
            written.append(os.path.basename(dest))
        print(f"organized {len(written)} copies into {org} (originals untouched)")
    else:
        print("dry run: organized copies NOT written (use --confirm-rename):")
        for src_name, target in planned:
            print(f"  {src_name} -> {target}")
    return written


if __name__ == "__main__":
    sys.exit(main())
