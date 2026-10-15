import * as THREE from 'three';
import { UPRIGHT_POSE } from '../poses';
import type { RiderPose } from '../types';
import { BIKE, createBike, createBikeMaterials, pedalPosition } from './bike';
import { BODY, createBody, createRiderMaterials } from './body';
import { ANKLE_FROM_PEDAL, createLeg } from './legs';

export interface Rider {
  root: THREE.Group; // 騎士 + 車，原點 = 前後輪觸地中點，y 朝上，騎士面向 -z
  setPose(p: RiderPose): void;
  setCrankAngle(rad: number): void; // 0 = 右腳曲柄朝正前方（3 點鐘）
  triangles(): Float32Array; // 所有 mesh 的世界座標三角形（每三角形 9 個 float）
  setBodyColor(hex: number): void;
}

/** 計算面積前曲柄固定的角度（3 點鐘）。 */
export const FREEZE_CRANK_ANGLE = 0;

export function createRider(): Rider {
  const riderMats = createRiderMaterials();
  const root = new THREE.Group();
  root.name = 'rider';

  const bike = createBike(createBikeMaterials());
  root.add(bike.group);

  const body = createBody(riderMats);
  body.pelvis.position.set(0, BIKE.hipMid.y, BIKE.hipMid.z);
  root.add(body.pelvis);

  const legs = [
    { side: 'L' as const, leg: createLeg('L', riderMats, new THREE.Vector3(-BODY.hipHalf, 0, 0)) },
    { side: 'R' as const, leg: createLeg('R', riderMats, new THREE.Vector3(BODY.hipHalf, 0, 0)) },
  ];
  for (const { leg } of legs) body.pelvis.add(leg.hip);

  const target = new THREE.Vector3();
  function setCrankAngle(rad: number): void {
    bike.setCrankAngle(rad);
    for (const { side, leg } of legs) {
      // pelvis 沒有旋轉：root 座標減掉 pelvis 位置就是 pelvis 局部座標
      pedalPosition(side, rad, target).add(ANKLE_FROM_PEDAL).sub(body.pelvis.position);
      leg.solve(target);
    }
  }

  function triangles(): Float32Array {
    root.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    let count = 0;
    root.traverseVisible((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const g = o.geometry as THREE.BufferGeometry;
      meshes.push(o);
      count += g.index ? g.index.count : g.attributes.position.count;
    });
    const out = new Float32Array(count * 3);
    const p = new THREE.Vector3();
    let k = 0;
    for (const mesh of meshes) {
      const g = mesh.geometry as THREE.BufferGeometry;
      const pos = g.attributes.position;
      const idx = g.index;
      const n = idx ? idx.count : pos.count;
      for (let i = 0; i < n; i++) {
        p.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(mesh.matrixWorld);
        out[k++] = p.x;
        out[k++] = p.y;
        out[k++] = p.z;
      }
    }
    return out;
  }

  body.setPose(UPRIGHT_POSE);
  setCrankAngle(FREEZE_CRANK_ANGLE);

  return {
    root,
    setPose: (p) => body.setPose(p),
    setCrankAngle,
    triangles,
    setBodyColor: (hex) => riderMats.jersey.color.setHex(hex),
  };
}
