// 入口：WS frame → 全螢幕鏡像相機；skeleton → Recorder（retarget → tracker → 後台標準騎士計分）；
// Game 狀態機驅動 UI；RESULT 才把 3D 騎士放進結果頁重播這 10 秒，並 POST 成績。
import './style.css';
import { maskToImageData } from './area';
import { CameraView } from './camera';
import { Game } from './game';
import { createApi } from './net/api';
import { connectWS, defaultWsUrl } from './net/ws';
import { UPRIGHT_POSE } from './poses';
import { createMeasurer, createReplayView, poseForSample, replayPose } from './scene';
import { Recorder } from './recorder';
import { DEFAULT_SETTINGS, type GameState, type PlayerSkeleton, type SessionSummary, type Settings } from './types';
import { AttractScreen } from './ui/attract';
import { renderResultCard } from './ui/card';
import { Hud } from './ui/hud';
import { MaintenanceScreen } from './ui/maintenance';
import { ResultScreen, type ResultView } from './ui/result';
import { SettingsPanel } from './ui/settings';
import { keepScreenAwake } from './wakelock';
import { WindField } from './windfield';

const LEADERBOARD_INTERVAL_S = 30;
const HUD_INTERVAL_S = 0.1; // RECORDING 即時數字約 10 Hz
const CADENCE_RAD_S = 1.5 * 2 * Math.PI; // 重播時踩踏 90 rpm，純視覺
const SKELETON_STALE_S = 1; // 超過這麼久沒收到骨架，就當作沒有玩家
const DEV = new URLSearchParams(location.search).get('dev') === '1';

const clock = (): number => performance.now() / 1000;

// ---- 狀態（設定一律以伺服器的 settings 訊息為準） ----
let settings: Settings = { ...DEFAULT_SETTINGS };
let wsUp = false;
let cameraStatus: 'ok' | 'disconnected' = 'disconnected';
let player: PlayerSkeleton | null = null;
let playerAt = -Infinity;
let playerShown = false;
let nextBoard = 0;
let nextHud = 0;
let maintReason = '';
let replay: { summary: SessionSummary; startAt: number; crank: number } | null = null;

// 後台計分：標準騎士＋固定曲柄。坐直基準只算一次。
const measurer = createMeasurer();
const baseline = measurer.measure(UPRIGHT_POSE);
const recorder = new Recorder({
  baselineM2: baseline.areaM2,
  measure: (p) => measurer.measure(p).areaM2,
  settings: () => settings,
});

keepScreenAwake(); // 無人攤位：螢幕不能睡

// ---- 畫面圖層：相機（0）→ 風流（1）→ UI（10+）；3D 重播在結果頁的 replaySlot 裡 ----
const app = document.getElementById('app') as HTMLElement;
const cam = new CameraView(app);
const wind = new WindField(app, cam);
const attract = new AttractScreen(app);
const hud = new Hud(app);
const result = new ResultScreen(app);
const maintenance = new MaintenanceScreen(app);
const replayView = createReplayView(result.replaySlot);

// ---- 網路 ----
const api = createApi();

/** WS 的 settings 訊息在慢 client 可能被丟掉（佇列滿丟最舊），每次連上都用 REST 再拿一次。 */
function refreshSettings(): void {
  api.getSettings().then(
    (s) => {
      settings = { ...DEFAULT_SETTINGS, ...s };
      panel.setSettings(settings);
    },
    (e) => console.warn('讀取設定失敗，沿用目前設定', e),
  );
}

const ws = connectWS(defaultWsUrl(), {
  onOpen: () => {
    wsUp = true;
    refreshSettings();
    // 後端重啟或重連後預覽狀態會掉，面板開著就重新要
    if (panel.open) ws.send({ type: 'preview', on: true });
  },
  onClose: () => {
    wsUp = false;
    cameraStatus = 'disconnected';
    player = null; // 相機畫面停在最後一格，MAINTENANCE 會蓋上去
  },
  onMessage: (m) => {
    try {
      switch (m.type) {
        case 'frame':
          cam.setFrame(m);
          break;
        case 'skeleton':
          player = m.player;
          playerAt = clock();
          recorder.onSkeleton(m.player, playerAt);
          break;
        case 'status':
          cameraStatus = m.camera;
          break;
        case 'settings':
          settings = { ...DEFAULT_SETTINGS, ...m.settings };
          panel.setSettings(settings);
          break;
        case 'preview':
          if (panel.open) panel.setPreview(m);
          break;
      }
    } catch (e) {
      console.error('處理 WS 訊息失敗', e); // 無人顧：壞一幀不能讓整個畫面停
    }
  },
});

const panel = new SettingsPanel(app, { ws, api });

// ---- 狀態轉移 ----
const game = new Game(() => settings);
game.onTransition = (from, to) => enterUi(from, to);
enterUi(game.state, game.state);

