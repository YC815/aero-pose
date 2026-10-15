# 風阻姿勢大挑戰 v1 設計

2026-10-15 · 依據 `騎士姿勢大挑戰.md`（PRD）

## 0. 與 PRD 的差異（已確認）

- **攤位無人顧**：玩家全程零接觸，流程全自動；設定面板只在布置時使用。
- **排行榜不記名**：自動編號「騎士 #N」（N 為當天流水號），不提供暱稱輸入。
- **v1 即正式版**：今天用 webcam 開發，Orbbec Gemini 336L 的 source 今天一起寫完；明天插上相機、跑 `doctor` 通過後直接使用，不另做 v2。
- **加分功能納入 v1**：瓦數換算、結果圖 QR 下載（上傳公網，目標可設定）。
- **Gemini Runner 不在本機**：骨架偵測從頭寫，日後可替換。

## 1. 已拍板的決策

| 項目 | 決定 |
| --- | --- |
| 骨架輸入 | Python 後端 + MediaPipe PoseLandmarker（多人，`num_poses=3`）；source 可抽換：`webcam` / `orbbec` / `replay` |
| 跟動部位 | 軀幹（前傾、側彎、扭轉）、頭、雙肩、雙肘全跟，每個關節限角；腿鎖在踩踏 |
| 3D 騎士 | 程式產生幾何體（膠囊、橢球、方塊），175 cm / 70 kg；簡化公路車 |
| 前端 | Vite + TypeScript + Three.js + lil-gui，pnpm |
| 後端 | uv + Python 3.12 + FastAPI（REST + WebSocket），同時 serve 前端 build |
| 面積計算 | 前端 CPU 正交投影 + 三角形光柵化（不讀 GPU），算騎士 + 車 |
| 開始觸發 | 雙手腕高於鼻子，持續 `start_hold_s`（1 秒） |
| 定格觸發 | 全身靜止 `stillness_hold_s`（1.5 秒）→ 倒數；或擺姿勢滿 `posing_max_s`（20 秒）強制倒數 |
| QR | 結果 PNG 上傳到 S3 相容儲存（R2 等），QR 指向公網 URL；失敗就不顯示 QR |

## 2. 專案結構

```
whosmoreareo/
  backend/
    pyproject.toml
    src/aero/
      config.py         # Settings dataclass、settings.json 讀寫
      frame.py          # Frame、Intrinsics 型別
      sources/
        base.py         # FrameSource 介面
        webcam.py       # OpenCV
        orbbec.py       # pyorbbecsdk，color + depth D2C 對齊
        replay.py       # 讀 record.py 錄的資料夾
      pose.py           # MediaPipe → 每人 2D 關節 + world landmarks
      lift3d.py         # 關節 → 相機座標（公尺）
      tilt.py           # 相機座標 → 世界座標
      selector.py       # 挑玩家（距離 + 站位 + 黏著）
      filter.py         # One Euro filter
      pipeline.py       # source → pose → lift → tilt → select → filter，產生 SkeletonMsg
      uploader.py       # LocalUploader / S3Uploader
      results.py        # 排行榜 JSONL 存取
      server.py         # FastAPI app
      record.py         # CLI：錄製
      doctor.py         # CLI：相機自檢
    tests/
  frontend/
    package.json
    src/
      main.ts
      net/ws.ts         # 自動重連的 WebSocket client
      net/api.ts
      types.ts          # 與後端訊息對應的型別
      rider/body.ts     # 幾何體騎士 + 關節階層
      rider/bike.ts
      rider/legs.ts     # 雙骨 IK 踩踏
      retarget.ts       # 玩家關節 → 騎士關節角度（含限角）
      area.ts           # 投影 + 光柵化 → { areaM2, mask }
      wind.ts           # 藍色線條粒子
      game.ts           # 狀態機
      motion.ts         # 開始手勢、靜止偵測
      ui/attract.ts     # 待機吸客畫面
      ui/hud.ts         # 提示文字、倒數
      ui/result.ts      # 結果畫面 + 結果卡 PNG
      ui/leaderboard.ts
      ui/settings.ts    # lil-gui 面板 + 相機預覽
      ui/maintenance.ts
    tests/
  scripts/start.sh      # kiosk 一鍵啟動
  data/                 # gitignore：settings.json、results.jsonl、results/*.png、recordings/
```

