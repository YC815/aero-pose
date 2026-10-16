#!/usr/bin/env bash
# 攤位 kiosk 一鍵啟動。
#   AERO_SOURCE=orbbec|webcam|replay（預設 orbbec）；replay 要加 AERO_REPLAY=<名稱>。
#   AERO_SUDO=1：後端用 root 跑（macOS 上 Orbbec 常常要 root，見 docs/orbbec.md）。
#     只有後端是 root；pnpm 和 Chrome 一律用目前使用者跑。
set -euo pipefail

# Finder 雙擊（start.command）時 PATH 很陽春
export PATH="/opt/homebrew/bin:$HOME/.local/bin:/usr/local/bin:$PATH"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AERO_SOURCE="${AERO_SOURCE:-orbbec}"
AERO_SUDO="${AERO_SUDO:-0}"
URL="http://localhost:8000"
# root 迴圈的 $0，帶本腳本 PID 才唯一；cleanup 用它找回 root 迴圈（sudo 不一定轉送 TERM）
LOOP_MARKER="aero-loop-$$"

# 0. 參數檢查
# 不用可能為空的陣列：macOS 內建 bash 3.2 在 set -u 下展開空陣列會報 unbound variable。
case "$AERO_SOURCE" in
  webcam | orbbec) SERVE_ARGS=(serve --source "$AERO_SOURCE") ;;
  replay)
    if [[ -z "${AERO_REPLAY:-}" ]]; then
      echo "AERO_SOURCE=replay 需要設定 AERO_REPLAY=<錄影資料夾名>" >&2
      exit 1
    fi
    SERVE_ARGS=(serve --source replay --replay "$AERO_REPLAY")
    ;;
  *)
    echo "未知的 AERO_SOURCE：$AERO_SOURCE（webcam|orbbec|replay）" >&2
    exit 1
    ;;
esac

# 舊的還在跑就不要再開一份：port 會撞、相機會搶不到
if nc -z localhost 8000 2>/dev/null; then
  echo "port 8000 已被佔用：上一次的風阻可能還沒關。收掉：sudo pkill -f '.venv/bin/aero serve'" >&2
  exit 1
fi
if nc -z localhost 8765 2>/dev/null; then
  echo "注意：port 8765 有東西在跑（閃身步？），它會佔住相機，這邊會一直顯示設備調整中。" >&2
fi

# sudo 要先問密碼，免得 build 完才卡在密碼提示
if [[ "$AERO_SUDO" == "1" ]]; then
  sudo -v
fi

# 1. dist 不存在或比 src 舊才 build（使用者身分）
DIST_INDEX="$ROOT/frontend/dist/index.html"
if [[ ! -f "$DIST_INDEX" ]] || [[ -n "$(find "$ROOT/frontend/src" -type f -newer "$DIST_INDEX" -print -quit)" ]]; then
  pnpm --dir "$ROOT/frontend" build
fi

# 2. 背景跑後端；崩潰 2 秒後重啟
serve() {
  if [[ "$AERO_SOURCE" == "orbbec" ]]; then
    uv run --directory "$ROOT/backend" --extra orbbec aero "${SERVE_ARGS[@]}"
  else
    uv run --directory "$ROOT/backend" aero "${SERVE_ARGS[@]}"
  fi
}

# root 端的重啟迴圈：收到 TERM/INT/HUP 時連同 server 一起結束。
# 用「背景 + wait」，trap 才能在 server 執行中立刻生效。
read -r -d '' ROOT_LOOP <<'EOF' || true
child=""
trap 'if [ -n "$child" ]; then kill "$child" 2>/dev/null; wait "$child"; fi; exit 0' TERM INT HUP
until { "$@" & child=$!; wait "$child"; }; do
  child=""
  sleep 2
done
EOF

