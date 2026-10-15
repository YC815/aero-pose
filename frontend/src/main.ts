// 入口：WS 骨架 → retarget → 騎士；Game 狀態機驅動 UI；定格 → 面積 → 結果畫面 → POST。
import './style.css';
import { Game } from './game';
import { createApi } from './net/api';
import { connectWS, defaultWsUrl } from './net/ws';
import { AERO_DEMO_POSE, UPRIGHT_POSE } from './poses';
import { approachPose, lerpPose } from './retarget';
import { FREEZE_CRANK_ANGLE } from './rider';
import { alignMasks, createMeasurer, createScene, FREEZE_FRAMES, freezeResult } from './scene';
import { DEFAULT_SETTINGS, type GameState, type PlayerSkeleton, type RiderPose, type Settings } from './types';
import { AttractScreen } from './ui/attract';
import { renderResultCard } from './ui/card';
import { Hud } from './ui/hud';
import { MaintenanceScreen } from './ui/maintenance';
import { ResultScreen, type ResultView } from './ui/result';
import { SettingsPanel } from './ui/settings';
import { PoseTracker } from './tracker';
import { keepScreenAwake } from './wakelock';
import { Wind } from './wind';

const LIVE_AREA_INTERVAL_S = 0.25; // triangles() 每次約 430 KB，不准每幀算
const LEADERBOARD_INTERVAL_S = 30;
const DEMO_HALF_PERIOD_S = 4; // 示範動畫：坐直 → 趴低 4 秒，再回來 4 秒
const DEMO_TAU_S = 0.25; // 示範姿勢的平滑（從定格或玩家姿勢切回示範時不跳）
const CADENCE_RAD_S = 1.5 * 2 * Math.PI; // 90 rpm，純視覺
const SKELETON_STALE_S = 1; // 超過這麼久沒收到骨架，就當作沒有玩家
const DEV = new URLSearchParams(location.search).get('dev') === '1';
const FOLLOW: readonly GameState[] = ['READY', 'POSING', 'COUNTDOWN'];

const clock = (): number => performance.now() / 1000;

// ---- 3D ----
const app = document.getElementById('app') as HTMLElement;
const view = createScene(app);
const rider = view.rider;
const wind = new Wind();
view.scene.add(wind.object3d);
const measurer = createMeasurer();
const baseline = measurer.measure(UPRIGHT_POSE); // 坐直基準只算一次

// ---- 狀態（設定一律以伺服器的 settings 訊息為準） ----
let settings: Settings = { ...DEFAULT_SETTINGS };
let wsUp = false;
let camera: 'ok' | 'disconnected' = 'disconnected';
let player: PlayerSkeleton | null = null;
let playerAt = -Infinity;
const tracker = new PoseTracker(FREEZE_FRAMES); // 跟隨目標 + 定格緩衝（軀幹被擋的幀不算數）
let pose: RiderPose = UPRIGHT_POSE; // 畫面上騎士目前的姿勢
let crank = FREEZE_CRANK_ANGLE;
let demoT = 0;
let nextLiveArea = 0;
let nextBoard = 0;
let maintReason = '';