## 3. 座標系

- **相機座標**（OpenCV）：x 右、y 下、z 前，單位公尺。
- **世界座標**：原點在相機正下方地板，**y 朝上**，z 從相機指向玩家，x 為相機視角的右方。
  `p_world = Rx(pitch) · flipY(p_cam) + (0, camera_height, 0)`；`camera_pitch_deg` 為鏡頭下俯角度（向下為正）。
- **騎士場景**（Three.js）：y 朝上，騎士面向 **−z**（面向前方攝影機）。玩家面向相機，玩家的「前方」在世界座標也是 −z，所以玩家的相對向量可以直接套用到騎士。
- 左右用**本人的**左右（MediaPipe 的 `left_*` 指本人左側）。
- **手性**：世界座標是相機座標翻轉 y 得到的，所以是左手系。retarget 全部在這個座標系用數值計算，自洽沒問題。
- **軀幹局部座標**（X = 本人左、Y = 脊椎向上、Z = 本人背後）：玩家直立面向相機時，等於世界座標軸。
- **騎士在 Three.js 裡**（右手系、面向 −z）：本人左 = −x、上 = +y、背後 = +z。所以軀幹局部向量套到騎士時，要把 **x 取負**。
- **畫面顯示要鏡像**：騎士外面包一層 `scale.x = −1` 的 group，玩家舉左手，螢幕左邊的手跟著舉。面積不受鏡像影響。

## 4. 後端

### 4.1 FrameSource

```python
class FrameSource(Protocol):
    def start(self) -> None: ...
    def read(self) -> Frame | None   # 逾時回傳 None
    def stop(self) -> None: ...

@dataclass
class Frame:
    rgb: np.ndarray                 # HxWx3 uint8
    depth_m: np.ndarray | None      # HxW float32，已對齊到 rgb，0 = 無效
    intrinsics: Intrinsics | None   # fx, fy, cx, cy（rgb 解析度）
    ts: float
```

- `webcam`：OpenCV `VideoCapture(index)`，`depth_m=None`；intrinsics 用 60° 水平 FOV 估算。
- `orbbec`：pyorbbecsdk（2.x），開 color 1280×720 與 depth stream，用 SDK 的 D2C 對齊把 depth 對到 color，單位轉成公尺。intrinsics 從 SDK 取 color 的內參。斷線時 `read()` 回傳 None，並每 2 秒嘗試重連。
- `replay`：讀 `data/recordings/<name>/`，含 `meta.json`（intrinsics、fps）與 `frames/000123.npz`（`rgb_jpeg` 為 JPEG bytes，`depth_mm` 為 uint16，`ts`），可循環播放。
- 套件為 `pyorbbecsdk2`（optional extra `orbbec`，有 macOS arm64 wheel）。macOS 上很可能要 root 才能開 UVC 裝置，詳見 `docs/orbbec.md`。

### 4.2 Pose → 3D

使用的關節（11 個）：`nose, left_ear, right_ear, left_shoulder, right_shoulder, left_elbow, right_elbow, left_wrist, right_wrist, left_hip, right_hip`。

`lift3d`：

- **有深度**：每個關節像素 (u, v) 取 7×7 鄰域中有效深度的中位數，再用內參反投影。
  - 軀幹深度 = 雙肩、雙髖四點深度的中位數。
  - 關節深度無效，或與軀幹深度差超過 0.6 m 時，改用「軀幹深度 + MediaPipe world landmark 的相對 z」。
- **無深度**：取 MediaPipe world landmarks（以髖中心為原點、y 下），翻成相機座標。人與相機的距離 d 用肩寬估計：`d ≈ fx · 0.38 / 肩寬像素`。

### 4.3 選人（selector）

