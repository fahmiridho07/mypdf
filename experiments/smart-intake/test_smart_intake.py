"""Tests for Smart Intake. Plain script, repo convention. Run from repo root:

    python experiments/smart-intake/test_smart_intake.py
"""

import csv
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from validate import validate  # noqa: E402
from provider import MockProvider, get_provider  # noqa: E402

passed = 0
failed = []


def check(name, cond):
    global passed
    if cond:
        passed += 1
        print(f"  ok: {name}")
    else:
        failed.append(name)
        print(f"FAIL: {name}")


def main():
    mock = MockProvider()

    rec, usage = mock.extract(
        "PT CONTOH MAJU JAYA\nNo. Invoice: INV/2026/001\nTanggal: 2026-09-02\n"
        "Subtotal: Rp 1.500.000\nPPN (11%): Rp 165.000\nTotal: Rp 1.665.000\n")
    check("mock parses IDR thousands", rec["subtotal"] == 1500000.0)
    check("mock parses total", rec["total"] == 1665000.0)
    check("mock date iso", rec["invoice_date"] == "2026-09-02")
    check("mock usage has latency, no tokens",
          usage["provider_ms"] >= 0 and usage["tokens"] is None)
    check("clean record validates", validate(rec) == [])

    rec2, _ = mock.extract(
        "Sample Parts Ltd\nInvoice No. S-2026-100\nDate: 15 Sep 2026\n"
        "Subtotal: $1,000.00\nTax: $100.00\nTotal: $1,150.00\n")
    flags = validate(rec2)
    check("bad math flagged", any(f.startswith("inconsistent_total") for f in flags))
    check("english date parsed", rec2["invoice_date"] == "2026-09-15")

    rec3, _ = mock.extract(
        "PT CONTOH NUSANTARA\nNo. Invoice: INV/2026/099\nTanggal: 2026-10-01\n"
        "Subtotal: Rp 500.000\nTotal: Rp 500.000\n")
    check("missing tax flagged", "missing:tax" in validate(rec3))
    check("uncertain fields are null, not invented", rec3["tax"] is None)

    check("empty record all missing",
          len(validate({f: None for f in
                        ["invoice_number", "vendor", "invoice_date", "currency",
                         "subtotal", "tax", "total"]})) == 7)

    try:
        get_provider("claude")
        check("claude without key raises", False)
    except RuntimeError as e:
        check("claude without key raises", "ANTHROPIC_API_KEY" in str(e))
    try:
        get_provider("watson")
        check("unknown provider rejected", False)
    except ValueError:
        check("unknown provider rejected", True)

    with tempfile.TemporaryDirectory(prefix="smart_intake_test_") as tmp:
        indir = os.path.join(HERE, "samples")
        outdir = os.path.join(tmp, "results")
        r = subprocess.run(
            [sys.executable, os.path.join(HERE, "pipeline.py"),
             "--in", indir, "--out", outdir],
            capture_output=True, text=True, timeout=300)
        check("pipeline exits 0", r.returncode == 0)
        with open(os.path.join(outdir, "invoices.csv"), encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        check("csv has 5 rows", len(rows) == 5)
        by_file = {x["file"]: x for x in rows}
        check("clean invoice has no flags", by_file["inv-01-sederhana.pdf"]["flags"] == "")
        check("missing tax surfaced in csv",
              "missing:tax" in by_file["inv-04-missing-tax.pdf"]["flags"])
        check("bad math surfaced in csv",
              "inconsistent_total" in by_file["inv-05-bad-math.pdf"]["flags"])
        check("originals untouched (no organized dir on dry run)",
              not os.path.exists(os.path.join(outdir, "organized")))
        check("review json written", os.path.isfile(os.path.join(outdir, "review.json")))

        r = subprocess.run(
            [sys.executable, os.path.join(HERE, "pipeline.py"),
             "--in", indir, "--out", outdir, "--confirm-rename"],
            capture_output=True, text=True, timeout=300)
        org = os.path.join(outdir, "organized")
        check("confirm rename writes copies",
              r.returncode == 0 and len(os.listdir(org)) == 5)
        check("original names preserved in samples",
              len(os.listdir(indir)) == 5)

    print(f"\n{passed} passed, {len(failed)} failed")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
