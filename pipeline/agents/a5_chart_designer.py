"""Agent 5 — Chart Designer.

Role: pre-render every data visualisation as static, accessible SVG so the
page is meaningful even before / without JavaScript, then JS only animates.
  * 8-axis radar chart per region (with grid rings and labels)
  * comparison heatmap cell colours (score → colour ramp)
  * seasonality heatmap colours (1..5)
Writes data/_generated/charts.json.
"""
from __future__ import annotations

import math

from .base import DATA, GEN, Agent, Report, load_json, save_json

SIZE = 360
CX = CY = SIZE / 2
R = 118


def _pt(i: int, n: int, v: float, radius: float = R) -> tuple[float, float]:
    ang = -math.pi / 2 + 2 * math.pi * i / n
    return round(CX + math.cos(ang) * radius * v, 2), round(CY + math.sin(ang) * radius * v, 2)


def radar_svg(values: list[float], labels: list[str], accent: str, rid: str) -> str:
    n = len(values)
    grid = []
    for ring in (0.2, 0.4, 0.6, 0.8, 1.0):
        pts = " ".join(f"{x},{y}" for x, y in (_pt(i, n, ring) for i in range(n)))
        grid.append(f'<polygon class="rg" points="{pts}"/>')
    spokes = "".join(
        f'<line class="rs" x1="{CX}" y1="{CY}" x2="{x}" y2="{y}"/>'
        for x, y in (_pt(i, n, 1) for i in range(n))
    )
    data_pts = [_pt(i, n, v / 10) for i, v in enumerate(values)]
    poly = " ".join(f"{x},{y}" for x, y in data_pts)
    dots = "".join(f'<circle class="rd" cx="{x}" cy="{y}" r="3.5"/>' for x, y in data_pts)
    lbls = []
    for i, (lab, v) in enumerate(zip(labels, values)):
        x, y = _pt(i, n, 1.0, R + 30)
        anchor = "middle" if abs(x - CX) < 8 else ("start" if x > CX else "end")
        lbls.append(
            f'<text class="rl" x="{x}" y="{y}" text-anchor="{anchor}" dominant-baseline="middle">'
            f'{lab}<tspan class="rv" dx="4">{v:g}</tspan></text>'
        )
    gid = f"rgrad-{rid}"
    return (
        f'<svg class="radar" viewBox="0 0 {SIZE} {SIZE}" role="img" '
        f'aria-label="{"、".join(f"{l}{v:g}" for l, v in zip(labels, values))}">'
        f'<defs><radialGradient id="{gid}"><stop offset="0%" stop-color="{accent}" stop-opacity=".15"/>'
        f'<stop offset="100%" stop-color="{accent}" stop-opacity=".55"/></radialGradient></defs>'
        f'<g class="rgrid">{"".join(grid)}{spokes}</g>'
        f'<polygon class="rp" points="{poly}" fill="url(#{gid})" stroke="{accent}" '
        f'style="transform-origin:{CX}px {CY}px"/>'
        f'<g class="rdots" fill="{accent}">{dots}</g>'
        f'<g class="rlabels">{"".join(lbls)}</g></svg>'
    )


# Perceptual ramp: deep indigo → plum → terracotta → saffron → gold, interpolated
# in OKLab so lightness rises evenly (no muddy mid-tones, readable steps).
_STOPS = ["#1d2140", "#4a2a52", "#9a3b3b", "#d9782e", "#f2c14e"]


def _lin(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _gam(c: float) -> float:
    c = max(0.0, min(1.0, c))
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def _hex2lab(h: str) -> tuple[float, float, float]:
    r, g, b = (_lin(int(h[i:i + 2], 16) / 255) for i in (1, 3, 5))
    l_ = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) ** (1 / 3)
    m_ = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) ** (1 / 3)
    s_ = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b) ** (1 / 3)
    return (0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
            1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
            0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_)


def _lab2hex(L: float, A: float, B: float) -> str:
    l_ = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
    m_ = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
    s_ = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3
    r = 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_
    g = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_
    b = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_
    return "#%02x%02x%02x" % tuple(round(_gam(c) * 255) for c in (r, g, b))


_LAB = [_hex2lab(h) for h in _STOPS]


def ramp(v: float, lo: float, hi: float) -> str:
    """Score → colour on the OKLab ramp (returns #rrggbb)."""
    t = max(0.0, min(1.0, (v - lo) / (hi - lo))) * (len(_LAB) - 1)
    i = min(int(t), len(_LAB) - 2)
    f = t - i
    a, b = _LAB[i], _LAB[i + 1]
    return _lab2hex(*(a[k] + (b[k] - a[k]) * f for k in range(3)))


def ink(bg: str) -> str:
    """Readable text colour for a ramp background (WCAG relative luminance)."""
    r, g, b = (_lin(int(bg[i:i + 2], 16) / 255) for i in (1, 3, 5))
    return "#1a1109" if 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.28 else "#fffaf2"


class ChartDesigner(Agent):
    name = "a5_chart_designer"
    role = "レーダーチャート・ヒートマップのSVG/配色を事前生成"

    def run(self, report: Report) -> None:
        cfg = load_json(DATA / "config.json")
        regions = load_json(GEN / "regions.json")
        axes = cfg["axes"]
        labels = [a["short"] for a in axes]
        out = {"radar": {}, "heat": {}, "heat_ink": {}, "season": {}}
        for r in regions:
            vals = [r["scores"][a["id"]]["v"] for a in axes]
            out["radar"][r["id"]] = radar_svg(vals, labels, r["theme"]["accent"], r["id"])
            out["heat"][r["id"]] = {a["id"]: ramp(r["scores"][a["id"]]["v"], 3, 10) for a in axes}
            out["heat_ink"][r["id"]] = {k: ink(v) for k, v in out["heat"][r["id"]].items()}
            out["season"][r["id"]] = [ramp(m, 1, 5) for m in r["months"]]
        # data for the interactive (JS) comparison radar
        out["radar_js"] = {
            "size": SIZE, "r": R, "labels": labels,
            "series": {r["id"]: [r["scores"][a["id"]]["v"] for a in axes] for r in regions},
            "colors": {r["id"]: r["theme"]["accent"] for r in regions},
        }
        save_json(GEN / "charts.json", out)
        report.stats = {"radars": len(out["radar"]), "heat_cells": len(regions) * len(axes),
                        "season_cells": len(regions) * 12}