- 候選人 = 所有偵測到的人。對每個人算：軀幹中心的世界座標、距離（軀幹 z）。
- 保留 `depth_near_m ≤ z ≤ depth_far_m`，且 `|x − zone_center_x_m| ≤ zone_half_width_m` 的人。
- **黏著**：如果上一幀的玩家仍在範圍內（軀幹中心距離 < 0.4 m），沿用他；否則挑 z 最小的人。
- 沒有合格的人 → `player=None`。

### 4.4 濾波

每個關節的 x、y、z 各自套 One Euro filter（`filter_min_cutoff`、`filter_beta`）。換人或失去追蹤時重設。

### 4.5 WebSocket `/ws`（後端 → 前端，JSON）

```jsonc
{ "type": "skeleton", "ts": 1728999999.12, "source": "webcam", "has_depth": false,
  "player": null | {
    "distance_m": 2.1,
    "joints": { "nose": [x, y, z], ... },        // 世界座標，公尺
    "visibility": { "nose": 0.98, ... } } }
{ "type": "status", "camera": "ok" | "disconnected", "fps": 29.7 }
{ "type": "settings", "settings": { ... } }      // 設定變更時廣播
{ "type": "preview", "jpeg_b64": "...", "persons": [ { "bbox": [...], "selected": true, "distance_m": 2.1 } ] }
```

- `skeleton` 每處理完一幀就推（目標 30 fps）。
- `status` 每秒推一次。
- `preview` 只在前端送出 `{"type":"preview","on":true}` 後才推，10 fps、寬 480，畫面上疊骨架和選中框。

### 4.6 REST

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| GET / PUT | `/api/settings` | 讀取 / 整份更新設定；PUT 後存檔並廣播 |
| GET | `/api/leaderboard?date=YYYY-MM-DD` | 當天依 `area_m2` 升冪前 10 名（預設今天，本機時區） |
| POST | `/api/results` | body：`{ area_m2, baseline_m2, watts_saved, png_b64 }` → 回 `{ id, number, rank, qr_url \| null }` |
| GET | `/r/{id}.png` | LocalUploader 的 fallback 檔案 |
| GET | `/*` | serve `frontend/dist` |

- `results.jsonl` 每行：`{ id, date, number, ts, area_m2, baseline_m2, watts_saved }`。
- `number` = 當天筆數 + 1。

### 4.7 Uploader

- `S3Uploader`：用 boto3 搭 S3 相容 endpoint。設定來自環境變數 `AERO_S3_ENDPOINT`、`AERO_S3_BUCKET`、`AERO_S3_KEY_ID`、`AERO_S3_SECRET`、`AERO_PUBLIC_BASE_URL`。逾時 5 秒，失敗回 None。
- `LocalUploader`：存 `data/results/{id}.png`，回 `http://<區網IP>:<port>/r/{id}.png`。
- 選擇規則：S3 環境變數齊全就用 S3，否則用 Local。圖片一律先存本機。

### 4.8 CLI

- `uv run aero serve --source webcam|orbbec|replay [--replay NAME] [--port 8000]`
- `uv run aero record --source orbbec --name NAME --seconds 20`
- `uv run aero doctor`：列出 Orbbec 裝置、開 color + depth、印內參與 fps、印畫面中心深度、存一張對齊後的疊圖到 `data/doctor.png`。每項印 PASS/FAIL。

## 5. 前端

### 5.1 騎士模型（175 cm / 70 kg）

節段長度依 Winter 人體比例（H = 1.75 m）：

| 節段 | 長度 | 形狀 |
| --- | --- | --- |
| 骨盆→肩中點 | 0.50 m | 胸廓橢球，寬 0.36、厚 0.22 |
| 肩寬（肩關節間距） | 0.40 m | |
| 頸 + 頭 | 頭中心距肩中點 0.25 m | 頭部橢球（含安全帽）約 0.20×0.26×0.24 |
| 上臂 | 0.31 m | 膠囊 r 0.045 |
| 前臂 | 0.26 m | 膠囊 r 0.038 |
| 手 | 0.10 m | 小方塊 |
| 大腿 | 0.43 m | 膠囊 r 0.075 |
| 小腿 | 0.43 m | 膠囊 r 0.055 |
| 腳 | 0.26 m | 方塊 |

