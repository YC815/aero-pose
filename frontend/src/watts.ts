import type { Settings } from './types';

/** 省下的功率（W）：½ρ·Cd·(A_base − A)·v³，v 由 km/h 換成 m/s。面積比基準大時為負。 */
export function wattsSaved(
  baselineM2: number,
  areaM2: number,
  s: Pick<Settings, 'cd' | 'speed_kmh' | 'air_density'>,
): number {
  const v = s.speed_kmh / 3.6;
  return 0.5 * s.air_density * s.cd * (baselineM2 - areaM2) * v ** 3;
}
