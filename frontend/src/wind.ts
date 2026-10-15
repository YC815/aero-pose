import * as THREE from 'three';

// 風粒子：每顆粒子是一條沿 +z 流動的短線段，靠近騎士包圍橢球時往外繞開。
// 世界座標（spec §3）：騎士面向 −z，所以風從 z=−4 吹向 z=+3。

const Z_START = -4;
const Z_END = 3;
const X_RANGE = 1.2;
const Y_MIN = 0;
const Y_MAX = 2;
const LEN_MIN = 0.15;
const LEN_MAX = 0.35;
const SPEED_MIN = 4;
const SPEED_MAX = 7;
const FADE_S = 0.4;
/** 影響範圍（以橢球正規化半徑計）：超過這個距離就不偏折。 */
const INFLUENCE = 2.2;
/** 流場兩端的淡入淡出距離，避免粒子突然出現或消失。 */
const EDGE_FADE_M = 0.8;
const COLOR = new THREE.Color('#38bdf8');
const TAIL_GAIN = 0.08;

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export class Wind {
  readonly object3d: THREE.Object3D;

  private readonly count: number;
  private readonly lines: THREE.LineSegments;
  private readonly material: THREE.LineBasicMaterial;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  // 每顆粒子未偏折的「直線流」位置（線頭）
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly len: Float32Array;
  private readonly speed: Float32Array;
  private readonly bright: Float32Array;
  /** 正中央粒子（法線在 xy 平面退化）時用的備援繞開方向。 */
  private readonly sideAngle: Float32Array;

  private readonly center = new THREE.Vector3(0, 1.0, 0);
  private readonly radii = new THREE.Vector3(0.35, 0.65, 0.9);
  private opacity = 0;
  private target = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(count = 600) {
    this.count = count;
    this.px = new Float32Array(count);
    this.py = new Float32Array(count);
    this.pz = new Float32Array(count);
    this.len = new Float32Array(count);
    this.speed = new Float32Array(count);
    this.bright = new Float32Array(count);
    this.sideAngle = new Float32Array(count);
    this.positions = new Float32Array(count * 6);
    this.colors = new Float32Array(count * 6);

    for (let i = 0; i < count; i++) this.respawn(i, rand(Z_START, Z_END));

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geom.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.lines = new THREE.LineSegments(geom, this.material);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 10;
    this.lines.visible = false;
    this.object3d = this.lines;
    this.writeBuffers();
  }

  /** 騎士包圍橢球（世界座標中心與三軸半徑，公尺）。 */
  setObstacle(center: THREE.Vector3, radii: THREE.Vector3): void {
    this.center.copy(center);
    this.radii.set(Math.max(radii.x, 1e-3), Math.max(radii.y, 1e-3), Math.max(radii.z, 1e-3));
  }

  /** 開關風：opacity 在 0.4 秒內淡入或淡出。 */
  setActive(on: boolean): void {
    this.target = on ? 1 : 0;
  }

  update(dt: number): void {
    const step = Math.min(Math.max(dt, 0), 0.1); // 分頁切回來時別一口氣跳太遠
    const rate = step / FADE_S;
    this.opacity = this.target > this.opacity
      ? Math.min(this.target, this.opacity + rate)
      : Math.max(this.target, this.opacity - rate);
    this.material.opacity = this.opacity;
    this.lines.visible = this.opacity > 0.001;
    if (!this.lines.visible) return;

    for (let i = 0; i < this.count; i++) {
      this.pz[i] += this.speed[i] * step;
      if (this.pz[i] - this.len[i] > Z_END) this.respawn(i, Z_START);
    }
    this.writeBuffers();
  }

  private respawn(i: number, z: number): void {
    this.px[i] = rand(-X_RANGE, X_RANGE);
    this.py[i] = rand(Y_MIN, Y_MAX);
    this.pz[i] = z;
    this.len[i] = rand(LEN_MIN, LEN_MAX);
    this.speed[i] = rand(SPEED_MIN, SPEED_MAX);
    this.bright[i] = rand(0.45, 1);
    this.sideAngle[i] = rand(0, Math.PI * 2);
  }

  private writeBuffers(): void {
    const pos = this.positions;
    const col = this.colors;
    for (let i = 0; i < this.count; i++) {
      const o = i * 6;
      const headZ = this.pz[i];
      const tailZ = headZ - this.len[i];
      this.deflect(i, headZ, this.tmp);
      pos[o] = this.tmp.x;
      pos[o + 1] = this.tmp.y;
      pos[o + 2] = this.tmp.z;
      this.deflect(i, tailZ, this.tmp);
      pos[o + 3] = this.tmp.x;
      pos[o + 4] = this.tmp.y;
      pos[o + 5] = this.tmp.z;

      // 線頭亮、線尾暗（加法混合下暗 = 透明），兩端淡出
      const edge = smoothstep(Z_START, Z_START + EDGE_FADE_M, tailZ) * (1 - smoothstep(Z_END - EDGE_FADE_M, Z_END, headZ));
      const head = this.bright[i] * edge;
      const tail = head * TAIL_GAIN;
      col[o] = COLOR.r * head;
      col[o + 1] = COLOR.g * head;
      col[o + 2] = COLOR.b * head;
      col[o + 3] = COLOR.r * tail;
      col[o + 4] = COLOR.g * tail;
      col[o + 5] = COLOR.b * tail;
    }
    const geom = this.lines.geometry;
    geom.attributes.position.needsUpdate = true;
    geom.attributes.color.needsUpdate = true;
  }

  /**
   * 把粒子 i 在 z 處的直線流位置推離橢球。
   * 只在垂直風向的 xy 平面上往外推（橢球外側方向），看起來像氣流從身體兩側和上方繞過；
   * 推移量讓 xy 正規化距離變成 sqrt(dxy² + 1.1)，所以橢球內的點一定被推到表面外，
   * 再乘上依 3D 正規化距離的衰減，INFLUENCE 以外完全不偏折。
   */
  private deflect(i: number, z: number, out: THREE.Vector3): void {
    const x = this.px[i];
    const y = this.py[i];
    out.set(x, y, z);
    const c = this.center;
    const r = this.radii;
    const qx = (x - c.x) / r.x;
    const qy = (y - c.y) / r.y;
    const qz = (z - c.z) / r.z;
    const d = Math.sqrt(qx * qx + qy * qy + qz * qz);
    if (d >= INFLUENCE) return;

    const fade = 1 - smoothstep(1, INFLUENCE, d);
    let dxy = Math.hypot(qx, qy);
    let ux: number;
    let uy: number;
    if (dxy < 1e-4) {
      // 正對中心：用粒子自己的備援方向，避免所有線擠在同一側
      ux = Math.cos(this.sideAngle[i]);
      uy = Math.sin(this.sideAngle[i]);
      dxy = 0;
    } else {
      ux = qx / dxy;
      uy = qy / dxy;
    }
    const push = (Math.sqrt(dxy * dxy + 1.1) - dxy) * fade;
    out.x += ux * push * r.x;
    out.y += uy * push * r.y;
  }
}
