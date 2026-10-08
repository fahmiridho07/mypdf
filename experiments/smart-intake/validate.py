"""Validation engine for Smart Intake records. Pure functions, no I/O."""

REQUIRED = ["invoice_number", "vendor", "invoice_date", "currency",
            "subtotal", "tax", "total"]


def _is_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def validate(rec):
    """Return a list of flag strings. Empty means clean."""
    flags = []
    for f in REQUIRED:
        if rec.get(f) is None:
            flags.append(f"missing:{f}")
    sub, tax, tot = rec.get("subtotal"), rec.get("tax"), rec.get("total")
    if _is_number(sub) and _is_number(tax) and _is_number(tot):
        if abs((sub + tax) - tot) > 0.01:
            flags.append(
                f"inconsistent_total:subtotal({sub})+tax({tax})={sub + tax}!=total({tot})")
    for f in ("subtotal", "tax", "total"):
        v = rec.get(f)
        if v is not None and not _is_number(v):
            flags.append(f"bad_type:{f}")
        elif _is_number(v) and v < 0:
            flags.append(f"negative:{f}")
    date = rec.get("invoice_date")
    if date is not None:
        import re
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(date)):
            flags.append("bad_date_format")
    return flags
