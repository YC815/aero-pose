// 3D 世界：畫面上的場景（WebGL），以及不上畫面的「量測用騎士」。
// 量測區段是純函式，不碰 DOM / WebGL，可以在 vitest 跑（tests/integration.test.ts）。

import * as THREE from 'three';
import { frontalArea, type AreaResult } from './area';
import { averagePoses } from './retarget';
import { createRider, FREEZE_CRANK_ANGLE, type Rider } from './rider';
import type { RiderPose, Settings } from './types';
import { wattsSaved } from './watts';

// ---------------- 量測（純函式） ----------------

/** 定格姿勢 = 最後幾幀 retarget 結果的平均（spec §5.5）。 */
export const FREEZE_FRAMES = 10;

export interface Measurer {
  /** 用固定曲柄角（3 點鐘）量正面面積；不影響畫面上的騎士。 */
  measure(pose: RiderPose): AreaResult;
}

/**
 * 量測用騎士不放進場景、沒有鏡像（triangles() 不論是 root 局部或世界座標，這裡兩者相同）。
 * triangles() 回傳的 buffer 可能被下次呼叫重複使用，所以拿到就立刻交給 frontalArea，不保留。
 * mask 的第 0 欄 = 最小 x = 騎士本人左側，畫成圖片時本人左側在圖的左邊，
 * 剛好和 3D 畫面（外包 scale.x = −1 的鏡像）方向一致，不用再翻。
 * 曲柄永遠固定，所以畫面上騎士在踩踏也不會讓即時面積跳動。
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

export interface FreezeResult {
  pose: RiderPose;
  player: AreaResult;
  areaM2: number;
  baselineM2: number;
  /** (base − area) / base · 100 */
  pct: number;
  watts: number;
}

/** 定格：平均最後 FREEZE_FRAMES 幀（沒有就用 fallback）→ 面積 → 瓦數。 */
export function freezeResult(
  recent: RiderPose[],
  fallback: RiderPose,
  measurer: Measurer,
  baseline: AreaResult,
  s: Pick<Settings, 'cd' | 'speed_kmh' | 'air_density'>,
): FreezeResult {
  const pose = recent.length > 0 ? averagePoses(recent.slice(-FREEZE_FRAMES)) : fallback;
  const player = measurer.measure(pose);
  const base = baseline.areaM2;
  return {
    pose,
    player,
    areaM2: player.areaM2,
    baselineM2: base,
    pct: base > 0 ? ((base - player.areaM2) / base) * 100 : 0,
    watts: wattsSaved(base, player.areaM2, s),
  };
}

export interface AlignedMasks {
  width: number;
  height: number;
  /** RGBA，覆蓋 = 白色不透明，其餘全 0（透明）；第 0 列在上。 */
  a: Uint8ClampedArray<ArrayBuffer>;
  b: Uint8ClampedArray<ArrayBuffer>;
}

/**
 * 把兩張 mask 畫到同一個 bounds（兩者 bounds 的聯集），輸出同尺寸 RGBA。
 * ui/card.ts 的 drawSilhouettes 會把兩張各自水平置中、底部對齊；
 * 先對齊成同尺寸，單車在兩張圖裡就一定疊在同一個位置。
 */
export function alignMasks(a: AreaResult, b: AreaResult): AlignedMasks {
  if (Math.abs(a.cell - b.cell) > 1e-12) throw new Error('兩張 mask 的格寬不同');
  const cell = a.cell;
  const parts = [a, b].filter((m) => m.width > 0 && m.height > 0);
  if (parts.length === 0) {
    return { width: 1, height: 1, a: new Uint8ClampedArray(4), b: new Uint8ClampedArray(4) };
  }
  const minX = Math.min(...parts.map((m) => m.minX));
  const maxY = Math.max(...parts.map((m) => m.maxY));
  const maxX = Math.max(...parts.map((m) => m.minX + m.width * cell));
  const minY = Math.min(...parts.map((m) => m.maxY - m.height * cell));
  const width = Math.round((maxX - minX) / cell);
  const height = Math.round((maxY - minY) / cell);

  const paint = (m: AreaResult): Uint8ClampedArray<ArrayBuffer> => {
    const out = new Uint8ClampedArray(width * height * 4);
    const dx = Math.round((m.minX - minX) / cell);
    const dy = Math.round((maxY - m.maxY) / cell);
    for (let j = 0; j < m.height; j++) {
      const row = (j + dy) * width + dx;
      for (let i = 0; i < m.width; i++) {
        if (!m.mask[j * m.width + i]) continue;
        out.fill(255, (row + i) * 4, (row + i) * 4 + 4);
      }
    }
    return out;
  };
  return { width, height, a: paint(a), b: paint(b) };
}

// ---------------- 畫面（只在瀏覽器用） ----------------

export interface Scene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  rider: Rider;
  render(): void;
}

const BG = 0x040a17;

export function createScene(container: HTMLElement): Scene {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(BG);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.Fog(BG, 6, 14);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 50);
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

  const grid = new THREE.GridHelper(20, 40, 0x1e3a5f, 0x0f2240);
  scene.add(grid);

  // 鏡像：玩家舉左手，螢幕左邊的手跟著舉（spec §3）。面積用量測騎士算，不受影響。
  const mirror = new THREE.Group();
  mirror.scale.x = -1;
  scene.add(mirror);
  const rider = createRider();
  mirror.add(rider.root);

  function resize(): void {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  return {
    renderer,
    scene,
    camera,
    rider,
    render: () => renderer.render(scene, camera),
  };
}
