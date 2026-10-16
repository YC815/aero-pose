# 風阻姿勢大挑戰（aero-pose）

無人顧的攤位遊戲。玩法：

1. 螢幕是全螢幕的鏡像相機畫面，站到地上的膠帶，**雙手舉高 1 秒**開始。
2. 倒數 3、2、1，藍色的風開始從螢幕前方往畫面深處吹。
3. 錄製 10 秒：風打到身體的地方變紅（紅色迎風面）；頂部即時顯示「省 X 瓦」和剩餘秒數。趴低、縮小，紅色就變少。
4. 結果頁：左邊是標準 3D 騎士重播你這 10 秒的動作，右邊是瓦數曲線（遊標和重播同步）、10 秒平均省幾瓦、
   比坐直平均少幾 %、今日名次、QR（下載成績卡）。
5. 玩家中途離開超過 3 秒就中止、不記成績；結果頁顯示 `result_s` 秒後回待機。

計分：後台的標準騎士每 0.1 秒套用一次你當下的姿勢，算正面面積，和「一般坐直騎」比較換算成瓦數；
10 秒共 101 個樣本，平均就是成績，排進今日排行榜。

- 設計：`docs/superpowers/specs/2026-10-15-aero-pose-v1-design.md`，v1.1 改動見
  `docs/superpowers/specs/2026-10-16-aero-v1.1-dynamic-design.md`
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
5. 啟動：在 Finder 雙擊 `start.command`（等於 `AERO_SOURCE=orbbec AERO_SUDO=1 scripts/start.sh`，會問一次密碼；
   不需要 root 時把檔案裡的 `AERO_SUDO` 改成 0）
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

## 效能選項與 perf log

後端每 5 秒寫一行各階段耗時（中位數 ms）與頻率，實機找瓶頸看這行：

```
perf 5s | camera 30.0Hz step 30.0Hz sent 30.0Hz | wait 2.1 align 8.3 decode 1.6 depth 0.6 read 12.9 age 0.1 detect 21.2 post 0.3 render 5.3 ms
```

- `camera`：讀幀 thread 拿到幾幀；`step`：姿勢辨識幾步；`sent`：推給前端幾張畫面（上限 30）。
- `wait / align / decode / depth`：Orbbec 等幀、軟體對齊、MJPG 解碼、深度轉換；`read` 是一幀總共；`age` 是幀等多久才被辨識。
- `detect`：MediaPipe；`post`：3D、選人、濾波；`render`：畫面 JPEG。
- `step` 跟不上 `camera` 就是辨識太慢；`camera` 低於 30 就看 `align`。

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `AERO_PERF_LOG_S` | `5` | perf log 間隔秒數，0 = 關 |
| `AERO_ORBBEC_ALIGN` | `sw` | `hw` = 相機硬體對齊，省掉 CPU 上的 `align`；這組 color profile 不支援會自動退回 `sw`（看啟動 log 的 `align=`） |
| `AERO_ORBBEC_DEPTH` | `default` | `low` = 同 fps 最小解析度的深度（深度只用在關節附近取樣），軟體對齊比較快 |
| `AERO_POSE_DELEGATE` | `cpu` | `gpu` = MediaPipe 用 Metal；建立或推論失敗自動退回 CPU。M3 實測：連續跑 7.8 ms，但照相機 30Hz 節奏呼叫要 20–31 ms，比 CPU 的 21 ms 還慢，所以預設關 |

用法：寫在 `start.command` 的 `exec` 前面，例如 `export AERO_ORBBEC_ALIGN=hw`。

## 人沒動、數字在跳：`aero jitter`

錄一段趴低不動的影片，再分析每個關節的抖動來源（寬限期幀、visibility 穿越、深度用估值的比例、軀幹俯仰跳動）：

```
sudo backend/.venv/bin/aero record --source orbbec --name still --seconds 10
backend/.venv/bin/aero jitter --replay still
```

結果怎麼讀、對應怎麼處理見 `docs/優化待辦.md`。

## 設定面板與快捷鍵

| 按鍵 | 作用 |
| --- | --- |
| `Ctrl+Shift+S` | 開關設定面板（相機預覽、偵測範圍、遊戲節奏含錄製秒數 `record_s`、瓦數換算參數）。改完放開滑桿就存到 `data/settings.json` 並廣播給所有畫面。 |
| 空白鍵 | 只在網址加 `?dev=1` 時有效：待機時跳過舉手，直接開始倒數（鏡頭前仍要有人，否則 3 秒後判定離開而中止）。 |

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

## 授權

[MIT](LICENSE)