function enterUi(from: GameState, to: GameState): void {
  if (to === 'ATTRACT') attract.show();
  else attract.hide();
  if (to === 'COUNTDOWN') hud.showCountdown();
  else if (to === 'RECORDING') hud.showRecording(settings.record_s);
  else hud.hide();
  if (to !== 'RESULT') {
    result.hide();
    replay = null;
  }
  if (to === 'MAINTENANCE') showMaintenance();
  else maintenance.hide();
  wind.setActive(to === 'COUNTDOWN' || to === 'RECORDING');
  cam.setDimmed(to === 'RESULT');

  if (to === 'ATTRACT') {
    playerShown = false;
    attract.setPlayerPresent(false);
    refreshBoard();
  }
  if (to === 'RECORDING') nextHud = 0;
  // 中止（玩家消失、斷線）不記成績；錄滿進 RESULT 才有 summary
  try {
    const summary = recorder.onTransition(from, to, game.recordElapsed, clock());
    if (summary) showResult(summary);
  } catch (e) {
    console.error('產生結果失敗', e); // 結果頁空白到 result_s 結束，之後回待機
  }
}

function maintText(): string {
  return wsUp ? '相機未連線，自動重試中' : '連不上後端程式，自動重連中';
}

function showMaintenance(): void {
  maintReason = maintText();
  maintenance.show(maintReason);
}

function refreshBoard(): void {
  nextBoard = clock() + LEADERBOARD_INTERVAL_S;
  api.getLeaderboard().then(
    (e) => attract.setLeaderboard(e, settings),
    () => {}, // 讀不到就保留舊的
  );
}

function showResult(summary: SessionSummary): void {
  const now = clock();
  const best = summary.samples[summary.bestIndex];
  const bestPose = poseForSample(summary.poses, best.t) ?? UPRIGHT_POSE;
  // frontalArea 的 mask 原樣給 card.ts（第 0 列在上、白色不透明；左右已是鏡像方向）
  const bestMask = maskToImageData(measurer.measure(bestPose), [255, 255, 255, 255]);

  const v: ResultView = { summary, bestMask, speedKmh: settings.speed_kmh };
  const id = result.show(v);
  replayView.resize(); // show() 之後版面才確定
  replay = { summary, startAt: now, crank: 0 };
  void submit(v, id);
}

async function submit(v: ResultView, id: number): Promise<void> {
  const s = v.summary;
  try {
    const png = await renderResultCard(v);
    const res = await api.postResult({
      area_m2: s.meanAreaM2,
      baseline_m2: s.baselineM2,
      watts_saved: s.meanWatts,
      png_b64: png,
    });
    result.setServerInfo({ number: res.number, rank: res.rank, qrUrl: res.qr_url }, id);
  } catch (e) {
    console.warn('送出結果失敗', e);
    result.setServerInfo(null, id); // 照常顯示結果，只是沒有名次和 QR
  }
  refreshBoard();
}

// ---- 每幀 ----
function stepAttract(now: number, fresh: PlayerSkeleton | null): void {
  if (playerShown !== (fresh !== null)) {
    playerShown = fresh !== null;
    attract.setPlayerPresent(playerShown);
  }
  if (playerShown) attract.setStartProgress(game.startProgress);
  if (now >= nextBoard) refreshBoard();
}

function stepRecording(now: number): void {
  const session = recorder.step(now, game.recordElapsed);
  if (!session) return;
  if (now < nextHud) return;
  nextHud = now + HUD_INTERVAL_S;
  hud.setWatts(session.latestWatts());
  hud.setTimeLeft(game.recordLeft);
  hud.setSamples(session.samples);
}

function stepReplay(now: number, dt: number): void {
  if (!replay) return;
  const { summary } = replay;
  const dur = summary.durationS > 0 ? summary.durationS : 1;
  const t = (now - replay.startAt) % dur;
  replayView.rider.setPose(replayPose(summary.poses, t) ?? UPRIGHT_POSE);
  replay.crank = (replay.crank + CADENCE_RAD_S * dt) % (2 * Math.PI);
  replayView.rider.setCrankAngle(replay.crank);
  replayView.render();
  result.setPlayhead(t);
}

function step(now: number, dt: number): void {
  const fresh = player && now - playerAt <= SKELETON_STALE_S ? player : null;
  const state = game.update({ now, player: fresh, cameraOk: wsUp && cameraStatus === 'ok' });

  if (state === 'ATTRACT') stepAttract(now, fresh);
  else if (state === 'COUNTDOWN') hud.setCountdown(game.countdownLeft);
  else if (state === 'RECORDING') stepRecording(now);
  else if (state === 'RESULT') stepReplay(now, dt);
  else if (state === 'MAINTENANCE' && maintReason !== maintText()) showMaintenance();

  wind.update(dt);
}

let last = clock();
function frame(): void {
  const now = clock();
  const dt = Math.min(0.1, Math.max(0, now - last));
  last = now;
  try {
    step(now, dt);
  } catch (e) {
    console.error('畫面更新失敗', e); // 無人顧：記下來，下一幀繼續
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- 鍵盤 ----
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyS') {
    e.preventDefault();
    if (!e.repeat) panel.toggle();
    return;
  }
  if (DEV && e.code === 'Space' && !e.repeat && !panel.open) {
    e.preventDefault();
    game.forceStart(clock());
  }
});
