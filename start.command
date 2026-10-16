#!/bin/bash
# Finder 雙擊啟動風阻姿勢大挑戰。改用一般攝影機：把 orbbec 改成 webcam、AERO_SUDO 改成 0。
# 會先問一次電腦密碼（Orbbec 在 macOS 要 root）。結束：Ctrl-C 或關掉這個視窗。
# 進階選項（預設都不用動）：AERO_ORBBEC_ALIGN=hw（硬體對齊）、AERO_ORBBEC_DEPTH=low、AERO_POSE_DELEGATE=gpu，見 README。
cd "$(dirname "$0")"
export AERO_SOURCE="${AERO_SOURCE:-orbbec}"
export AERO_SUDO="${AERO_SUDO:-1}"
exec scripts/start.sh
