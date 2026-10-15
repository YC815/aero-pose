# 風阻姿勢大挑戰

無人顧的攤位遊戲：相機追蹤路人的上半身，螢幕上的 3D 公路車手（鏡像）跟著動，停住不動就定格，
算出正面面積，和「一般坐直騎」比較，排進今日排行榜。

- 設計：`docs/superpowers/specs/2026-10-15-aero-pose-v1-design.md`
- Orbbec 相機：`docs/orbbec.md`
- 後端：`backend/`（uv、Python 3.12、FastAPI、MediaPipe）
- 前端：`frontend/`（pnpm、Vite、TypeScript、Three.js）

## 今天：用 webcam

第一次執行 macOS 會要求相機權限，請允許給執行的終端機（或 Chrome 以外跑後端的程式）。

```bash
AERO_SOURCE=webcam scripts/start.sh
```

腳本做的事：

1. `frontend/dist` 不存在或比 `frontend/src` 舊，就 `pnpm build`。
2. 背景跑後端 `aero serve`，崩潰 2 秒後自動重啟。
3. 等 `http://localhost:8000/api/settings` 回應後，用 Chrome kiosk 開 `http://localhost:8000`。
4. Ctrl-C 結束腳本時會一起收掉後端。

只想手動跑後端：

```bash
cd frontend && pnpm build
cd ../backend && uv run aero serve --source webcam     # 預設 port 8000
```

其他 source：`AERO_SOURCE=replay AERO_REPLAY=<名稱> scripts/start.sh`（讀 `data/recordings/<名稱>`，
用 `uv run aero record --source webcam --name <名稱> --seconds 20` 錄）。

## 明天：換 Orbbec Gemini 336L

依序做，前一步沒過不要往下：

1. 讀 `docs/orbbec.md`（安裝、macOS 要 root、USB 3 線材、症狀對照表）。
2. 關掉 OrbbecViewer 等其他會開相機的程式；相機接 USB 3 埠。
3. 裝 SDK：`cd backend && uv sync --extra orbbec`
4. 自檢：`sudo backend/.venv/bin/aero doctor`
   - 每項都要 `[PASS]`；看一眼 `data/doctor.png` 的彩色與深度疊圖有沒有對齊。
   - 不用 sudo 試一次：如果不加 sudo 也全部 PASS，下一步就不用 `AERO_SUDO=1`。
5. 啟動：`AERO_SOURCE=orbbec AERO_SUDO=1 scripts/start.sh`（不需要 root 時拿掉 `AERO_SUDO=1`）
6. 開設定面板（`Ctrl+Shift+S`）看相機預覽，調相機高度、俯仰、站位區、距離範圍，讓站在膠帶上的人被選中（✔）。

### `AERO_SUDO=1` 的細節與後果

- 腳本會先 `sudo -v` 問一次密碼，再用 sudo 跑**整個後端重啟迴圈**（直接執行 `backend/.venv/bin/aero`，不經過 `uv`，
  所以 uv cache 不會變 root 擁有）。所有 `AERO_*` 環境變數會帶進 root 的環境。
- `pnpm build` 和 Chrome 一律用目前使用者身分跑，不會變 root。
- 腳本在背景每 60 秒續期一次 sudo 快取，結束時才能用 sudo 收掉 root 的後端。
  萬一沒收乾淨：`sudo pkill -f '.venv/bin/aero serve'`
- **後端用 root 寫的檔案會變成 root 擁有**：`data/settings.json`、`data/results.jsonl`、`data/results/*.png`、
  `data/models/`。後果是之後不用 sudo 跑（例如回到 webcam）時，後端存不了設定和成績。
  腳本正常結束時會自動 `chown` 回目前使用者；如果是被強制中斷或當機，手動修：

  ```bash
  sudo chown -R "$(id -un)" data
  ```

## 設定面板與快捷鍵

| 按鍵 | 作用 |
| --- | --- |
| `Ctrl+Shift+S` | 開關設定面板（相機預覽、偵測範圍、遊戲節奏、瓦數換算參數）。改完放開滑桿就存到 `data/settings.json` 並廣播給所有畫面。 |
| 空白鍵 | 只在網址加 `?dev=1` 時有效：READY / POSING 時直接開始倒數。 |

- 設定以伺服器為準：面板在讀到伺服器設定之前會鎖住，不會拿預設值蓋掉。
- 後端或 WebSocket 斷線時畫面顯示「設備調整中」，每秒自動重連，恢復後回到待機畫面。

## 結果圖 QR（S3 相容儲存，選用）

五個環境變數都設了才會上傳到 S3 相容儲存（例如 Cloudflare R2）；缺任何一個就存在本機，
QR 指向 `http://<區網 IP>:8000/r/<id>.png`（手機要和電腦在同一個網路）。

| 變數 | 說明 |
| --- | --- |
| `AERO_S3_ENDPOINT` | S3 endpoint URL，例如 `https://<account>.r2.cloudflarestorage.com` |
| `AERO_S3_BUCKET` | bucket 名稱 |
| `AERO_S3_KEY_ID` | access key id |
| `AERO_S3_SECRET` | secret access key |
| `AERO_PUBLIC_BASE_URL` | 公開網址前綴，QR 會指向 `<前綴>/results/<id>.png` |

其他：`AERO_DATA_DIR` 可以把 `data/` 換到別的地方。

## 開發與測試

```bash
cd backend && uv run pytest -q
cd frontend && pnpm test && pnpm build
```

前端開發：後端照常跑在 8000，另開 `cd frontend && pnpm dev`（Vite 會把 `/api`、`/ws`、`/r` 代理到 8000）。
