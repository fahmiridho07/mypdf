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

        r = call("pdf2docx", {"input": a, "output": os.path.join(tmp, "a.docx")})
        try:
            import pdf2docx  # noqa: F401
            check("pdf to word", r["ok"] and os.path.isfile(r["result"]["output"]))
        except ImportError:
            check("pdf to word gives install hint when missing",
                  not r["ok"] and "pip install pdf2docx" in r["error"])

        # internal links (tables of contents) must survive rearrange and
        # extract, renumbered to the new page positions
        import fitz
        linked = os.path.join(tmp, "linked.pdf")
        doc = fitz.open()
        for i in range(3):
            doc.new_page().insert_text((72, 72), f"page {i + 1}", fontsize=20)
        doc[0].insert_link({"kind": fitz.LINK_GOTO, "page": 2,
                            "from": fitz.Rect(72, 100, 200, 120)})
        doc.set_toc([[1, "Chapter on page 3", 3]])
        doc.save(linked)
        doc.close()

        r = call("rearrange", {"input": linked, "order": [2, 0, 1],
                               "output": os.path.join(tmp, "linked_arr.pdf")})
        ok_link = False
        if r["ok"]:
            doc = fitz.open(r["result"]["output"])
            links = doc[1].get_links()  # old page 1 now sits at position 2
            ok_link = len(links) == 1 and links[0].get("page") == 0
            ok_link = ok_link and doc.get_toc() and doc.get_toc()[0][2] == 1
            doc.close()
        check("internal links and toc survive rearrange", bool(ok_link))

        r = call("merge", {"inputs": [linked, linked],
                           "output": os.path.join(tmp, "linked_merged.pdf")})
        ok_toc = False
        if r["ok"]:
            doc = fitz.open(r["result"]["output"])
            toc = doc.get_toc()
            ok_toc = len(toc) == 2 and toc[0][2] == 3 and toc[1][2] == 6
            doc.close()
        check("bookmarks survive merge with offsets", ok_toc)

        # signature widgets (e meterai style) must stay visible after
        # restructuring: their appearance is baked into the page content
        import pikepdf
        from pikepdf import Array, Dictionary, Name
        sig_src = os.path.join(tmp, "sig.pdf")
        make_pdf(sig_src, pages=2)
        pdf = pikepdf.open(sig_src, allow_overwriting_input=True)
        ap = pikepdf.Stream(pdf, b"q 0.9 0.2 0.2 rg 0 0 170 80 re f Q")
        ap[Name.Type] = Name.XObject
        ap[Name.Subtype] = Name.Form
        ap[Name.BBox] = Array([0, 0, 170, 80])
        sig = Dictionary(Type=Name.Annot, Subtype=Name.Widget, FT=Name.Sig,
                         T=pikepdf.String("sig1"), Rect=Array([350, 600, 520, 680]),
                         F=4, AP=Dictionary(N=ap))
        sig_i = pdf.make_indirect(sig)
        pdf.pages[0][Name.Annots] = pdf.make_indirect(Array([sig_i]))
        pdf.Root[Name.AcroForm] = pdf.make_indirect(
            Dictionary(Fields=Array([sig_i]), SigFlags=3))
        pdf.save(os.path.join(tmp, "sig2.pdf"))
        pdf.close()
        r = call("rearrange", {"input": os.path.join(tmp, "sig2.pdf"),
                               "order": [1, 0], "output": os.path.join(tmp, "sig_arr.pdf")})
        ok_flat = False
        if r["ok"]:
            import fitz
            doc = fitz.open(r["result"]["output"])
            pix = doc[1].get_pixmap(dpi=40)
            reds = sum(1 for y in range(pix.height) for x in range(pix.width)
                       if pix.pixel(x, y)[0] > 150 and pix.pixel(x, y)[1] < 100)
            ok_flat = reds > 50 and not any(True for pg in doc for _ in pg.widgets())
            doc.close()
        check("signature stamp baked into content", ok_flat)

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
