"""Common infrastructure shared by every pipeline agent.

Each agent owns ONE responsibility, reads its inputs from `data/` (or the
outputs of earlier agents in `data/_generated/`), writes its own outputs,
and emits a machine-readable report into `reports/<agent>.json`.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
GEN = DATA / "_generated"
DIST = ROOT / "dist"
SRC = ROOT / "src"
TEMPLATES = ROOT / "templates"
REPORTS = ROOT / "reports"
CACHE = ROOT / ".cache"

for _d in (GEN, DIST, REPORTS, CACHE):
    _d.mkdir(parents=True, exist_ok=True)


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


@dataclass
class Report:
    agent: str
    role: str
    ok: bool = True
    started: float = field(default_factory=time.time)
    duration_s: float = 0.0
    stats: dict = field(default_factory=dict)
    warnings: list = field(default_factory=list)
    errors: list = field(default_factory=list)

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)

    def error(self, msg: str) -> None:
        self.errors.append(msg)
        self.ok = False


class Agent:
    """Base class. Subclasses implement `run(report)`."""

    name: str = "agent"
    role: str = ""

    def __init__(self, verbose: bool = True):
        self.verbose = verbose

    def log(self, msg: str) -> None:
        if self.verbose:
            print(f"  [{self.name}] {msg}", flush=True)

    def execute(self) -> Report:
        report = Report(agent=self.name, role=self.role)
        print(f"\n▶ {self.name}  —  {self.role}", flush=True)
        try:
            self.run(report)
        except Exception as exc:  # noqa: BLE001 - agents must never crash the pipeline silently
            import traceback

            report.error(f"{type(exc).__name__}: {exc}")
            traceback.print_exc()
        report.duration_s = round(time.time() - report.started, 2)
        save_json(REPORTS / f"{self.name}.json", report.__dict__)
        status = "OK" if report.ok else "FAILED"
        print(
            f"  ✔ {self.name}: {status} in {report.duration_s}s "
            f"({len(report.warnings)} warnings, {len(report.errors)} errors)",
            flush=True,
        )
        for w in report.warnings[:8]:
            print(f"    ⚠ {w}")
        for e in report.errors[:8]:
            print(f"    ✖ {e}")
        return report

    def run(self, report: Report) -> None:  # pragma: no cover - abstract
        raise NotImplementedError
