import { describe, expect, it } from 'vitest';
import { bearing, enuOffset, groundDistance, headingError, offsetLatLon } from './geo';
import { toRadians } from './math3d';

const R = 6_371_000;

describe('geo', () => {
  it('measures offsets, distances and bearings on the flat-earth frame', () => {
    const a = { lat: 32, lon: 35 };
    const b = offsetLatLon(a, 1000, 2000, R);
    const o = enuOffset(a, b, R);
    expect(o.x).toBeCloseTo(1000, 3);
    expect(o.y).toBeCloseTo(2000, 3);
    expect(groundDistance(a, b, R)).toBeCloseTo(Math.hypot(1000, 2000), 3);
    expect(bearing(a, b, R)).toBeCloseTo(Math.atan2(1000, 2000));
    expect(bearing(a, offsetLatLon(a, -10, 0, R), R)).toBeCloseTo(toRadians(270));
  });

  it('includes height and wraps the antimeridian', () => {
    const o = enuOffset(
      { lat: 0, lon: 179.99, height: 100 },
      { lat: 0, lon: -179.99, height: 250 },
      R,
    );
    expect(o.x).toBeCloseTo(0.02 * (Math.PI / 180) * R, 0);
    expect(o.z).toBe(150);
    expect(offsetLatLon({ lat: 0, lon: 179.999 }, 1000, 0, R).lon).toBeLessThan(-179.9);
  });

  it('gives the short way round for heading errors', () => {
    expect(headingError(toRadians(350), toRadians(10))).toBeCloseTo(toRadians(20));
    expect(headingError(toRadians(10), toRadians(350))).toBeCloseTo(toRadians(-20));
    expect(headingError(0, Math.PI)).toBeCloseTo(Math.PI);
  });
});
