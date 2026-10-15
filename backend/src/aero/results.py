"""排行榜資料：data_dir/results.jsonl + data_dir/results/{id}.png。"""

from __future__ import annotations

import json
import logging
import threading
import uuid
from datetime import datetime
from pathlib import Path

log = logging.getLogger(__name__)


class ResultStore:
    def __init__(self, data_dir: Path):
        self._jsonl = data_dir / "results.jsonl"
        self._png_dir = data_dir / "results"
        self._lock = threading.Lock()
        self._entries: list[dict] = []  # 檔案順序 = 到達順序
        self._load()

    def _load(self) -> None:
        if not self._jsonl.exists():
            return
        for line in self._jsonl.read_text().splitlines():
            if not line.strip():
                continue
            try:
                self._entries.append(json.loads(line))
            except json.JSONDecodeError:
                log.warning("results.jsonl 有壞掉的行，略過")

    def add(
        self,
        area_m2: float,
        baseline_m2: float,
        watts_saved: float,
        png: bytes,
        now: datetime | None = None,
    ) -> dict:
        now = now or datetime.now().astimezone()
        date = now.strftime("%Y-%m-%d")
        with self._lock:
            entry = {
                "id": uuid.uuid4().hex[:10],
                "date": date,
                "number": sum(1 for e in self._entries if e["date"] == date) + 1,
                "ts": now.timestamp(),
                "area_m2": area_m2,
                "baseline_m2": baseline_m2,
                "watts_saved": watts_saved,
            }
            self._png_dir.mkdir(parents=True, exist_ok=True)
            self.png_path(entry["id"]).write_bytes(png)
            with self._jsonl.open("a") as f:
                f.write(json.dumps(entry) + "\n")
            self._entries.append(entry)
        return entry

    def _day_sorted(self, date: str) -> list[dict]:
        day = [e for e in self._entries if e["date"] == date]
        return sorted(day, key=lambda e: e["area_m2"])  # stable：同分先到者在前

    def rank(self, entry: dict) -> int:
        with self._lock:
            for i, e in enumerate(self._day_sorted(entry["date"]), start=1):
                if e["id"] == entry["id"]:
                    return i
        raise KeyError(entry["id"])

    def top(self, date: str, n: int = 10) -> list[dict]:
        with self._lock:
            return self._day_sorted(date)[:n]

    def png_path(self, id: str) -> Path:
        return self._png_dir / f"{id}.png"
