import type { PlayerSkeleton } from './types';

const VIS = 0.5;

/** 開始手勢：雙手腕都比鼻子高 margin 以上，且兩手腕與鼻都可見。 */
export function handsUp(sk: PlayerSkeleton, margin = 0.05): boolean {
  const v = sk.visibility;
  if (v.nose < VIS || v.left_wrist < VIS || v.right_wrist < VIS) return false;
  const limit = sk.joints.nose[1] + margin;
  return sk.joints.left_wrist[1] > limit && sk.joints.right_wrist[1] > limit;
}