- 關節階層：`pelvis → spine(torso) → neck → head`；`spine → shoulder_L/R → elbow_L/R → hand`；`pelvis → hip_L/R → knee → foot`。
- 公路車：700c 輪（半徑 0.34 m、胎寬 0.025 m）、車架管、彎把寬 0.42 m、座墊高度配合騎士。
- 腿：雙骨 IK，腳踩在踏板上。擺姿勢時曲柄轉動（純視覺）；**計算面積前固定在 3 點鐘方向**。
- **標準坐直姿勢**（基準）：軀幹與垂直夾 30°、頭自然、手握把上段、肘微彎。

### 5.2 Retarget（玩家 → 騎士）

全部在世界座標用相對向量計算，所以和玩家身高、距離無關。

| 騎士關節 | 來源 | 映射與限制 |
| --- | --- | --- |
| 軀幹前傾 | 髖中點→肩中點，與垂直線在 y-z 平面的夾角 p | `rider = 30° + 1.0·p`，限制在 [20°, 88°] |
| 軀幹側彎 | 同一向量在 x-y 平面 | ±15° |
| 軀幹扭轉 | 肩線與髖線在 x-z 平面的夾角 | ±20° |
| 頭 | 耳中點→鼻，轉到軀幹局部座標的俯仰／左右 | 騎士俯仰 = 玩家相對俯仰 + 30°（抵銷軀幹基準前傾，讓坐直時眼睛看前方），限制在 [−40°, +70°]；左右 ±30° |
| 上臂 | 肩→肘方向，轉到軀幹局部座標後直接套用 | 限制在錐形範圍：前舉 0–170°、側展 −10°–80° |
| 肘 | 肩–肘–腕夾角 | 屈曲 [0°, 150°] |

- 關節 visibility < 0.5 時，該節段慢慢回到坐直預設值（0.3 秒）。
- `player=null` 時整體慢慢回到坐直預設值。

### 5.3 面積計算（area.ts）

- 輸入：騎士 + 車所有 mesh 的世界座標三角形。
- 正交投影到 x-y 平面（從正前方看）。
- 在包住投影的網格上光柵化（格寬 4 mm，以格中心判斷覆蓋），數覆蓋格數 × 格面積 = `areaM2`。
- 輸出 `{ areaM2, mask, bounds }`；mask 同時拿來畫結果畫面的正面輪廓。
- 純函式，不依賴 WebGL，可以在 vitest 跑。
- 校正目標：標準坐直姿勢（騎士 + 車）落在 **0.45–0.55 m²**；全趴低（軀幹 85°、手臂前伸）**≤ 0.38 m²**。

### 5.4 瓦數

`ΔP = ½ · ρ · Cd · (A_base − A) · v³`，ρ = `air_density`（1.225）、Cd = `cd`（0.8）、v = `speed_kmh`/3.6。結果畫面寫「時速 40 公里時大約省下 X 瓦（估算）」；ΔP 為負時寫「多花 X 瓦」。

### 5.5 遊戲狀態機

```
ATTRACT ──(有玩家)──▶ READY ──(雙手舉高 1 秒)──▶ POSING
POSING ──(靜止 1.5 秒 或 滿 20 秒)──▶ COUNTDOWN(3 秒) ──▶ RESULT(12 秒)
RESULT ──(時間到)──▶ 有玩家 ? READY : ATTRACT
READY / POSING / COUNTDOWN 失去玩家超過 lost_timeout_s(3 秒) ──▶ ATTRACT
任何狀態收到 camera=disconnected ──▶ MAINTENANCE；恢復後 ──▶ ATTRACT
```

- **ATTRACT**：示範動畫（騎士在坐直和趴低之間循環，即時面積數字跟著變）、今日排行榜、提示「站到膠帶上，雙手舉高開始」、免責小字。
- **READY**：騎士開始跟動，提示「雙手舉過頭開始」，顯示進度圈。
- **POSING**：風粒子開啟，提示「擺出最低風阻的姿勢，停住不動就開始倒數」，角落即時顯示面積。
- **COUNTDOWN**：大字 3、2、1，不可取消。定格姿勢 = 最後 10 幀 retarget 後關節角度的平均。
- **RESULT**：
  - 正面輪廓（玩家藍、坐直基準灰，兩者疊在一起）
  - 面積 m²、比坐直少 X%、瓦數、今日名次、QR（有的話）
  - 一句解釋：「身體越低越窄，迎面要推開的空氣越少」
  - 免責文字：「姿勢比較用，不是風洞量測」
  - 同時把結果卡 PNG（1080×1350）送到 `POST /api/results`
