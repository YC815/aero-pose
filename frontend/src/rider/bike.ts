// 公路車：原點 = 前後輪觸地中點，y 朝上，車頭朝 −z。本人右側（傳動側）= +x。
import * as THREE from 'three';

type YZ = { y: number; z: number };

const WHEEL_R = 0.34;
const TIRE_W = 0.025;
const WHEELBASE_HALF = 0.48;
const SEAT_ANGLE = (73.5 * Math.PI) / 180;
const HEAD_ANGLE = (73 * Math.PI) / 180;
const FORK_OFFSET = 0.045;

function along(p: YZ, angle: number, t: number): YZ {
  // 沿「往上、往後」的管子方向走 t
  return { y: p.y + t * Math.sin(angle), z: p.z + t * Math.cos(angle) };
}

const REAR: YZ = { y: WHEEL_R, z: WHEELBASE_HALF };
const FRONT: YZ = { y: WHEEL_R, z: -WHEELBASE_HALF };
const BB: YZ = { y: 0.27, z: WHEELBASE_HALF - 0.405 };
// 轉向軸：前輪軸往後偏 FORK_OFFSET（垂直於轉向軸）的那一點為起點
const STEER0: YZ = {
  y: FRONT.y - FORK_OFFSET * Math.cos(HEAD_ANGLE),
  z: FRONT.z + FORK_OFFSET * Math.sin(HEAD_ANGLE),
};
const SEAT_CLUSTER = along(BB, SEAT_ANGLE, 0.53);
const SADDLE_TOP = along(BB, SEAT_ANGLE, 0.678);
const FORK_CROWN = along(STEER0, HEAD_ANGLE, 0.37);
const HEAD_TOP = along(STEER0, HEAD_ANGLE, 0.6);
const STEERER_TOP = along(STEER0, HEAD_ANGLE, 0.63);
const STEM_LEN = 0.065;
const STEM_RISE = (15 * Math.PI) / 180;
const BAR: YZ = { y: STEERER_TOP.y + STEM_LEN * Math.sin(STEM_RISE), z: STEERER_TOP.z - STEM_LEN * Math.cos(STEM_RISE) };

/** 對外的幾何參數（root 座標）。 */
export const BIKE = {
  wheelR: WHEEL_R,
  tireW: TIRE_W,
  bb: BB,
  crank: 0.172,
  pedalX: 0.115, // 踏板中心離中線
  barWidth: 0.42,
  bar: BAR,
  saddleTop: SADDLE_TOP,
  /** 髖關節中點（坐在座墊上） */
  hipMid: { y: SADDLE_TOP.y + 0.08, z: SADDLE_TOP.z + 0.017 },
} as const;

export type Side = 'L' | 'R';

/** 踏板中心（root 座標）。angle 0 = 右曲柄朝正前方（3 點鐘），往前踩時角度增加（右腳往下）。 */
export function pedalPosition(side: Side, angle: number, out = new THREE.Vector3()): THREE.Vector3 {
  const a = side === 'R' ? angle : angle + Math.PI;
  const sx = side === 'R' ? 1 : -1;
  return out.set(sx * BIKE.pedalX, BB.y - BIKE.crank * Math.sin(a), BB.z - BIKE.crank * Math.cos(a));
}

export interface BikeMaterials {
  frame: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  tire: THREE.MeshStandardMaterial;
  rim: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  black: THREE.MeshStandardMaterial;
}

export function createBikeMaterials(): BikeMaterials {
  const mat = (color: number, roughness: number, metalness = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness });
  return {
    frame: mat(0x2e3238, 0.4, 0.5),
    accent: mat(0x5b6370, 0.35, 0.6),
    tire: mat(0x121212, 0.9),
    rim: mat(0x24272c, 0.4, 0.4),
    metal: mat(0xa7adb5, 0.3, 0.8),
    black: mat(0x101114, 0.6),
  };
}

const UP = new THREE.Vector3(0, 1, 0);

/** 兩點之間的圓管。 */
function tube(mat: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, r: number, rEnd = r, seg = 10): THREE.Mesh {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rEnd, r, d.length(), seg), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(UP, d.normalize());
  return m;
}

const v = (x: number, p: YZ) => new THREE.Vector3(x, p.y, p.z);

function wheel(m: BikeMaterials, c: YZ, name: string): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(0, c.y, c.z);
  const tire = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R - TIRE_W / 2, TIRE_W / 2, 8, 64), m.tire);
  tire.rotation.y = Math.PI / 2; // 輪面在 y-z 平面
  g.add(tire);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R - TIRE_W - 0.012, 0.012, 6, 48), m.rim);
  rim.rotation.y = Math.PI / 2;
  rim.scale.set(1, 1, 0.8);
  g.add(rim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 12), m.metal);
  hub.rotation.z = Math.PI / 2;
  g.add(hub);
  // 輻條：切向交叉編法，但都在輪面上（x = 0），正面投影藏在胎寬裡，不會把細線的取樣誤差算進面積
  const spokes = 20;
  const rimR = WHEEL_R - TIRE_W - 0.02;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const t = i % 2 === 0 ? 0.6 : -0.6;
    const hubP = new THREE.Vector3(0, 0.02 * Math.sin(a + t), 0.02 * Math.cos(a + t));
    const rimP = new THREE.Vector3(0, rimR * Math.sin(a), rimR * Math.cos(a));
    g.add(tube(m.metal, hubP, rimP, 0.0012, 0.0012, 3));
  }
  return g;
}

