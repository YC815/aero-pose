// 3D 世界：不上畫面的「量測用騎士」（後台計分），以及結果頁的騎士重播（WebGL）。
// 量測與重播取樣是純函式，不碰 DOM / WebGL，可以在 vitest 跑（tests/integration.test.ts）。

import * as THREE from 'three';
import { frontalArea, type AreaResult } from './area';
import { lerpPose } from './retarget';
import { createRider, FREEZE_CRANK_ANGLE, type Rider } from './rider';
import type { RiderPose } from './types';

// ---------------- 量測（純函式） ----------------

export interface Measurer {
  /** 用固定曲柄角（3 點鐘）量正面面積；不影響畫面上的騎士。 */
  measure(pose: RiderPose): AreaResult;
}

/**
 * 量測用騎士不放進場景、沒有鏡像。
 * triangles() 回傳的 buffer 可能被下次呼叫重複使用，所以拿到就立刻交給 frontalArea，不保留。
 * 騎士本人左側在 root 局部座標的 −x，所以 mask 第 0 欄（最小 x）= 本人左側：
 * 原樣畫成圖片就已經是鏡像方向（本人左側在圖的左邊），和 3D 重播（外包 scale.x = −1）一致。
 */
export function createMeasurer(): Measurer {
  const rider = createRider();
  return {
    measure(pose) {
      rider.setPose(pose);
      rider.setCrankAngle(FREEZE_CRANK_ANGLE);
      return frontalArea(rider.triangles());
    },
  };
}

export interface TimedPose {
  t: number;
  pose: RiderPose;
}

const T_EPS = 1e-6; // 和 session.ts 的取樣誤差一致

/** 第一個 t ≥ target 的索引（poses 依 t 非遞減）；全部都比 target 早就回 poses.length。 */
function lowerBound(poses: readonly TimedPose[], target: number): number {
  let lo = 0;
  let hi = poses.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (poses[mid].t < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * 取樣點 t 當下被 measure 的那個 pose：RecordingSession 在第一個跨過取樣點的 push 量測，
 * 所以是第一個 t ≥ 取樣時間的 pose。找不到（不該發生）就用最後一個。
 */
export function poseForSample(poses: readonly TimedPose[], sampleT: number): RiderPose | null {
  if (poses.length === 0) return null;
  const i = lowerBound(poses, sampleT - T_EPS);
  return poses[Math.min(i, poses.length - 1)].pose;
}

/** 重播：t 秒時的姿勢，前後兩筆線性內插；超出範圍就夾到頭尾。 */
export function replayPose(poses: readonly TimedPose[], t: number): RiderPose | null {
  const n = poses.length;
  if (n === 0) return null;
  const i = lowerBound(poses, t);
  if (i === 0) return poses[0].pose;
  if (i >= n) return poses[n - 1].pose;
  const a = poses[i - 1];
  const b = poses[i];
  const span = b.t - a.t;
  return span <= T_EPS ? b.pose : lerpPose(a.pose, b.pose, (t - a.t) / span);
}

// ---------------- 結果頁的騎士重播（只在瀏覽器用） ----------------

export interface ReplayView {
  rider: Rider;
  /** 依 container 目前尺寸重設 renderer 與相機；container 是 0×0 時不動。 */
  resize(): void;
  render(): void;
}

const FOG = 0x040a17;
const MIN_HFOV_DEG = 35; // 窄長的格子也要放得下整台車

/**
 * 透明背景的 renderer，canvas 放進 container（結果頁的 replaySlot）。
 * 只有呼叫 render() 才畫，所以其他狀態不花 GPU。
 */
export function createReplayView(container: HTMLElement): ReplayView {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(FOG, 6, 14);

  const camera = new THREE.PerspectiveCamera(MIN_HFOV_DEG, 1, 0.05, 50);
  camera.position.set(1.6, 1.4, -3.2);
  camera.lookAt(0, 0.9, 0);

  scene.add(new THREE.HemisphereLight(0xbfdcff, 0x0b1426, 0.9));
  scene.add(new THREE.AmbientLight(0xffffff, 0.25));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(2, 4, -3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x38bdf8, 1.2);
  rim.position.set(-2, 2.5, 3);
  scene.add(rim);
  scene.add(new THREE.GridHelper(20, 40, 0x1e3a5f, 0x0f2240));

  // 鏡像：玩家舉左手，螢幕左邊的手跟著舉（spec §3）。面積用量測騎士算，不受影響。
  const mirror = new THREE.Group();
  mirror.scale.x = -1;
  scene.add(mirror);
  const rider = createRider();
  mirror.add(rider.root);

  let w = 0;
  let h = 0;
  function resize(): void {
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (cw <= 0 || ch <= 0 || (cw === w && ch === h)) return;
    w = cw;
    h = ch;
    renderer.setSize(w, h, false); // CSS 尺寸由 .ap-result__slot > * 決定
    camera.aspect = w / h;
    // 垂直 FOV 至少 35°，格子偏直式時加大，讓水平 FOV 也至少 35°
    const half = (MIN_HFOV_DEG / 2) * (Math.PI / 180);
    camera.fov = Math.max(MIN_HFOV_DEG, (2 * Math.atan(Math.tan(half) / camera.aspect) * 180) / Math.PI);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(container);
  resize();

  return {
    rider,
    resize,
    render: () => {
      if (w > 0 && h > 0) renderer.render(scene, camera);
    },
  };
}
