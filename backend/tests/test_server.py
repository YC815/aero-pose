import base64
import itertools
import threading
import time

import numpy as np
import pytest
from fastapi.testclient import TestClient

import aero.server as server
from aero.config import Settings, settings_to_dict
from aero.server import create_app
from aero.types import Frame, StepResult
from aero.uploader import LocalUploader

PNG = b"\x89PNG\r\n fake-bytes"


class StubUploader:
    def __init__(self, url="https://pub/x.png"):
        self.url = url
        self.calls = []

    def upload(self, id, png):
        self.calls.append((id, png))
        return self.url


@pytest.fixture(autouse=True)
def fast_timers(monkeypatch):
    monkeypatch.setattr(server, "STATUS_INTERVAL_S", 0.05)
    monkeypatch.setattr(server, "RESTART_DELAY_S", 0.05)
    monkeypatch.setattr(server, "FRONTEND_DIST", server.Path("/nonexistent-dist"))


def fake_result(n: int = 0) -> StepResult:
    frame = Frame(rgb=np.zeros((4, 4, 3), np.uint8), depth_m=None, intrinsics=None, ts=float(n))
    return StepResult(
        skeleton={"type": "skeleton", "ts": float(n), "source": "fake", "has_depth": False, "player": None},
        frame=frame,
    )


class FakePipeline:
    """依序回 n 個結果，之後一直回 None。"""

    def __init__(self, n: int = 2, gate: threading.Event | None = None):
        self.results = [fake_result(i) for i in range(n)]
        self.closed = False
        self.gate = gate  # 測試連上 ws 後才放行，避免 skeleton 在連線前就推完

    def step(self):
        if self.gate is not None:
            self.gate.wait(5)
        return self.results.pop(0) if self.results else None

    def close(self):
        self.closed = True


def client(tmp_path, factory=None, uploader=None):
    app = create_app(factory, tmp_path, uploader=uploader or StubUploader())
    return TestClient(app)


def recv_until(ws, pred, limit=200):
    for _ in range(limit):
        m = ws.receive_json()
        if pred(m):
            return m
    raise AssertionError("沒等到預期訊息")


def post_result(c, area=0.42):
    return c.post(
        "/api/results",
        json={
            "area_m2": area,
            "baseline_m2": 0.5,
            "watts_saved": 7.5,
            "png_b64": base64.b64encode(PNG).decode(),
        },
    )


# ---- REST ----


def test_settings_default_and_put(tmp_path):
    with client(tmp_path) as c:
        assert c.get("/api/settings").json() == settings_to_dict(Settings())
        body = settings_to_dict(Settings(cd=0.6, depth_far_m=4.0))
        assert c.put("/api/settings", json=body).status_code == 200
        got = c.get("/api/settings").json()
        assert got["cd"] == 0.6 and got["depth_far_m"] == 4.0
    assert (tmp_path / "settings.json").exists()
    # 重開 app 仍讀得到
    with client(tmp_path) as c2:
        assert c2.get("/api/settings").json()["cd"] == 0.6


def test_settings_put_bad_value_is_422(tmp_path):
    with client(tmp_path) as c:
        assert c.put("/api/settings", json={"cd": "abc"}).status_code == 422
        assert c.get("/api/settings").json()["cd"] == Settings().cd


def test_results_post_and_png_roundtrip(tmp_path):
    up = StubUploader("https://pub/abc.png")
    with client(tmp_path, uploader=up) as c:
        r = post_result(c)
        assert r.status_code == 200
        j = r.json()
        assert j["number"] == 1 and j["rank"] == 1
        assert j["qr_url"] == "https://pub/abc.png"
        assert up.calls == [(j["id"], PNG)]
        img = c.get(f"/r/{j['id']}.png")
        assert img.status_code == 200
        assert img.content == PNG
        assert img.headers["content-type"] == "image/png"
        j2 = post_result(c, area=0.30).json()
        assert j2["number"] == 2 and j2["rank"] == 1


def test_results_upload_failure_gives_null_qr(tmp_path):
    class Boom:
        def upload(self, id, png):
            raise RuntimeError("x")

    with client(tmp_path, uploader=Boom()) as c:
        j = post_result(c).json()
        assert j["qr_url"] is None and j["number"] == 1