- **開始手勢**：左右手腕的 y 都比鼻子高 0.05 m 以上。
- **靜止**：前 0.5 秒內所有可見關節的平均速度 < `stillness_speed_mps`（0.15）。

### 5.6 風粒子

約 600 條藍色短線段，從騎士前方遠處往 +z 流動，經過騎士後回收。靠近騎士時沿著騎士包圍橢球外推，看起來像氣流繞開身體。只在 POSING 和 COUNTDOWN 顯示。

### 5.7 設定面板

- 開啟方式：`Ctrl+Shift+S`，路人按不到。
- lil-gui 滑桿：所有 settings 欄位。
- 面板旁顯示相機預覽，疊上骨架、選中框，以及距離範圍、站位區。
- 改了就 PUT，後端存檔並廣播。

### 5.8 斷線與容錯

- WS 斷線：每秒重連，畫面顯示 MAINTENANCE。
- `POST /api/results` 失敗：照常顯示結果，只是沒有名次和 QR。

## 6. Settings（`data/settings.json`，含預設值）

```json
{
  "depth_near_m": 1.5, "depth_far_m": 3.0,
  "zone_center_x_m": 0.0, "zone_half_width_m": 0.6,
  "camera_height_m": 1.2, "camera_pitch_deg": 0.0,
  "filter_min_cutoff": 1.0, "filter_beta": 0.05,
  "start_hold_s": 1.0, "stillness_speed_mps": 0.15, "stillness_hold_s": 1.5,
  "posing_max_s": 20, "countdown_s": 3, "result_s": 12, "lost_timeout_s": 3,
  "torso_gain": 1.0,
  "cd": 0.8, "speed_kmh": 40, "air_density": 1.225
}
```

前後端共用同一份 schema（後端 `config.py` 為準，前端 `types.ts` 對應）。缺欄位時補預設值，多的欄位忽略。

## 7. 部署（kiosk）

`scripts/start.sh`：

1. `pnpm --dir frontend build`（dist 不存在或比 src 舊時才 build）
2. 背景用 `until` 迴圈跑 `uv run aero serve --source $AERO_SOURCE`，崩潰 2 秒後重啟
3. 等 `/api/settings` 可連，再用 Chrome `--kiosk` 開 `http://localhost:8000`

## 8. 測試

- **pytest**：
  - `tilt`：已知角度的轉換
  - `lift3d`：合成深度圖反投影、無效深度 fallback
  - `selector`：多人、範圍外、黏著
  - `filter`：靜止時收斂
  - `results`：排名、日期篩選、流水號
  - `uploader`：S3 用 mock、失敗回 None
  - `server`：REST 與 WS，用 TestClient + fake source
  - `orbbec`：mock pyorbbecsdk 測轉換和重連邏輯
  - `replay` 端到端
- **vitest**：
  - `retarget`：直立 → 坐直預設、前傾 45° → 75°、限角生效
  - `area`：單位正方形 = 1 m²、圓形誤差 < 1%、坐直基準落在 0.45–0.55、趴低 ≤ 0.38
  - `motion`：開始手勢、靜止判定
  - `game`：狀態轉移（注入假時間）
- **無法自動驗證**：Orbbec 真機（明天用 `doctor`）、MediaPipe 實際偵測品質、視覺效果。

## 9. 已知風險

- pyorbbecsdk 的 macOS 支援與 USB 權限：今天確認安裝方式；真機行為要明天驗證。
- webcam 沒有深度，前傾角度只能靠 MediaPipe 估，今天的「準度」不代表明天。
- MediaPipe 多人模式在筆電上的 fps：如果低於 20，改成單人模式加 ROI。
