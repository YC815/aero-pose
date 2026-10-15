import { describe, expect, it } from 'vitest';
import { wattsSaved } from '../src/watts';

const s = { cd: 0.8, speed_kmh: 40, air_density: 1.225 };

describe('wattsSaved', () => {
  it('½ρ·Cd·ΔA·v³', () => {
    expect(Math.abs(wattsSaved(0.5, 0.4, s) - 67.2)).toBeLessThan(0.5);
  });
  it('面積比基準大時為負', () => {
    expect(wattsSaved(0.5, 0.6, s)).toBeLessThan(0);
  });
  it('面積相同為 0', () => {
    expect(wattsSaved(0.5, 0.5, s)).toBe(0);
  });
});
