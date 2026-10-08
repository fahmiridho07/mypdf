"""Provider abstraction for Smart Intake field extraction.

Two implementations: a local regex based mock (default, offline) and a
Claude API provider (opt in, sends document text to Anthropic). The mock
is deliberately narrow: it proves the pipeline, not AI quality.
"""

import json
import os
import re
import time
import urllib.request

FIELDS = ["invoice_number", "vendor", "invoice_date", "currency",
          "subtotal", "tax", "total"]


class ExtractionProvider:
    name = "base"

    def extract(self, text):
        """Return (record dict with FIELDS keys, usage dict or None)."""
        raise NotImplementedError


def blank_record():
    return {f: None for f in FIELDS}


# ------------------------------------------------------------------ mock

MONTHS = {"jan": "01", "feb": "02", "mar": "03", "apr": "04",
          "mei": "05", "may": "05", "jun": "06", "jul": "07",
          "agu": "08", "aug": "08", "sep": "09", "okt": "10",
          "oct": "10", "nov": "11", "des": "12", "dec": "12"}


def _parse_money(raw, currency):
    """'Rp 1.500.000' -> 1500000.0, '$2,400.00' -> 2400.0.

    Narrow by design: dots are thousand separators for IDR/Rp, US style
    otherwise. A real model handles the general case; this mock does not.
    """
    s = raw.strip().replace("Rp", "").replace("IDR", "").replace("$", "")
    s = s.replace("USD", "").strip()
    if currency in ("IDR", "Rp") or "." in s and "," not in s and len(s.split(".")[-1]) == 3:
        s = s.replace(".", "").replace(",", ".")
    else:
        s = s.replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None


def _parse_date(text):
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", text)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = re.search(r"(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})", text)
    if m:
        mon = MONTHS.get(m.group(2).lower()[:3])
        if mon:
            return f"{m.group(3)}-{mon}-{int(m.group(1)):02d}"
    return None


class MockProvider(ExtractionProvider):
    """Local regex extractor for the synthetic sample formats."""
    name = "mock"

    def extract(self, text):
        t0 = time.perf_counter()
        rec = blank_record()
        m = re.search(r"(?:No\.?\s*(?:Invoice|Nota)?|Invoice No\.?)\s*:?\s*([A-Za-z0-9/\-]+)", text, re.I)
        if m:
            rec["invoice_number"] = m.group(1).strip(" .")
        m = re.search(r"(?:Vendor|From)\s*:?\s*(.+)", text, re.I)
        if m:
            rec["vendor"] = m.group(1).strip()
        else:
            skip = re.compile(
                r"invoice|nota|tanggal|date|tgl|subtotal|total|pajak|ppn|tax|"
                r"contoh\s*/\s*sample|^\s*[\d.,Rp$ ]+$", re.I)
            for ln in text.splitlines():
                s = ln.strip()
                if s and not skip.search(s):
                    rec["vendor"] = s
                    break
        rec["invoice_date"] = _parse_date(text)
        if re.search(r"\bRp\b|IDR", text):
            rec["currency"] = "IDR"
        elif re.search(r"\$|USD", text):
            rec["currency"] = "USD"

        def money(label):
            m = re.search(r"\b" + label + r"(?:\s*\(.*?\))?\s*:?\s*((?:Rp|IDR|USD|\$)?\s*[\d.,]+)", text, re.I)
            if m:
                return _parse_money(m.group(1), rec["currency"])
            return None

        rec["subtotal"] = money(r"Subtotal")
        rec["tax"] = money(r"(?:Tax|PPN|Pajak)")
        rec["total"] = money(r"Total")
        dt = (time.perf_counter() - t0) * 1000
        return rec, {"provider_ms": round(dt, 1), "tokens": None}


# ----------------------------------------------------------------- Claude

PROMPT = (
    "Extract these invoice fields as a single JSON object with exactly "
    "these keys: invoice_number, vendor, invoice_date, currency, subtotal, "
    "tax, total. Rules: use null for any field you cannot find or are "
    "unsure about, never invent values; numbers as plain numbers without "
    "thousand separators; invoice_date as YYYY-MM-DD or null; currency as "
    "a 3 letter code or null. Reply with JSON only, no commentary."
)