keepScreenAwake(); // 無人攤位：螢幕不能睡

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
    camera = 'disconnected';
    player = null;
  },
  onMessage: (m) => {
    try {
      switch (m.type) {
        case 'skeleton':
          onSkeleton(m.player);
          break;
        case 'status':
          camera = m.camera;
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

function onSkeleton(p: PlayerSkeleton | null): void {
  player = p;
  playerAt = clock();
  tracker.push(p, playerAt, settings.torso_gain);
}

// ---- UI ----
const attract = new AttractScreen(app);
const hud = new Hud(app);
const result = new ResultScreen(app);
const maintenance = new MaintenanceScreen(app);
const panel = new SettingsPanel(app, { ws, api });

const game = new Game(() => settings);
game.onTransition = (_from, to) => enterUi(to);
enterUi(game.state);

function enterUi(to: GameState): void {
  if (to === 'ATTRACT') attract.show();
  else attract.hide();
  hud.show(to); // READY / POSING / COUNTDOWN 以外等同 hide
  if (to !== 'RESULT') result.hide();
  if (to === 'MAINTENANCE') showMaintenance();
  else maintenance.hide();
  wind.setActive(to === 'POSING' || to === 'COUNTDOWN');

  if (to === 'ATTRACT') refreshBoard();
  if (to === 'READY') tracker.clear(); // 不讓上一位玩家的幀混進定格
  if (to === 'POSING') {
    hud.setLiveArea(null);
    nextLiveArea = 0;
  }
  if (to === 'RESULT') showResult();
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
    (e) => attract.setLeaderboard(e),
    () => {}, // 讀不到就保留舊的
  );
}

function showResult(): void {
  // 一幀有效姿勢都沒有（整段軀幹被擋）時用畫面上的姿勢：hold 過後它已經緩回坐直
  const r = freezeResult(tracker.recent, pose, measurer, baseline, settings);
  pose = r.pose;
  rider.setPose(pose);
  crank = FREEZE_CRANK_ANGLE;
  rider.setCrankAngle(crank);

  const masks = alignMasks(r.player, baseline);
  const v: ResultView = {
    playerMask: new ImageData(masks.a, masks.width, masks.height),
    baselineMask: new ImageData(masks.b, masks.width, masks.height),
    areaM2: r.areaM2,
    baselineM2: r.baselineM2,
    pct: r.pct,
    watts: r.watts,
    speedKmh: settings.speed_kmh,
  };
  const session = result.show(v);
  void submit(v, session);
}

async function submit(v: ResultView, session: number): Promise<void> {
  try {
    const png = await renderResultCard(v);
    const res = await api.postResult({
      area_m2: v.areaM2,
      baseline_m2: v.baselineM2,
      watts_saved: v.watts,
      png_b64: png,
    });
    result.setServerInfo({ number: res.number, rank: res.rank, qrUrl: res.qr_url }, session);
  } catch (e) {
    console.warn('送出結果失敗', e);
    result.setServerInfo(null, session); // 照常顯示結果，只是沒有名次和 QR
  }
  refreshBoard();
}

// ---- 每幀 ----
const smooth01 = (t: number): number => t * t * (3 - 2 * t);

function demoPose(dt: number): RiderPose {
  demoT += dt;
  const phase = (demoT % (2 * DEMO_HALF_PERIOD_S)) / DEMO_HALF_PERIOD_S;
  return lerpPose(UPRIGHT_POSE, AERO_DEMO_POSE, smooth01(phase < 1 ? phase : 2 - phase));
}

/** 即時面積（節流）：量測用騎士，曲柄固定，不受畫面上的踩踏影響。 */
function liveArea(now: number): number | null {
  if (now < nextLiveArea) return null;
  nextLiveArea = now + LIVE_AREA_INTERVAL_S;
  return measurer.measure(pose).areaM2;
}

function step(now: number, dt: number): void {
  const fresh = player && now - playerAt <= SKELETON_STALE_S ? player : null;
  const state = game.update({ now, player: fresh, cameraOk: wsUp && camera === 'ok' });

  if (state === 'ATTRACT') {
    pose = approachPose(pose, demoPose(dt), dt, DEMO_TAU_S);
    const a = liveArea(now);
    if (a !== null) attract.setLiveArea(a);
    if (now >= nextBoard) refreshBoard();
  } else if (FOLLOW.includes(state)) {
    // 軀幹被擋時先保留上一個有效姿勢 0.3 秒，之後 approachPose（τ = 0.1 s）緩回坐直
    pose = approachPose(pose, fresh ? tracker.target(now) : UPRIGHT_POSE, dt);
  } else if (state === 'MAINTENANCE') {
    pose = approachPose(pose, UPRIGHT_POSE, dt);
    if (maintReason !== maintText()) showMaintenance();
  }

  if (state === 'READY') hud.setStartProgress(game.startProgress);
  if (state === 'POSING') {
    hud.setStillProgress(game.stillProgress);
    hud.setPosingLeft(game.posingLeft);
    const a = liveArea(now);
    if (a !== null) hud.setLiveArea(a);
  }
  if (state === 'COUNTDOWN') hud.setCountdown(game.countdownLeft);

  // RESULT：姿勢和曲柄都定格，不動
  if (state !== 'RESULT') {
    rider.setPose(pose);
    crank = (crank + CADENCE_RAD_S * dt) % (2 * Math.PI);
    rider.setCrankAngle(crank);
  }
  wind.update(dt);
}

let last = clock();
function frame(): void {
  const now = clock();
  const dt = Math.min(0.1, Math.max(0, now - last));
  last = now;
  try {
    step(now, dt);
    view.render();
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
    game.forceCountdown(clock());
  }
});
