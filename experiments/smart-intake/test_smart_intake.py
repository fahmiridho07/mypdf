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
        get_provider("gemini")
        check("gemini without key raises", False)
    except RuntimeError as e:
        check("gemini without key raises", "GEMINI_API_KEY" in str(e))

    import shutil
    import tempfile as _tf
    from pipeline import process_doc, review_records, unique_name  # noqa: E402

    class _Boom:
        def extract(self, text):
            raise RuntimeError("API call failed after 2 tries (HTTP 503)")

    with _tf.TemporaryDirectory(prefix="smart_intake_boom_") as tmp:
        row = process_doc(_Boom(), os.path.join(HERE, "samples", "inv-01-sederhana.pdf"),
                          "inv-01-sederhana.pdf", tmp)
    check("provider failure becomes error row, batch continues",
          row["flags"] == "provider_error" and row["vendor"] is None)
    try:
        get_provider("watson")
        check("unknown provider rejected", False)
    except ValueError:
        check("unknown provider rejected", True)

    with _tf.TemporaryDirectory(prefix="smart_intake_uniq_") as tmp:
        check("unique name keeps first",
              unique_name(tmp, "b.pdf").endswith("b.pdf"))
        open(os.path.join(tmp, "a.pdf"), "w").close()
        check("unique name never overwrites",
              unique_name(tmp, "a.pdf").endswith("a (2).pdf"))

    def scripted(answers):
        it = iter(answers)
        return lambda prompt="": next(it)

    flagged = {"file": "inv-05-bad-math.pdf", "invoice_number": "S-2026-100",
               "vendor": "Sample Parts Ltd", "invoice_date": "2026-09-15",
               "currency": "USD", "subtotal": 1000.0, "tax": 100.0,
               "total": 1150.0,
               "flags": "inconsistent_total:subtotal(1000.0)+tax(100.0)=1100.0!=total(1150.0)",
               "latency_ms": 1.0, "usage": "{}"}
    import copy
    approved, skipped = review_records(
        [copy.deepcopy(flagged)],
        input_fn=scripted(["e", "", "", "", "", "", "", "1100"]))
    check("review correction fixes total",
          approved[0]["total"] == 1100.0 and approved[0]["flags"] == ""
          and approved[0]["status"] == "edited" and not skipped)
    approved, skipped = review_records(
        [copy.deepcopy(flagged)], input_fn=scripted(["s"]))
    check("review skip excludes from export",
          not approved and len(skipped) == 1
          and skipped[0]["status"] == "skipped")
    approved, skipped = review_records(
        [copy.deepcopy(flagged)], input_fn=scripted(["accept"]))
    check("review accept keeps flags for the record",
          approved[0]["flags"].startswith("inconsistent_total"))

    with tempfile.TemporaryDirectory(prefix="smart_intake_test_") as tmp:
        indir = os.path.join(tmp, "in")
        os.makedirs(indir)
        for n in ["inv-01-sederhana.pdf", "inv-02-english.pdf",
                  "inv-03-minimal.pdf", "inv-04-missing-tax.pdf",
                  "inv-05-bad-math.pdf"]:
            shutil.copy(os.path.join(HERE, "samples", n), indir)
        outdir = os.path.join(tmp, "results")
        r = subprocess.run(
            [sys.executable, os.path.join(HERE, "pipeline.py"),
             "--in", indir, "--out", outdir, "--auto"],
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

        dupdir = os.path.join(tmp, "dups")
        os.makedirs(dupdir)
        shutil.copy(os.path.join(HERE, "samples", "inv-03-minimal.pdf"),
                    os.path.join(dupdir, "first.pdf"))
        shutil.copy(os.path.join(HERE, "samples", "inv-03-minimal.pdf"),
                    os.path.join(dupdir, "second.pdf"))
        r = subprocess.run(
            [sys.executable, os.path.join(HERE, "pipeline.py"),
             "--in", dupdir, "--out", os.path.join(tmp, "dupout"),
             "--auto", "--confirm-rename"],
            capture_output=True, text=True, timeout=300)
        got = sorted(os.listdir(os.path.join(tmp, "dupout", "organized")))
        check("duplicate names never collide",
              r.returncode == 0 and len(got) == 2 and got[0] != got[1]
              and any("(2)" in g for g in got))

    from pipeline import organize_copies  # noqa: E402
    with _tf.TemporaryDirectory(prefix="smart_intake_org_") as tmp:
        boomdir = os.path.join(tmp, "boom")
        os.makedirs(boomdir)
        shutil.copy(os.path.join(HERE, "samples", "inv-01-sederhana.pdf"),
                    os.path.join(boomdir, "x.pdf"))
        err_row = {"file": "x.pdf", "invoice_number": None, "vendor": None,
                   "invoice_date": None, "currency": None, "subtotal": None,
                   "tax": None, "total": None, "flags": "provider_error"}
        written = organize_copies(boomdir, [err_row], tmp, confirm=True)
        check("failed extraction never organized",
              written == [] and not os.path.exists(os.path.join(tmp, "organized")))

    with _tf.TemporaryDirectory(prefix="smart_intake_scan_") as tmp:
        row = process_doc(mock, os.path.join(HERE, "samples", "inv-06-scan.pdf"),
                          "inv-06-scan.pdf", tmp)
        use = json.loads(row["usage"])
        check("scan engages the OCR fallback",
              use.get("ocr") is True or "ocr_error" in use)
        recovered = row["vendor"] == "PT CONTOH MAJU JAYA"
        unavailable = "ocr_unavailable" in row["flags"].split(";") or row["vendor"] is None
        check("scan recovers text or says OCR is missing",
              recovered or unavailable)

    print(f"\n{passed} passed, {len(failed)} failed")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
