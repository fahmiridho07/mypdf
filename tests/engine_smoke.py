"""Smoke test for engine/pdf_engine.py.

Needs only the core Python deps (pymupdf, pikepdf); external tools are not
required. Run from the repo root:

    python tests/engine_smoke.py
"""

import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINE = os.path.join(ROOT, "engine", "pdf_engine.py")

passed = 0
failed = []


def call(task, params):
    req = json.dumps({"task": task, "params": params}).encode("utf-8")
    r = subprocess.run([sys.executable, ENGINE], input=req,
                       capture_output=True, timeout=120)
    lines = [l for l in r.stdout.decode("utf-8").splitlines() if l.strip()]
    return json.loads(lines[-1])


def check(name, cond):
    global passed
    if cond:
        passed += 1
        print(f"  ok: {name}")
    else:
        failed.append(name)
        print(f"FAIL: {name}")


def make_pdf(path, pages=3):
    import fitz
    doc = fitz.open()
    for i in range(pages):
        doc.new_page().insert_text((72, 72), f"page {i + 1}", fontsize=24)
    doc.save(path)


def main():
    with tempfile.TemporaryDirectory(prefix="mypdf_test_") as tmp:
        a = os.path.join(tmp, "a.pdf")
        b = os.path.join(tmp, "b.pdf")
        make_pdf(a)
        make_pdf(b, pages=2)

        r = call("doctor", {})
        check("doctor responds", r["ok"] and r["result"]["fitz"])

        r = call("info", {"input": a})
        check("info page count", r["ok"] and r["result"]["pages"] == 3)

        merged = os.path.join(tmp, "merged.pdf")
        r = call("merge", {"inputs": [a, b], "output": merged})
        check("merge", r["ok"] and os.path.isfile(merged))
        check("merge page count", call("info", {"input": merged})["result"]["pages"] == 5)

        r2 = call("merge", {"inputs": [a, b], "output": merged})
        check("merge never overwrites", r2["ok"] and r2["result"]["output"] != merged)

        r = call("split", {"input": a, "output_dir": os.path.join(tmp, "split"),
                           "mode": "ranges", "ranges": ["1:2", "3"]})
        check("split ranges (colon syntax)", r["ok"] and len(r["result"]["outputs"]) == 2)

        r = call("extract_pages", {"input": merged, "pages": "1,3",
                                   "output": os.path.join(tmp, "picked.pdf")})
        check("extract pages", r["ok"] and r["result"]["pages"] == 2)

        r = call("rotate", {"input": a, "angle": 90,
                            "output": os.path.join(tmp, "rot.pdf")})
        check("rotate", r["ok"])

        r = call("watermark", {"input": a, "text": "TEST",
                               "output": os.path.join(tmp, "wm.pdf")})
        check("watermark", r["ok"])

        locked = os.path.join(tmp, "locked.pdf")
        r = call("protect", {"input": a, "password": "secret", "output": locked})
        check("protect", r["ok"])
        check("protected file needs password",
              call("info", {"input": locked})["result"]["encrypted"])

        r = call("unlock", {"input": locked, "password": "wrong",
                            "output": os.path.join(tmp, "u1.pdf")})
        check("unlock rejects wrong password", not r["ok"] and "password" in r["error"].lower())

        r = call("unlock", {"input": locked, "password": "secret",
                            "output": os.path.join(tmp, "u2.pdf")})
        check("unlock with right password", r["ok"])

        r = call("merge", {"inputs": [locked], "output": os.path.join(tmp, "x.pdf")})
        check("locked input gives friendly error",
              not r["ok"] and "password protected" in r["error"])

        r = call("pdf2img", {"input": b, "dpi": 72,
                             "output_dir": os.path.join(tmp, "imgs")})
        check("pdf2img", r["ok"] and len(r["result"]["outputs"]) == 2)

        img = r["result"]["outputs"][0]
        r = call("img2pdf", {"inputs": [img], "output": os.path.join(tmp, "fromimg.pdf")})
        check("img2pdf", r["ok"])

        r = call("extract_text", {"input": a, "output": os.path.join(tmp, "t.txt")})
        check("extract text", r["ok"] and r["result"]["chars"] > 0)

        r = call("thumbnail", {"input": a})
        check("thumbnail", r["ok"] and r["result"]["thumb"].startswith("data:image/png"))

        r = call("thumbnails", {"inputs": [a, b, locked]})
        check("batch thumbnails", r["ok"] and len(r["result"]) == 3)

        r = call("page_thumbs", {"input": a})
        check("page thumbs", r["ok"] and len(r["result"]["thumbs"]) == 3)

        r = call("rearrange", {"input": merged, "order": [4, 0, 2],
                               "rotations": {"0": 90},
                               "output": os.path.join(tmp, "arr.pdf")})
        check("rearrange", r["ok"] and r["result"]["pages"] == 3)

        r = call("compress", {"input": a, "output": os.path.join(tmp, "c.pdf")})
        check("compress (any engine)", r["ok"] and r["result"]["after"] > 0)

        # unicode paths survive the stdin round trip
        udir = os.path.join(tmp, "dokumen café 日本語")
        os.makedirs(udir)
        upath = os.path.join(udir, "tés.pdf")
        make_pdf(upath, pages=1)
        r = call("info", {"input": upath})
        check("unicode path", r["ok"] and r["result"]["pages"] == 1)

    print(f"\n{passed} passed, {len(failed)} failed")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
