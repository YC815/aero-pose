from datetime import datetime

from aero.results import ResultStore

PNG = b"\x89PNG fake"


def at(day: int, hour: int = 10, minute: int = 0) -> datetime:
    return datetime(2026, 10, day, hour, minute).astimezone()


def test_number_increments_per_day(tmp_path):
    s = ResultStore(tmp_path)
    nums = [s.add(0.4, 0.5, 5.0, PNG, now=at(15, 10, i))["number"] for i in range(3)]
    assert nums == [1, 2, 3]
    e = s.add(0.4, 0.5, 5.0, PNG, now=at(16))
    assert e["number"] == 1
    assert e["date"] == "2026-10-16"


def test_entry_shape_and_png(tmp_path):
    s = ResultStore(tmp_path)
    e = s.add(0.41, 0.5, 6.5, PNG, now=at(15))
    assert set(e) == {"id", "date", "number", "ts", "area_m2", "baseline_m2", "watts_saved"}
    assert len(e["id"]) == 10
    assert s.png_path(e["id"]).read_bytes() == PNG
    assert s.png_path(e["id"]) == tmp_path / "results" / f"{e['id']}.png"


def test_rank_by_area_ascending_ties_first_wins(tmp_path):
    s = ResultStore(tmp_path)
    a = s.add(0.50, 0.5, 0, PNG, now=at(15, 10, 0))
    b = s.add(0.40, 0.5, 0, PNG, now=at(15, 10, 1))
    c = s.add(0.50, 0.5, 0, PNG, now=at(15, 10, 2))
    assert s.rank(b) == 1
    assert s.rank(a) == 2
    assert s.rank(c) == 3


def test_rank_only_counts_same_day(tmp_path):
    s = ResultStore(tmp_path)
    s.add(0.30, 0.5, 0, PNG, now=at(14))
    e = s.add(0.50, 0.5, 0, PNG, now=at(15))
    assert s.rank(e) == 1


def test_top_filters_day_and_limits(tmp_path):
    s = ResultStore(tmp_path)
    s.add(0.10, 0.5, 0, PNG, now=at(14))
    for i in range(12):
        s.add(0.30 + i * 0.01, 0.5, 0, PNG, now=at(15, 10, i))
    top = s.top("2026-10-15")
    assert len(top) == 10
    assert [e["area_m2"] for e in top] == sorted(e["area_m2"] for e in top)
    assert all(e["date"] == "2026-10-15" for e in top)
    assert len(s.top("2026-10-15", n=3)) == 3
    assert s.top("2026-01-01") == []


def test_persists_across_reopen(tmp_path):
    s = ResultStore(tmp_path)
    e = s.add(0.4, 0.5, 1.0, PNG, now=at(15))
    s2 = ResultStore(tmp_path)
    assert s2.top("2026-10-15") == [e]
    assert s2.add(0.4, 0.5, 1.0, PNG, now=at(15, 11))["number"] == 2


def test_corrupt_line_is_skipped(tmp_path):
    s = ResultStore(tmp_path)
    s.add(0.4, 0.5, 1.0, PNG, now=at(15))
    with (tmp_path / "results.jsonl").open("a") as f:
        f.write("{broken\n")
    assert len(ResultStore(tmp_path).top("2026-10-15")) == 1
