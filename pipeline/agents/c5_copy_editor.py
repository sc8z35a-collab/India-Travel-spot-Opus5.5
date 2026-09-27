"""Task — Copy Editor (owned by agent ⑤ Editorial Director).

LLM mode : sends each region's Japanese copy to the LLM with a strict rubric
           (for Japanese university students, landscape phone reading, no
           exaggeration, facts unchanged) and stores suggested rewrites +
           issues in reports/copy_review.json. Suggestions are NEVER applied
           silently — facts must stay human-verified.
Rule mode: deterministic lint (sentence length for a 2-column landscape
           layout, repeated sentence endings, half/full-width punctuation mix,
           risky absolute words) — always runs, so the report is never empty.
"""
from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor

from .. import llm
from .base import GEN, REPORTS, Agent, Report, load_json, save_json

ABSOLUTE = ["絶対", "必ず安全", "100%", "完全に安全", "誰でも", "最高の"]
RUBRIC = (
    "あなたは日本の大学生向け旅行メディアの編集長です。以下のJSONはインドの旅行先1地域の原稿です。"
    "横向きスマホ全画面で読まれる前提で、(1)事実は変えずに読みやすさを上げるための書き換え案を最大5件、"
    "(2)誇張・断定・安全面で誤解を招く表現の指摘、(3)大学生目線で不足している情報を、"
    "JSON {\"rewrites\":[{\"field\":...,\"before\":...,\"after\":...}],\"risks\":[...],\"missing\":[...]} のみで返してください。"
)


def lint(r: dict) -> list[str]:
    issues = []
    texts = [("lead", r["lead"]), ("catch", r["catch"])] + \
            [(f"highlights.{h['name']}", h["text"]) for h in r["highlights"]] + \
            [(f"scores.{k}", v["why"]) for k, v in r["scores"].items()]
    endings = {}
    for field, t in texts:
        for s in re.split(r"(?<=[。！？])", t):
            s = s.strip()
            if len(s) > 95:
                issues.append(f"{field}: 1文が{len(s)}字（横画面2カラムでは70字前後が読みやすい）")
            if len(s) > 4:
                endings[s[-3:]] = endings.get(s[-3:], 0) + 1
        if re.search(r"[,!?]", t) and re.search(r"[、。]", t):
            issues.append(f"{field}: 半角記号と全角句読点が混在")
        for w in ABSOLUTE:
            if w in t:
                issues.append(f"{field}: 断定表現「{w}」")
    for e, n in endings.items():
        if n >= 6:
            issues.append(f"文末「…{e}」が{n}回繰り返し")
    return issues


class CopyEditor(Agent):
    name = "c5_copy_editor"
    role = "原稿の編集レビュー（LLM編集長 ＋ ルールベース校正）"

    def run(self, report: Report) -> None:
        regions = load_json(GEN / "regions.json")
        out = {"mode": "rule", "regions": {}}
        for r in regions:
            out["regions"][r["id"]] = {"lint": lint(r)}
        if llm.available():
            out["mode"] = "llm+rule"

            def review(r):
                payload = {k: r[k] for k in ("name", "catch", "lead", "good_for", "not_for")}
                payload["highlights"] = [{"name": h["name"], "text": h["text"]} for h in r["highlights"]]
                try:
                    txt = llm.chat(RUBRIC, json.dumps(payload, ensure_ascii=False))
                    m = re.search(r"\{.*\}", txt, re.S)
                    return r["id"], json.loads(m.group(0)) if m else {"raw": txt}
                except Exception as e:  # noqa: BLE001
                    return r["id"], {"error": str(e)[:200]}

            with ThreadPoolExecutor(len(regions)) as pool:
                for rid, res in pool.map(review, regions):
                    out["regions"][rid]["llm"] = res
        else:
            report.warn(f"LLM unavailable → rule mode ({llm.probe()['reason'][:90]})")
        save_json(REPORTS / "copy_review.json", out)
        n = sum(len(v["lint"]) for v in out["regions"].values())
        report.stats = {"mode": out["mode"], "lint_findings": n}
