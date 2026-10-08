"""Generate 5 synthetic invoices (clearly fake) for the Smart Intake POC."""

import os

import fitz

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "samples")

DOCS = [
    ("inv-01-sederhana.pdf",
     ["PT CONTOH MAJU JAYA",
      "No. Invoice: INV/2026/001",
      "Tanggal: 2026-09-02",
      "Subtotal: Rp 1.500.000",
      "PPN (11%): Rp 165.000",
      "Total: Rp 1.665.000"]),
    ("inv-02-english.pdf",
     ["Sample Supplies Co.",
      "Invoice No. S-2026-042",
      "Date: 12 Sep 2026",
      "Subtotal: $2,400.00",
      "Tax (10%): $240.00",
      "Total: $2,640.00"]),
    ("inv-03-minimal.pdf",
     ["TOKO CONTOH BAROKAH",
      "No. Nota: NB-077",
      "Tgl: 2026-08-21",
      "Subtotal Rp 750.000",
      "Pajak Rp 75.000",
      "Total Rp 825.000"]),
    ("inv-04-missing-tax.pdf",
     ["PT CONTOH NUSANTARA",
      "No. Invoice: INV/2026/099",
      "Tanggal: 2026-10-01",
      "Subtotal: Rp 500.000",
      "Total: Rp 500.000"]),
    ("inv-05-bad-math.pdf",
     ["Sample Parts Ltd",
      "Invoice No. S-2026-100",
      "Date: 15 Sep 2026",
      "Subtotal: $1,000.00",
      "Tax: $100.00",
      "Total: $1,150.00"]),
]


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, lines in DOCS:
        doc = fitz.open()
        page = doc.new_page()
        y = 72
        for line in lines:
            page.insert_text((72, y), line, fontsize=14)
            y += 28
        page.insert_text((72, y + 20), "CONTOH / SAMPLE DOCUMENT", fontsize=10)
        doc.save(os.path.join(OUT, name))
        doc.close()
    make_scan_sample()
    print(f"wrote {len(DOCS) + 1} synthetic invoices to {OUT}")


def make_scan_sample():
    """Image only twin of inv-01: no text layer, forces the OCR fallback.
    Rendered through fitz itself so glyphs stay OCR legible."""
    doc = fitz.open()
    page = doc.new_page(width=900, height=500)
    y = 80
    for line in DOCS[0][1]:
        page.insert_text((60, y), line, fontsize=28)
        y += 60
    png = os.path.join(OUT, "_scan_tmp.png")
    page.get_pixmap(dpi=200).save(png)
    scan = fitz.open()
    spage = scan.new_page(width=900, height=500)
    spage.insert_image(spage.rect, filename=png)
    scan.save(os.path.join(OUT, "inv-06-scan.pdf"))
    scan.close()
    doc.close()
    os.remove(png)


if __name__ == "__main__":
    main()
