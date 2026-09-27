"""LLM brain shared by the 6 crew agents.

Uses the OpenAI-compatible endpoint injected into the sandbox
(OPENAI_API_KEY / OPENAI_BASE_URL or ~/.genspark_llm.yaml). Never hard-codes
keys. `probe()` performs a real 6-way parallel round-trip and classifies the
result; if the proxy is unavailable (no credits, network, 4xx) every agent
transparently falls back to its deterministic rule-based mode, and the
reason is written to reports/llm_status.json so the build never lies about
what actually ran.
"""
from __future__ import annotations

import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

MODEL = os.environ.get("CREW_MODEL", "gpt-5-mini")
_FAIL_MARKERS = ("Free-plan credits", "subscribe or purchase credits", "credit_exhausted", "Unauthorized")
_state: dict = {"checked": False, "ok": False, "reason": "not probed"}


def _client():
    from openai import OpenAI  # imported lazily: optional dependency

    key, base = os.environ.get("OPENAI_API_KEY"), os.environ.get("OPENAI_BASE_URL")
    cfg = Path.home() / ".genspark_llm.yaml"
    if (not key or not base) and cfg.exists():
        import yaml

        c = (yaml.safe_load(cfg.read_text()) or {}).get("openai", {})
        key, base = key or c.get("api_key"), base or c.get("base_url")
    if not key:
        raise RuntimeError("no LLM API key configured")
    return OpenAI(api_key=key, base_url=base, timeout=120, max_retries=1)


def chat(system: str, user: str, *, model: str | None = None) -> str:
    """One completion. Raises RuntimeError with a clear reason on any failure,
    including proxies that answer HTTP 200 with a billing message as content."""
    r = _client().chat.completions.create(model=model or MODEL,
                                          messages=[{"role": "system", "content": system},
                                                    {"role": "user", "content": user}])
    text = (r.choices[0].message.content or "").strip()
    usage = getattr(r, "usage", None)
    if any(m in text for m in _FAIL_MARKERS) or (usage is not None and usage.total_tokens == 0):
        raise RuntimeError(f"LLM proxy refused: {text[:160]}")
    return text


def probe(n: int = 6) -> dict:
    """Fire n requests concurrently (one per crew agent) and record the result."""
    if _state["checked"]:
        return _state
    t0 = time.time()

    def one(i):
        try:
            return {"agent": i + 1, "ok": True, "reply": chat("You are build agent #%d." % (i + 1),
                                                              "Reply with exactly: READY")[:40]}
        except Exception as e:  # noqa: BLE001
            return {"agent": i + 1, "ok": False, "error": f"{type(e).__name__}: {str(e)[:200]}"}

    try:
        with ThreadPoolExecutor(n) as pool:
            results = list(pool.map(one, range(n)))
    except Exception as e:  # noqa: BLE001
        results = [{"agent": 0, "ok": False, "error": str(e)}]
    ok = all(r["ok"] for r in results)
    _state.update(checked=True, ok=ok, model=MODEL, parallel=n, latency_s=round(time.time() - t0, 2),
                  results=results, reason="ok" if ok else (results[0].get("error") or "failed"),
                  checked_at=time.strftime("%F %T"))
    from .agents.base import REPORTS

    (REPORTS / "llm_status.json").write_text(json.dumps(_state, ensure_ascii=False, indent=2), encoding="utf-8")
    return _state


def available() -> bool:
    return probe()["ok"]