function handlebar(m: BikeMaterials): THREE.Group {
  const g = new THREE.Group();
  g.name = 'handlebar';
  g.position.set(0, BAR.y, BAR.z);
  const half = BIKE.barWidth / 2;
  g.add(tube(m.black, new THREE.Vector3(-half, 0, 0), new THREE.Vector3(half, 0, 0), 0.0125, 0.0125, 12));
  for (const sx of [-1, 1]) {
    const x = sx * half;
    // 彎把：往前、往下、再往後
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x, 0, 0),
      new THREE.Vector3(x, 0.003, -0.05),
      new THREE.Vector3(x, -0.025, -0.09),
      new THREE.Vector3(x, -0.08, -0.1),
      new THREE.Vector3(x, -0.12, -0.065),
      new THREE.Vector3(x, -0.13, 0.0),
      new THREE.Vector3(x, -0.128, 0.05),
    ]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.0125, 8), m.black));
    // 變把（握把套）
    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.045, 0.07), m.black);
    hood.position.set(x, 0.02, -0.075);
    hood.rotation.x = -0.25;
    g.add(hood);
    const top = new THREE.Group();
    top.name = sx < 0 ? 'barTop_L' : 'barTop_R'; // 本人左 = −x
    top.position.set(x, 0, 0);
    g.add(top);
  }
  return g;
}

export interface Bike {
  group: THREE.Group;
  setCrankAngle(rad: number): void;
}

export function createBike(m: BikeMaterials): Bike {
  const g = new THREE.Group();
  g.name = 'bike';

  g.add(wheel(m, REAR, 'wheel_rear'), wheel(m, FRONT, 'wheel_front'));

  // 車架
  g.add(tube(m.frame, v(0, BB), v(0, SEAT_CLUSTER), 0.016, 0.016)); // 座管
  g.add(tube(m.frame, v(0, along(STEER0, HEAD_ANGLE, 0.57)), v(0, SEAT_CLUSTER), 0.016, 0.015)); // 上管
  g.add(tube(m.frame, v(0, along(STEER0, HEAD_ANGLE, 0.4)), v(0, BB), 0.022, 0.02)); // 下管
  g.add(tube(m.frame, v(0, FORK_CROWN), v(0, HEAD_TOP), 0.022, 0.02)); // 頭管
  g.add(tube(m.accent, v(0, HEAD_TOP), v(0, STEERER_TOP), 0.016)); // 墊圈
  g.add(tube(m.accent, v(0, STEERER_TOP), v(0, BAR), 0.016)); // 龍頭
  for (const sx of [-1, 1]) {
    g.add(tube(m.frame, v(sx * 0.03, BB), v(sx * 0.065, REAR), 0.011, 0.008)); // 後下叉
    g.add(tube(m.frame, v(sx * 0.02, SEAT_CLUSTER), v(sx * 0.065, REAR), 0.009, 0.007)); // 後上叉
    g.add(tube(m.frame, v(sx * 0.042, FORK_CROWN), v(sx * 0.05, FRONT), 0.011, 0.008)); // 前叉
  }
  g.add(tube(m.frame, v(-0.048, FORK_CROWN), v(0.048, FORK_CROWN), 0.014)); // 前叉肩

  // 座桿、座墊
  g.add(tube(m.metal, v(0, SEAT_CLUSTER), v(0, along(BB, SEAT_ANGLE, 0.655)), 0.0135));
  const saddle = new THREE.Group();
  saddle.name = 'saddle';
  saddle.position.set(0, SADDLE_TOP.y - 0.018, SADDLE_TOP.z);
  const rear = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), m.black);
  rear.scale.set(0.07, 0.02, 0.07);
  rear.position.set(0, 0, 0.04);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), m.black);
  nose.scale.set(0.03, 0.018, 0.1);
  nose.position.set(0, 0, -0.05);
  saddle.add(rear, nose);
  g.add(saddle);

  g.add(handlebar(m));

  // 卡式飛輪（傳動側 +x）
  const cassette = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.035, 20), m.metal);
  cassette.rotation.z = Math.PI / 2;
  cassette.position.set(0.035, REAR.y, REAR.z);
  g.add(cassette);

  // 五通 + 曲柄組
  const bb = new THREE.Group();
  bb.name = 'bb';
  bb.position.set(0, BB.y, BB.z);
  g.add(bb);
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.07, 12), m.frame);
  shell.rotation.z = Math.PI / 2;
  bb.add(shell);
  const crank = new THREE.Group();
  crank.name = 'crank';
  bb.add(crank);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.005, 36), m.metal);
  ring.rotation.z = Math.PI / 2;
  ring.position.x = 0.045;
  crank.add(ring);
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.15, 8), m.metal);
  axle.rotation.z = Math.PI / 2;
  crank.add(axle);
  // 曲柄 0 時右曲柄朝 −z
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, BIKE.crank + 0.03), m.accent);
    arm.position.set(sx * 0.075, 0, (sx > 0 ? -1 : 1) * (BIKE.crank / 2));
    crank.add(arm);
  }

  const pedals: Record<Side, THREE.Group> = { L: new THREE.Group(), R: new THREE.Group() };
  for (const side of ['L', 'R'] as const) {
    const p = pedals[side];
    p.name = `pedal_${side}`;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.018, 0.07), m.black);
    p.add(body);
    g.add(p);
  }

  function setCrankAngle(rad: number): void {
    crank.rotation.x = -rad;
    pedalPosition('L', rad, pedals.L.position);
    pedalPosition('R', rad, pedals.R.position);
  }
  setCrankAngle(0);

  return { group: g, setCrankAngle };
}
