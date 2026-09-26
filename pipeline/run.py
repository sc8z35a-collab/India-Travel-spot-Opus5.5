#!/usr/bin/env python3
"""6-agent build crew — DAG orchestrator.

Six specialised agents run *concurrently* (one worker thread each). Every
agent owns a queue of tasks; a task starts the moment all of its
dependencies are done, regardless of which agent owns them, so independent
work (depth inference, terrain sculpting, analysis, charts, OG cards, copy
review) overlaps instead of running in fixed waves.

  ① ASSET & DEPTH   a1 photo curator → a1b depth mapper (Depth Anything V2)
  ② WORLD BUILDER   a4 cartographer → a4b terrain sculptor (real elevation)
  ③ DATA SCIENTIST  a2 content validator → a3 score analyst (Monte-Carlo)
  ④ VISUAL DESIGN   a5 chart designer ∥ a7 OG designer
  ⑤ EDITORIAL/SITE  c5 copy editor (LLM) → a6 site builder
  ⑥ QA LEAD         a8 static audit ∥ a9 landscape-phone WebGL QA → c6 design critic (LLM)

Before starting, the crew probes the LLM proxy with 6 parallel requests
(one per agent). LLM-capable tasks use it when available and otherwise fall
back to deterministic rules; the outcome is recorded in reports/.

    python3 -m pipeline.run                 # full build
    python3 -m pipeline.run --skip-assets   # reuse downloaded/processed photos
    python3 -m pipeline.run --only a6,a9    # run selected tasks only
    python3 -m pipeline.run --commit        # commit + push when the build is green
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

from . import llm
from .agents.a1_asset_curator import AssetCurator
from .agents.a1b_depth_mapper import DepthMapper
from .agents.a2_content_validator import ContentValidator
from .agents.a3_score_analyst import ScoreAnalyst
from .agents.a4_cartographer import Cartographer
from .agents.a4b_terrain_sculptor import TerrainSculptor
from .agents.a5_chart_designer import ChartDesigner
from .agents.a6_site_builder import SiteBuilder
from .agents.a7_og_designer import OgDesigner
from .agents.a8_qa_auditor import QaAuditor
from .agents.a9_mobile_qa import MobileQa
from .agents.base import REPORTS, ROOT, save_json
from .agents.c5_copy_editor import CopyEditor
from .agents.c6_design_critic import DesignCritic

CREW = {
    "①": ("ASSET & DEPTH", "実写真の取得・最適化と深度推定"),
    "②": ("WORLD BUILDER", "地図と3D地形の生成"),
    "③": ("DATA SCIENTIST", "データ検証と多元評価"),
    "④": ("VISUAL DESIGN", "チャート・OGPのデザイン"),
    "⑤": ("EDITORIAL & SITE", "原稿レビューとサイト生成"),
    "⑥": ("QA LEAD", "横画面スマホ実機相当QAとデザイン講評"),
}
# task key → (agent, class, dependencies)
TASKS = {
    "a1": ("①", AssetCurator, []),
    "a2": ("③", ContentValidator, ["a1"]),
    "a1b": ("①", DepthMapper, ["a1", "a2"]),
    "a4": ("②", Cartographer, ["a2"]),
    "a4b": ("②", TerrainSculptor, ["a4"]),
    "a3": ("③", ScoreAnalyst, ["a2"]),
    "a5": ("④", ChartDesigner, ["a3"]),
    "a7": ("④", OgDesigner, ["a2"]),
    "c5": ("⑤", CopyEditor, ["a2"]),
    "a6": ("⑤", SiteBuilder, ["a1b", "a3", "a4", "a4b", "a5", "a7"]),
    "a8": ("⑥", QaAuditor, ["a6"]),
    "a9": ("⑥", MobileQa, ["a6"]),
    "c6": ("⑥", DesignCritic, ["a9", "a8", "c5"]),
}


# memory-heavy tasks (neural net / big rasters / headless browser) never overlap each other;
# light tasks keep running alongside them. The cap adapts to the machine's RAM.
HEAVY = {"a1", "a1b", "a4b", "a9"}


def _mem_gb() -> float:
    try:
        lim = open("/sys/fs/cgroup/memory.max").read().strip()
        if lim.isdigit():
            return int(lim) / 2**30
    except OSError:
        pass
    try:
        return int(open("/proc/meminfo").read().split()[1]) / 2**20
    except Exception:  # noqa: BLE001
        return 1.0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-assets", action="store_true")
    ap.add_argument("--only", default="")
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--no-llm", action="store_true")
    args = ap.parse_args()
    only = {x.strip() for x in args.only.split(",") if x.strip()}
    selected = {k for k in TASKS if (not only or k in only) and not (args.skip_assets and k == "a1")}

    t0 = time.time()
    print("━" * 70 + "\n INDIA — 5 JOURNEYS  ·  6-agent build crew (DAG, concurrent)\n" + "━" * 70)
    for k, (n, d) in CREW.items():
        print(f"  {k} {n:17s} {d}  ← " + ", ".join(t for t, v in TASKS.items() if v[0] == k and t in selected))

    if args.no_llm:
        llm._state.update(checked=True, ok=False, reason="disabled by --no-llm")
    else:
        st = llm.probe(6)
        print(f"\n  LLM probe (6 parallel requests, model={llm.MODEL}): "
              + ("✅ online" if st["ok"] else f"⚠ offline → rule mode · {st['reason'][:110]}"))

    done, failed, reports, timeline = set(), set(), [], []
    lock = threading.Lock()
    pending = {k for k in selected}
    order_hint = list(TASKS)
    # tasks not selected count as already satisfied (their outputs exist on disk)
    satisfied = lambda k: k in done or k not in selected  # noqa: E731

    def run_task(key):
        agent, cls, _ = TASKS[key]
        start = time.time() - t0
        if key in HEAVY and heavy_cap == 1:
            # isolated process → its memory is fully released afterwards
            subprocess.run([sys.executable, "-m", "pipeline.task", key], cwd=ROOT)
            from .agents.base import Report, load_json as _lj
            d = _lj(REPORTS / f"{cls.name}.json")
            rep = Report(agent=d["agent"], role=d["role"])
            rep.__dict__.update(d)
        else:
            rep = cls().execute()
        with lock:
            timeline.append({"task": key, "agent": agent, "start": round(start, 2),
                             "end": round(time.time() - t0, 2), "ok": rep.ok})
        return key, rep

    heavy_cap = 1 if _mem_gb() < 6 else 2 if _mem_gb() < 14 else 4
    print(f"  memory {_mem_gb():.1f} GB → up to {heavy_cap} heavy task(s) at once")
    with ThreadPoolExecutor(max_workers=6, thread_name_prefix="agent") as pool:
        running = {}
        while pending or running:
            for k in sorted(pending, key=lambda t: order_hint.index(t)):
                deps = TASKS[k][2]
                if any(d in failed for d in deps):
                    pending.discard(k); failed.add(k)
                    print(f"  ⤫ {k} skipped (dependency failed)")
                elif all(satisfied(d) for d in deps) and not (
                        k in HEAVY and sum(v in HEAVY for v in running.values()) >= heavy_cap):
                    pending.discard(k)
                    running[pool.submit(run_task, k)] = k
            if not running:
                break
            fin, _ = wait(list(running), return_when=FIRST_COMPLETED)
            for f in fin:
                running.pop(f)
                key, rep = f.result()
                reports.append((key, rep))
                (done if rep.ok else failed).add(key)

    ok = not failed
    order = list(TASKS)
    reports.sort(key=lambda kr: order.index(kr[0]))
    summary = {
        "ok": ok, "duration_s": round(time.time() - t0, 1),
        "llm": {k: llm._state.get(k) for k in ("ok", "model", "parallel", "reason", "latency_s")},
        "crew": {k: {"name": n, "desc": d} for k, (n, d) in CREW.items()},
        "timeline": sorted(timeline, key=lambda t: t["start"]),
        "agents": [{"task": k, "agent": TASKS[k][0], "name": r.agent, "role": r.role, "ok": r.ok,
                    "duration_s": r.duration_s, "warnings": len(r.warnings), "errors": len(r.errors),
                    "stats": r.stats} for k, r in reports],
    }
    save_json(REPORTS / "summary.json", summary)
    L = ["# Build summary — 6-agent crew", "", f"- status: {'✅ OK' if ok else '❌ FAILED'}",
         f"- wall time: {summary['duration_s']}s (tasks overlap across 6 concurrent agents)",
         f"- LLM: {'online' if llm._state.get('ok') else 'offline → rule mode'} — {str(llm._state.get('reason'))[:140]}",
         "", "| agent | task | role | ok | start→end | warn | err |", "|---|---|---|---|---|---|---|"]
    tl = {t["task"]: t for t in timeline}
    L += [f"| {TASKS[k][0]} {CREW[TASKS[k][0]][0]} | {r.agent} | {r.role} | {'✅' if r.ok else '❌'} | "
          f"{tl[k]['start']}s→{tl[k]['end']}s | {len(r.warnings)} | {len(r.errors)} |" for k, r in reports]
    (REPORTS / "summary.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    print("\n" + "━" * 70 + f"\n {'✅ BUILD OK' if ok else '❌ BUILD FAILED'}  in {summary['duration_s']}s"
          + (f"  failed: {sorted(failed)}" if failed else "") + "\n" + "━" * 70)

    if args.commit and ok:
        subprocess.run(["git", "add", "-A"], cwd=ROOT)
        subprocess.run(["git", "commit", "-qm", "build: regenerate site via 6-agent crew"], cwd=ROOT)
        subprocess.run(["git", "push", "-q"], cwd=ROOT)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