def test_results_bad_base64_is_400(tmp_path):
    with client(tmp_path) as c:
        r = c.post(
            "/api/results",
            json={"area_m2": 0.4, "baseline_m2": 0.5, "watts_saved": 1, "png_b64": "!!!not base64"},
        )
        assert r.status_code == 400


def test_png_invalid_id_is_404(tmp_path):
    with client(tmp_path) as c:
        for bad in ["..%2F..%2Fsettings.json", "ABCDEF0123.png", "abc.png", "zzzzzzzzzz.png", "0123456789.png"]:
            assert c.get(f"/r/{bad}").status_code == 404, bad
        assert c.get("/r/0123456789").status_code == 404


def test_leaderboard(tmp_path):
    with client(tmp_path) as c:
        j = post_result(c).json()
        rows = c.get("/api/leaderboard").json()
        assert [r["id"] for r in rows] == [j["id"]]
        assert rows[0]["number"] == 1 and rows[0]["area_m2"] == 0.42
        assert c.get("/api/leaderboard?date=2000-01-01").json() == []


def test_static_mounted_when_dist_exists(tmp_path, monkeypatch):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html>hi</html>")
    monkeypatch.setattr(server, "FRONTEND_DIST", dist)
    with client(tmp_path) as c:
        assert "hi" in c.get("/").text
        assert c.get("/api/settings").status_code == 200  # API 不被 mount 蓋掉


# ---- WS ----


def test_ws_first_message_is_settings(tmp_path):
    with client(tmp_path) as c, c.websocket_connect("/ws") as ws:
        m = ws.receive_json()
        assert m["type"] == "settings"
        assert m["settings"] == settings_to_dict(Settings())


def test_ws_receives_settings_broadcast_on_put(tmp_path):
    with client(tmp_path) as c, c.websocket_connect("/ws") as ws:
        ws.receive_json()
        c.put("/api/settings", json=settings_to_dict(Settings(cd=0.9)))
        m = recv_until(ws, lambda m: m["type"] == "settings")
        assert m["settings"]["cd"] == 0.9


def test_ws_ignores_garbage_messages(tmp_path):
    with client(tmp_path) as c, c.websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.send_text("not json")
        ws.send_json({"type": "preview", "on": "yes"})
        ws.send_json({"type": "nope"})
        recv_until(ws, lambda m: m["type"] == "status")  # 連線還活著


def test_pipeline_skeleton_then_disconnected_status(tmp_path):
    gate = threading.Event()
    with client(tmp_path, factory=lambda gs: FakePipeline(2, gate)) as c, c.websocket_connect("/ws") as ws:
        assert ws.receive_json()["type"] == "settings"
        gate.set()
        sk = recv_until(ws, lambda m: m["type"] == "skeleton")
        assert sk["source"] == "fake"
        st = recv_until(ws, lambda m: m["type"] == "status" and m["camera"] == "disconnected")
        assert "fps" in st


def test_status_ok_while_frames_flow(tmp_path):
    class Endless:
        def step(self):
            time.sleep(0.005)
            return fake_result()

    with client(tmp_path, factory=lambda gs: Endless()) as c, c.websocket_connect("/ws") as ws:
        st = recv_until(ws, lambda m: m["type"] == "status" and m["camera"] == "ok" and m["fps"] > 0)
        assert st["fps"] > 0


def test_pipeline_receives_live_settings(tmp_path):
    seen = []

    def factory(gs):
        seen.append(gs)
        return FakePipeline(0)

    with client(tmp_path, factory=factory) as c:
        c.put("/api/settings", json=settings_to_dict(Settings(cd=0.33)))
        deadline = time.time() + 2
        while not seen and time.time() < deadline:
            time.sleep(0.01)
        assert seen[0]().cd == 0.33


def test_crashing_pipeline_does_not_kill_server(tmp_path):
    built = []

    class Crashy:
        def __init__(self):
            self.closed = False

        def step(self):
            raise RuntimeError("mediapipe exploded")

        def close(self):
            self.closed = True

    gate = threading.Event()
    counter = itertools.count()

    def counted(gs):
        i = next(counter)
        if i == 0:
            raise RuntimeError("factory exploded")
        if i == 1:
            p = Crashy()
        else:
            p = FakePipeline(1, gate)
        built.append(p)
        return p

    with client(tmp_path, factory=counted) as c, c.websocket_connect("/ws") as ws:
        gate.set()
        recv_until(ws, lambda m: m["type"] == "skeleton")  # 第三次建構的 pipeline 才有結果
        assert c.get("/api/settings").status_code == 200  # server 還活著
        assert built[0].closed  # 壞掉的 pipeline 有被 close


