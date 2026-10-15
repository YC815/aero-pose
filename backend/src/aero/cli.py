"""aero serve | record | doctor。重型 module 全部在函式內 lazy import。"""

from __future__ import annotations

import argparse
import logging
from collections.abc import Callable
from typing import Any

from aero.config import DATA_DIR, Settings

log = logging.getLogger(__name__)


class OwnedPipeline:
    """Pipeline + 它擁有的 source / detector。close() 釋放相機與模型，重建 pipeline 前一定要呼叫。"""

    def __init__(self, pipeline: Any, source: Any, detector: Any):
        self._pipeline = pipeline
        self._source = source
        self._detector = detector

    def step(self):
        return self._pipeline.step()

    def close(self) -> None:
        for name, fn in (("source.stop", self._source.stop), ("detector.close", self._detector.close)):
            try:
                fn()
            except Exception:
                log.exception("%s 失敗", name)


def build_runner(
    make_source: Callable[[], Any],
    make_detector: Callable[[], Any],
    pipeline_cls: Callable[..., Any],
    get_settings: Callable[[], Settings],
) -> OwnedPipeline:
    """在 pipeline thread 內呼叫：MediaPipe 物件不跨 thread。中途失敗要釋放已建立的資源。"""
    source = make_source()
    detector = None
    try:
        detector = make_detector()
        source.start()
        return OwnedPipeline(pipeline_cls(source, detector, get_settings), source, detector)
    except Exception:
        for fn in (source.stop, getattr(detector, "close", None)):
            if fn is None:
                continue
            try:
                fn()
            except Exception:
                log.exception("清理失敗")
        raise


def _cmd_serve(args: argparse.Namespace) -> int:
    import uvicorn

    from aero.pipeline import Pipeline
    from aero.pose import PoseDetector
    from aero.server import create_app
    from aero.sources import make_source
    from aero.uploader import make_uploader

    def factory(get_settings: Callable[[], Settings]) -> OwnedPipeline:
        return build_runner(
            lambda: make_source(args.source, replay=args.replay, webcam_index=args.webcam_index),
            PoseDetector,
            Pipeline,
            get_settings,
        )

    app = create_app(factory, DATA_DIR, args.port, make_uploader(args.port))
    uvicorn.run(app, host="0.0.0.0", port=args.port)
    return 0


def _cmd_record(args: argparse.Namespace) -> int:
    from aero.record import record
    from aero.sources import make_source

    source = make_source(args.source, replay=args.replay, webcam_index=args.webcam_index)
    out_dir = DATA_DIR / "recordings" / args.name
    source.start()  # record() 不會呼叫 start/stop
    try:
        n = record(source, out_dir, args.seconds)
    finally:
        source.stop()
    print(f"錄了 {n} 幀 → {out_dir}")
    return 0


def _cmd_doctor(args: argparse.Namespace) -> int:
    from aero.doctor import run

    return run()


def _add_source_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--source", choices=["webcam", "orbbec", "replay"], required=True)
    p.add_argument("--replay", metavar="NAME", help="source=replay 時，data/recordings/ 下的資料夾名")
    p.add_argument("--webcam-index", type=int, default=0)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="aero", description="風阻姿勢大挑戰後端")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_serve = sub.add_parser("serve", help="啟動後端（含前端靜態檔）")
    _add_source_args(p_serve)
    p_serve.add_argument("--port", type=int, default=8000)
    p_serve.set_defaults(func=_cmd_serve)

    p_rec = sub.add_parser("record", help="錄製 source 到 data/recordings/NAME")
    _add_source_args(p_rec)
    p_rec.add_argument("--name", required=True)
    p_rec.add_argument("--seconds", type=float, default=20)
    p_rec.set_defaults(func=_cmd_record)

    p_doc = sub.add_parser("doctor", help="相機自檢")
    p_doc.set_defaults(func=_cmd_doctor)
    return parser


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
