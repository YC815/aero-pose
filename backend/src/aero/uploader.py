"""結果圖上傳：S3 相容儲存或本機 fallback。圖片一律先存本機（見 results.py）。"""

from __future__ import annotations

import logging
import os
import socket
from collections.abc import Mapping
from typing import Protocol

log = logging.getLogger(__name__)

_S3_KEYS = (
    "AERO_S3_ENDPOINT",
    "AERO_S3_BUCKET",
    "AERO_S3_KEY_ID",
    "AERO_S3_SECRET",
    "AERO_PUBLIC_BASE_URL",
)


class Uploader(Protocol):
    def upload(self, id: str, png: bytes) -> str | None: ...


def _lan_ip() -> str | None:
    """UDP connect 不會送封包，只是讓 OS 選出對外網卡。"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


class LocalUploader:
    def __init__(self, port: int):
        self.port = port

    def upload(self, id: str, png: bytes) -> str | None:
        ip = _lan_ip()
        if ip is None:
            return None
        return f"http://{ip}:{self.port}/r/{id}.png"


class S3Uploader:
    def __init__(
        self,
        endpoint: str,
        bucket: str,
        key_id: str,
        secret: str,
        public_base_url: str,
        timeout_s: float = 5.0,
    ):
        self.endpoint = endpoint
        self.bucket = bucket
        self.key_id = key_id
        self.secret = secret
        self.public_base_url = public_base_url.rstrip("/")
        self.timeout_s = timeout_s
        self._client = None

    def _get_client(self):
        if self._client is None:
            import boto3
            from botocore.config import Config

            self._client = boto3.client(
                "s3",
                endpoint_url=self.endpoint,
                aws_access_key_id=self.key_id,
                aws_secret_access_key=self.secret,
                config=Config(
                    connect_timeout=self.timeout_s,
                    read_timeout=self.timeout_s,
                    retries={"max_attempts": 1},
                ),
            )
        return self._client

    def upload(self, id: str, png: bytes) -> str | None:
        key = f"results/{id}.png"
        try:
            self._get_client().put_object(
                Bucket=self.bucket, Key=key, Body=png, ContentType="image/png"
            )
        except Exception:
            log.exception("S3 上傳失敗")
            return None
        return f"{self.public_base_url}/{key}"


def make_uploader(port: int, env: Mapping[str, str] = os.environ) -> Uploader:
    if all(env.get(k) for k in _S3_KEYS):
        return S3Uploader(
            env["AERO_S3_ENDPOINT"],
            env["AERO_S3_BUCKET"],
            env["AERO_S3_KEY_ID"],
            env["AERO_S3_SECRET"],
            env["AERO_PUBLIC_BASE_URL"],
        )
    return LocalUploader(port)
