#!/usr/bin/env bash
# 攤位 kiosk 一鍵啟動。AERO_SOURCE=orbbec|webcam|replay（預設 orbbec）；replay 要加 AERO_REPLAY=<名稱>。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AERO_SOURCE="${AERO_SOURCE:-orbbec}"
URL="http://localhost:8000"

# 1. dist 不存在或比 src 舊才 build
DIST_INDEX="$ROOT/frontend/dist/index.html"
if [[ ! -f "$DIST_INDEX" ]] || [[ -n "$(find "$ROOT/frontend/src" -type f -newer "$DIST_INDEX" -print -quit)" ]]; then
  pnpm --dir "$ROOT/frontend" build
fi

# 2. 背景跑後端；崩潰 2 秒後重啟
# 不用陣列組參數：macOS 內建 bash 3.2 在 set -u 下展開空陣列會報 unbound variable。
case "$AERO_SOURCE" in
  webcam | orbbec) ;;
  replay)
    if [[ -z "${AERO_REPLAY:-}" ]]; then
      echo "AERO_SOURCE=replay 需要設定 AERO_REPLAY=<錄影資料夾名>" >&2
      exit 1
    fi
    ;;
  *)
    echo "未知的 AERO_SOURCE：$AERO_SOURCE（webcam|orbbec|replay）" >&2
    exit 1
    ;;
esac

serve() {
  if [[ "$AERO_SOURCE" == "webcam" ]]; then
    uv run --directory "$ROOT/backend" aero serve --source webcam
  elif [[ "$AERO_SOURCE" == "replay" ]]; then
    uv run --directory "$ROOT/backend" aero serve --source replay --replay "$AERO_REPLAY"
  else
    uv run --directory "$ROOT/backend" --extra orbbec aero serve --source orbbec
  fi
}

(
  until serve; do
    sleep 2
  done
) &
LOOP_PID=$!

# 5. 結束時殺掉重啟迴圈與它底下的 server
cleanup() {
  pkill -P "$LOOP_PID" 2>/dev/null || true
  kill "$LOOP_PID" 2>/dev/null || true
}
trap cleanup EXIT

# 3. 等後端起來
until curl -sf "$URL/api/settings" >/dev/null; do
  kill -0 "$LOOP_PID" 2>/dev/null || { echo "後端迴圈已結束" >&2; exit 1; }
  sleep 1
done

# 4. 開 kiosk；腳本留著等後端迴圈，Ctrl-C 或結束時由 trap 收掉
open -na "Google Chrome" --args --kiosk --app="$URL" --autoplay-policy=no-user-gesture-required
wait "$LOOP_PID"
