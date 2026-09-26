"""Agent 3 — Score Analyst.

Role: turn raw 8-axis scores into the multi-perspective evaluation used on
the site:
  * weighted totals (0-100) for every persona profile
  * per-persona ranking + winner
  * per-axis leader and each region's strongest / weakest axes
  * a short auto-generated verdict sentence for each region
  * student-budget estimate in JPY for the recommended stay length
Writes data/_generated/analysis.json (also embedded into the page for the
interactive persona switcher so the browser never recomputes differently).
"""
from __future__ import annotations

from .base import DATA, GEN, Agent, Report, load_json, save_json


def weighted(scores: dict, weights: dict) -> float:
    """0-100 weighted total, rounded half-up to 0.1 with exact integer arithmetic.

    Must match site.js (Math.round(s * 100 / tw) / 10): Python's round() is banker's rounding on a
    float, which gave 76.2 on the static page but 76.3 in the interactive finder for the same data."""
    total_w = sum(weights.values())
    if not total_w:
        return 0.0
    s = sum(scores[a]["v"] * w for a, w in weights.items())
    return (s * 200 + total_w) // (2 * total_w) / 10


def competition_rank(order: list, totals: dict) -> dict:
    """1224-style ranks: equal totals share a rank (same rule as the finder in site.js)."""
    ranks, prev, rank = {}, None, 0
    for i, k in enumerate(order):
        if totals[k] != prev:
            rank = i + 1
        prev = totals[k]
        ranks[k] = rank
    return ranks


class ScoreAnalyst(Agent):
    name = "a3_score_analyst"
    role = "8軸スコアの多元的分析（ペルソナ別加重・ランキング・講評生成）"

    def run(self, report: Report) -> None:
        cfg = load_json(DATA / "config.json")
        regions = load_json(GEN / "regions.json")
        axes = {a["id"]: a for a in cfg["axes"]}
        rate = cfg["currency"]["inr_to_jpy"]

        page_order = [r["id"] for r in regions]
        balanced_w = next((p["weights"] for p in cfg["personas"] if p["id"] == "balanced"), {a: 1 for a in axes})
        balanced = {r["id"]: weighted(r["scores"], balanced_w) for r in regions}
        personas = {}
        for p in cfg["personas"]:
            totals = {r["id"]: weighted(r["scores"], p["weights"]) for r in regions}
            # same deterministic order as the finder: score, then balanced score, then page order
            ranking = sorted(totals, key=lambda k: (-totals[k], -balanced[k], page_order.index(k)))
            ranks = competition_rank(ranking, totals)
            personas[p["id"]] = {"totals": totals, "ranking": ranking, "rank": ranks, "winner": ranking[0],
                                 "winners": [k for k in ranking if ranks[k] == 1]}

        # every region sharing the top score of an axis is a leader (ties used to star only the first)
        axis_leaders = {}
        for ax in axes:
            top = max(r["scores"][ax]["v"] for r in regions)
            axis_leaders[ax] = [r["id"] for r in regions if r["scores"][ax]["v"] == top]

        per_region = {}
        for r in regions:
            sc = {a: r["scores"][a]["v"] for a in axes}
            ordered = sorted(sc, key=lambda a: -sc[a])
            strong = ordered[:2]
            weak = ordered[-1]
            wins = [pid for pid, v in personas.items() if r["id"] in v["winners"]]
            d_lo, d_hi = r["days"]
            b_lo, b_hi = r["budget_inr"]
            verdict = (
                f"{axes[strong[0]]['label']}と{axes[strong[1]]['label']}が突出。"
                f"弱点は{axes[weak]['label']}（{sc[weak]}/10）。"
            )
            per_region[r["id"]] = {
                "balanced": balanced[r["id"]],
                "strong": strong,
                "weak": weak,
                "persona_wins": wins,
                "verdict": verdict,
                "trip_jpy": [round(b_lo * d_lo * rate, -3), round(b_hi * d_hi * rate, -3)],
                "daily_jpy": [round(b_lo * rate, -2), round(b_hi * rate, -2)],
            }

        # ---- robustness: how often does each region win under random weights?
        # 20,000 Dirichlet-like random weightings (seeded → reproducible build).
        import random

        rng = random.Random(42)
        ax_ids = list(axes)
        N = 20000
        win_count = {r["id"]: 0 for r in regions}
        top2_count = {r["id"]: 0 for r in regions}
        for _ in range(N):
            w = {a: rng.expovariate(1.0) for a in ax_ids}
            tot = {r["id"]: sum(r["scores"][a]["v"] * w[a] for a in ax_ids) for r in regions}
            order = sorted(tot, key=lambda k: -tot[k])
            win_count[order[0]] += 1
            for k in order[:2]:
                top2_count[k] += 1
        robustness = {rid: {"win": round(win_count[rid] * 100 / N, 1), "top2": round(top2_count[rid] * 100 / N, 1)}
                      for rid in win_count}

        # ---- head-to-head: per pair, which axes each side wins
        h2h = {}
        for a_r in regions:
            for b_r in regions:
                if a_r["id"] >= b_r["id"]:
                    continue
                wins_a = [x for x in ax_ids if a_r["scores"][x]["v"] > b_r["scores"][x]["v"]]
                wins_b = [x for x in ax_ids if b_r["scores"][x]["v"] > a_r["scores"][x]["v"]]
                h2h[f"{a_r['id']}|{b_r['id']}"] = {"a": wins_a, "b": wins_b,
                                                   "tie": [x for x in ax_ids if x not in wins_a + wins_b]}

        # ---- spread per axis (where do the regions really differ?)
        spread = {a: max(r["scores"][a]["v"] for r in regions) - min(r["scores"][a]["v"] for r in regions)
                  for a in ax_ids}

        for rid, v in per_region.items():
            v["robust"] = robustness[rid]

        for pid, v in personas.items():
            self.log(f"{pid:10s} → winner {v['winner']:10s} {v['totals'][v['winner']]}")
        self.log("robustness (win% over random weights): "
                 + ", ".join(f"{k} {v['win']}%" for k, v in robustness.items()))
        winners = {w for v in personas.values() for w in v["winners"]}
        if len(winners) < 3:
            report.warn(f"persona winners not diverse enough: {winners}")

        save_json(GEN / "analysis.json", {
            "personas": personas, "axis_leaders": axis_leaders, "regions": per_region,
            "h2h": h2h, "spread": spread, "robust_samples": N,
        })
        report.stats = {"personas": len(personas), "distinct_winners": sorted(winners)}
