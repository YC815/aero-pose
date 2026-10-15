import sys
import types

from aero.uploader import LocalUploader, S3Uploader, make_uploader

ENV = {
    "AERO_S3_ENDPOINT": "https://x.r2.example.com",
    "AERO_S3_BUCKET": "b",
    "AERO_S3_KEY_ID": "k",
    "AERO_S3_SECRET": "s",
    "AERO_PUBLIC_BASE_URL": "https://pub.example.com",
}


def test_make_uploader_full_env_is_s3():
    assert isinstance(make_uploader(8000, ENV), S3Uploader)


def test_make_uploader_missing_one_is_local():
    for k in ENV:
        env = {kk: v for kk, v in ENV.items() if kk != k}
        assert isinstance(make_uploader(8000, env), LocalUploader)
    assert isinstance(make_uploader(8000, {}), LocalUploader)


def test_make_uploader_empty_value_counts_as_missing():
    assert isinstance(make_uploader(8000, {**ENV, "AERO_S3_SECRET": ""}), LocalUploader)


class FakeClient:
    def __init__(self, fail: bool = False):
        self.fail = fail
        self.calls: list[dict] = []

    def put_object(self, **kw):
        self.calls.append(kw)
        if self.fail:
            raise RuntimeError("boom")


def make_s3(monkeypatch, client: FakeClient, base="https://pub.example.com/") -> S3Uploader:
    fake = types.SimpleNamespace(client=lambda *a, **k: client)
    monkeypatch.setitem(sys.modules, "boto3", fake)
    return S3Uploader("https://e", "bucket", "k", "s", base)


def test_s3_upload_ok(monkeypatch):
    c = FakeClient()
    up = make_s3(monkeypatch, c)
    assert up.upload("abc1234567", b"png") == "https://pub.example.com/results/abc1234567.png"
    assert c.calls == [
        {"Bucket": "bucket", "Key": "results/abc1234567.png", "Body": b"png", "ContentType": "image/png"}
    ]


def test_s3_upload_exception_returns_none(monkeypatch):
    assert make_s3(monkeypatch, FakeClient(fail=True)).upload("abc1234567", b"png") is None


def test_s3_client_creation_failure_returns_none(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("no creds")

    monkeypatch.setitem(sys.modules, "boto3", types.SimpleNamespace(client=boom))
    assert S3Uploader("https://e", "b", "k", "s", "https://p").upload("abc1234567", b"x") is None


def test_local_uploader_url(monkeypatch):
    monkeypatch.setattr("aero.uploader._lan_ip", lambda: "192.168.1.9")
    assert LocalUploader(8000).upload("abc1234567", b"x") == "http://192.168.1.9:8000/r/abc1234567.png"


def test_local_uploader_no_ip(monkeypatch):
    monkeypatch.setattr("aero.uploader._lan_ip", lambda: None)
    assert LocalUploader(8000).upload("abc1234567", b"x") is None