def test_preview_only_after_subscribe(tmp_path, monkeypatch):
    rendered = []

    def fake_render(r):
        rendered.append(r)
        return {"type": "preview", "jpeg_b64": "AAAA", "persons": []}

    monkeypatch.setattr(server, "_render_preview", fake_render)

    class Endless:
        def step(self):
            time.sleep(0.01)
            return fake_result()

    with client(tmp_path, factory=lambda gs: Endless()) as c, c.websocket_connect("/ws") as ws:
        # 先收一段 skeleton，確認沒訂閱時不會 render / 推 preview
        for _ in range(5):
            m = ws.receive_json()
            assert m["type"] != "preview"
        assert rendered == []
        ws.send_json({"type": "preview", "on": True})
        m = recv_until(ws, lambda m: m["type"] == "preview")
        assert m["jpeg_b64"] == "AAAA"


def test_preview_render_exception_is_survivable(tmp_path, monkeypatch):
    def boom(r):
        raise RuntimeError("render failed")

    monkeypatch.setattr(server, "_render_preview", boom)

    class Endless:
        def step(self):
            time.sleep(0.01)
            return fake_result()

    with client(tmp_path, factory=lambda gs: Endless()) as c, c.websocket_connect("/ws") as ws:
        ws.send_json({"type": "preview", "on": True})
        for _ in range(10):  # skeleton 照常推
            recv_until(ws, lambda m: m["type"] == "skeleton")


def test_slow_client_queue_drops_oldest():
    hub = server.Hub()
    conn = hub.add([])
    for i in range(10):
        hub.broadcast({"type": "skeleton", "i": i})
    got = []
    while not conn.queue.empty():
        got.append(conn.queue.get_nowait()["i"])
    assert got == [6, 7, 8, 9]


def test_hub_preview_routing():
    hub = server.Hub()
    a, b = hub.add([]), hub.add([])
    hub.set_preview(a, True)
    assert hub.preview_count == 1
    hub.broadcast({"type": "preview"}, preview_only=True)
    assert a.queue.qsize() == 1 and b.queue.qsize() == 0
    hub.remove(a)
    assert hub.preview_count == 0


# ---- cli ----


class Res:
    def __init__(self, fail_start=False, fail_close=False):
        self.events = []
        self.fail_start, self.fail_close = fail_start, fail_close

    def start(self):
        self.events.append("start")
        if self.fail_start:
            raise RuntimeError("no camera")

    def stop(self):
        self.events.append("stop")
        if self.fail_close:
            raise RuntimeError("stop failed")

    def close(self):
        self.events.append("close")


def test_build_runner_starts_source_and_close_releases_both():
    from aero.cli import build_runner

    src, det = Res(), Res()
    r = build_runner(lambda: src, lambda: det, lambda s, d, gs: FakePipeline(1), lambda: Settings())
    assert src.events == ["start"]
    assert r.step() is not None
    r.close()
    assert src.events == ["start", "stop"] and det.events == ["close"]


def test_build_runner_cleans_up_when_start_fails():
    from aero.cli import build_runner

    src, det = Res(fail_start=True), Res()
    with pytest.raises(RuntimeError):
        build_runner(lambda: src, lambda: det, lambda s, d, gs: FakePipeline(1), lambda: Settings())
    assert "stop" in src.events and det.events == ["close"]


def test_owned_pipeline_close_swallows_errors():
    from aero.cli import build_runner

    src, det = Res(fail_close=True), Res()
    r = build_runner(lambda: src, lambda: det, lambda s, d, gs: FakePipeline(1), lambda: Settings())
    r.close()  # 不拋例外
    assert det.events == ["close"]  # source.stop 失敗不影響 detector 釋放


def test_cli_parser():
    from aero.cli import build_parser

    p = build_parser()
    a = p.parse_args(["serve", "--source", "webcam", "--port", "9000"])
    assert a.port == 9000 and a.webcam_index == 0
    a = p.parse_args(["record", "--source", "orbbec", "--name", "x"])
    assert a.seconds == 20
    assert p.parse_args(["doctor"]).cmd == "doctor"
