"""Smart Intake pipeline: PDFs in, reviewed CSV plus organized copies out.

Local text extraction reuses the shipped engine (engine/pdf_engine.py) over
stdin/stdout JSON. The provider only ever sees extracted text, never files.

Usage:
  python pipeline.py --in samples --out results                # mock, dry run
  python pipeline.py --in <dir> --out <dir> --provider claude  # asks consent
  ... --yes --confirm-rename                                    # live + organize
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


def safe_name(s):
    s = re.sub(r"[^A-Za-z0-9._-]+", "_", s or "unknown")
    return s[:60].strip("_") or "unknown"


def main():
    ap = argparse.ArgumentParser(description="MyPDF Smart Intake POC")
    ap.add_argument("--in", dest="indir", required=True)
    ap.add_argument("--out", dest="outdir", required=True)
    ap.add_argument("--provider", default="mock", choices=["mock", "claude"])
    ap.add_argument("--model", default=None)
    ap.add_argument("--yes", action="store_true",
                    help="skip the cloud consent prompt")
    ap.add_argument("--confirm-rename", action="store_true",
                    help="actually write organized copies (default: dry run)")
    a = ap.parse_args()

    pdfs = sorted(f for f in os.listdir(a.indir) if f.lower().endswith(".pdf"))
    if not pdfs:
        print("no PDFs found")
        return 1

    provider = get_provider(a.provider, model=a.model)
    if a.provider == "claude" and not a.yes:
        print("DISCLOSURE: the Claude provider sends extracted document "
              "text (not files) to the Anthropic API for classification "
              "and field extraction. Local PDF operations stay offline.")
        ans = input("Type YES to continue: ").strip()
        if ans != "YES":
            print("aborted")
            return 1

    os.makedirs(a.outdir, exist_ok=True)
    rows, total_ms = [], 0
    with tempfile.TemporaryDirectory(prefix="smart_intake_") as tmp:
        for i, name in enumerate(pdfs):
            src = os.path.join(a.indir, name)
            t0 = time.perf_counter()
            text = engine_text(src, tmp)
            rec, usage = provider.extract(text)
            flags = validate(rec)
            ms = (time.perf_counter() - t0) * 1000
            total_ms += ms
            rows.append({"file": name, **rec,
                         "flags": ";".join(flags),
                         "latency_ms": round(ms, 1),
                         "usage": json.dumps(usage)})
            n_flag = f" [{len(flags)} flags]" if flags else " [clean]"
            print(f"  {i + 1}/{len(pdfs)} {name}: "
                  f"{rec['vendor']} {rec['total']}{n_flag}")

    review_path = os.path.join(a.outdir, "review.json")
    with open(review_path, "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=2, ensure_ascii=False)
    csv_path = os.path.join(a.outdir, "invoices.csv")
    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["file"] + FIELDS + ["flags"])
        w.writeheader()
        for r in rows:
            w.writerow({k: r[k] for k in w.fieldnames})
    print(f"wrote {review_path} and {csv_path} "
          f"({len(rows)} docs, {round(total_ms)} ms total)")

    planned = []
    for r in rows:
        target = (f"{safe_name(r['vendor'])}_{r['invoice_date'] or 'nodate'}_"
                  f"{safe_name(str(r['total']))}.pdf")
        planned.append((r["file"], target))
    org = os.path.join(a.outdir, "organized")
    if a.confirm_rename:
        os.makedirs(org, exist_ok=True)
        for src_name, target in planned:
            shutil.copyfile(os.path.join(a.indir, src_name),
                            os.path.join(org, target))
        print(f"organized {len(planned)} copies into {org} (originals untouched)")
    else:
        print("dry run: organized copies NOT written (use --confirm-rename):")
        for src_name, target in planned:
            print(f"  {src_name} -> {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