KEEPALIVE_PID=""
if [[ "$AERO_SUDO" == "1" ]]; then
  # 用使用者身分先把 venv 裝好，root 只執行 .venv/bin/aero（不碰 uv，uv cache 不會變 root 的）
  if [[ "$AERO_SOURCE" == "orbbec" ]]; then
    uv sync --directory "$ROOT/backend" --inexact --extra orbbec
  else
    uv sync --directory "$ROOT/backend" --inexact
  fi
  AERO_BIN="$ROOT/backend/.venv/bin/aero"

  # sudo 預設清掉環境變數：把目前所有 AERO_*（S3、AERO_DATA_DIR…）帶過去
  PRESERVE="$(env | sed -n 's/^\(AERO_[A-Za-z0-9_]*\)=.*/\1/p' | paste -sd, -)"
  PRESERVE="${PRESERVE:-AERO_SOURCE}"
  sudo --preserve-env="$PRESERVE" /usr/bin/env PYTHONDONTWRITEBYTECODE=1 \
    /bin/bash -c "$ROOT_LOOP" "$LOOP_MARKER" "$AERO_BIN" "${SERVE_ARGS[@]}" &
  LOOP_PID=$!

  # sudo 的密碼快取預設 5 分鐘；cleanup 要用 sudo 收掉 root 的迴圈，所以持續續期
  (
    while kill -0 "$$" 2>/dev/null; do
      sudo -n -v 2>/dev/null || true
      sleep 60
    done
  ) &
  KEEPALIVE_PID=$!
else
  (
    until serve; do
      sleep 2
    done
  ) &
  LOOP_PID=$!
fi

# 5. 結束時殺掉重啟迴圈與它底下的 server
cleanup() {
  if [[ -n "$KEEPALIVE_PID" ]]; then
    kill "$KEEPALIVE_PID" 2>/dev/null || true
  fi
  if [[ "$AERO_SUDO" == "1" ]]; then
    # LOOP_PID 是 root 的 sudo；sudo 通常會把 TERM 轉給 root 迴圈，迴圈再收掉 server
    sudo -n kill -TERM "$LOOP_PID" 2>/dev/null || true
    # 不靠 sudo 轉送：直接用標記找 root 迴圈送 TERM。[a] 讓 pattern 不會比對到 pkill / sudo 自己的命令列。
    # pkill 回 1 = 沒有符合（迴圈已結束），不算錯。
    pk=0
    sudo -n pkill -TERM -f "[a]ero-loop-$$" 2>/dev/null || pk=$?
    if [[ "$pk" -gt 1 ]] || ! sudo -n true 2>/dev/null; then
      echo "無法用 sudo 收掉後端，請手動執行：sudo pkill -f '$LOOP_MARKER'; sudo pkill -f '.venv/bin/aero serve'" >&2
    fi
    # root 寫出來的 data/ 檔案改回目前使用者擁有
    sudo -n chown -R "$(id -u):$(id -g)" "${AERO_DATA_DIR:-$ROOT/data}" 2>/dev/null || true
  else
    pkill -P "$LOOP_PID" 2>/dev/null || true
    kill "$LOOP_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT
# 訊號一律轉成 exit，EXIT trap 才保證會跑（雙擊 start.command 後直接關 Terminal 視窗 = HUP）
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

# 無人攤位：本腳本活著期間不准螢幕／系統休眠。-w：腳本結束（含被 kill）caffeinate 自己跟著結束，不用 cleanup。
if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -dimsu -w $$ &
else
  echo "找不到 caffeinate（非 macOS？）：螢幕可能會休眠" >&2
fi

# 3. 等後端起來
until curl -sf "$URL/api/settings" >/dev/null; do
  # 不用 kill -0：AERO_SUDO=1 時 LOOP_PID 是 root 的行程，一般使用者 kill -0 會因權限失敗
  ps -p "$LOOP_PID" >/dev/null 2>&1 || { echo "後端迴圈已結束" >&2; exit 1; }
  sleep 1
done

# 4. 開 kiosk（使用者身分）；腳本留著等後端迴圈，Ctrl-C 或結束時由 trap 收掉
open -na "Google Chrome" --args --kiosk --app="$URL" --autoplay-policy=no-user-gesture-required
wait "$LOOP_PID"