class ClaudeProvider(ExtractionProvider):
    """Real Claude API integration. Key comes from ANTHROPIC_API_KEY only,
    never from files, flags, or the app bundle. Untested without a key."""
    name = "claude"

    def __init__(self, model=None):
        key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not key:
            raise RuntimeError("ANTHROPIC_API_KEY is not set.")
        model = model or os.environ.get("CLAUDE_MODEL", "")
        if not model:
            raise RuntimeError(
                "Set CLAUDE_MODEL to a current model id from the Claude docs.")
        self._key = key
        self._model = model

    def extract(self, text):
        t0 = time.perf_counter()
        body = json.dumps({
            "model": self._model,
            "max_tokens": 1024,
            "system": PROMPT,
            "messages": [{"role": "user",
                          "content": [{"type": "text",
                                       "text": text[:12000]}]}],
        }).encode("utf-8")
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages", data=body,
            headers={"x-api-key": self._key,
                     "anthropic-version": "2023-06-01",
                     "content-type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                payload = json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001 - surface as pipeline error
            raise RuntimeError(f"Claude API call failed: {type(e).__name__}")
        content = "".join(b.get("text", "") for b in payload.get("content", [])
                          if b.get("type") == "text")
        content = re.sub(r"^```(?:json)?|```$", "", content.strip())
        try:
            data = json.loads(content)
        except ValueError:
            raise RuntimeError("Claude reply was not valid JSON.")
        rec = blank_record()
        for f in FIELDS:
            v = data.get(f)
            rec[f] = v if v in (None,) or isinstance(v, (str, float, int)) else None
        use = payload.get("usage", {}) or {}
        dt = (time.perf_counter() - t0) * 1000
        return rec, {"provider_ms": round(dt, 1),
                     "input_tokens": use.get("input_tokens"),
                     "output_tokens": use.get("output_tokens"),
                     "model": self._model}


def get_provider(name, model=None):
    if name == "mock":
        return MockProvider()
    if name == "claude":
        return ClaudeProvider(model=model)
    if name == "gemini":
        return GeminiProvider(model=model)
    raise ValueError(f"Unknown provider: {name}")


def _post_json(url, body, timeout=120, tries=2):
    """POST with limited retry. Default 2 tries: free tiers quota wall
    fast, and extra retries only burn quota. Honors Retry-After on 429."""
    import time as _time
    import urllib.error
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(
                url, data=body, headers={"content-type": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:300]
            last = f"HTTP {e.code}: {detail}"
            if e.code < 500 and e.code != 429:
                break
            if e.code == 429:
                # Honor the server's backoff ask instead of hammering quota.
                wait = 30
                retry_after = e.headers.get("Retry-After")
                if retry_after:
                    try:
                        wait = min(120, int(retry_after) + 1)
                    except ValueError:
                        pass
                _time.sleep(wait)
                continue
        except Exception as e:  # noqa: BLE001 - timeouts, resets
            last = type(e).__name__
        _time.sleep(2 ** attempt)
    raise RuntimeError(f"API call failed after {tries} tries ({last})")


class GeminiProvider(ExtractionProvider):
    """Google Gemini API integration. Key comes from GEMINI_API_KEY only,
    never from files, flags, or the app bundle."""
    name = "gemini"

    def __init__(self, model=None):
        key = os.environ.get("GEMINI_API_KEY", "")
        if not key:
            raise RuntimeError("GEMINI_API_KEY is not set.")
        model = model or os.environ.get("GEMINI_MODEL", "")
        if not model:
            raise RuntimeError(
                "Set GEMINI_MODEL to a current model id from the Gemini docs.")
        self._key = key
        self._model = model

    def extract(self, text):
        import urllib.parse
        t0 = time.perf_counter()
        body = json.dumps({
            "system_instruction": {"parts": [{"text": PROMPT}]},
            "contents": [{"parts": [{"text": text[:12000]}]}],
            "generationConfig": {"responseMimeType": "application/json",
                                 "maxOutputTokens": 1024},
        }).encode("utf-8")
        url = ("https://generativelanguage.googleapis.com/v1beta/models/"
               f"{urllib.parse.quote(self._model, safe='')}:generateContent"
               f"?key={urllib.parse.quote(self._key, safe='')}")
        try:
            payload = _post_json(url, body)
        except Exception as e:  # noqa: BLE001 - surface as pipeline error
            raise RuntimeError(f"Gemini API call failed: {e}")
        try:
            content = payload["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError):
            raise RuntimeError("Gemini reply had no text content.")
        content = re.sub(r"^```(?:json)?|```$", "", content.strip())
        try:
            data = json.loads(content)
        except ValueError:
            raise RuntimeError("Gemini reply was not valid JSON.")
        rec = blank_record()
        for f in FIELDS:
            v = data.get(f)
            rec[f] = v if v in (None,) or isinstance(v, (str, float, int)) else None
        use = payload.get("usageMetadata", {}) or {}
        dt = (time.perf_counter() - t0) * 1000
        return rec, {"provider_ms": round(dt, 1),
                     "input_tokens": use.get("promptTokenCount"),
                     "output_tokens": use.get("candidatesTokenCount"),
                     "model": self._model}
