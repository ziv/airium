import { describe, expect, it } from 'vitest';
import { attitudeFromHPR } from '../sim/attitude';
import { normalize, toRadians, vec3 } from '../sim/math3d';
import { type Viewport, clampToEdge, focalLength, projectDirection } from './projection';

const vp: Viewport = { width: 1600, height: 900, fov: toRadians(60) };
const pose = attitudeFromHPR({ heading: toRadians(90), pitch: 0, roll: 0 });

describe('projectDirection', () => {
  it('puts the boresight at the centre of the screen', () => {
    const p = projectDirection(pose.forward, pose, vp);
    expect(p.visible).toBe(true);
    expect(p.x).toBeCloseTo(800);
    expect(p.y).toBeCloseTo(450);
  });

  it('applies the fov to the wider dimension', () => {
    // 30° right of the boresight lands on the right edge when the horizontal fov is 60°.
    const right = normalize(vec3(Math.sin(toRadians(120)), Math.cos(toRadians(120)), 0));
    const p = projectDirection(right, pose, vp);
    expect(p.x).toBeCloseTo(1600, 5);
    expect(p.y).toBeCloseTo(450);
    expect(focalLength(vp)).toBeCloseTo(800 / Math.tan(toRadians(30)));
  });

  it('puts directions above the nose above the centre and marks the rear as not visible', () => {
    const up = normalize(vec3(1, 0, 0.5));
    const p = projectDirection(up, pose, vp);
    expect(p.y).toBeLessThan(450);
    expect(p.x).toBeCloseTo(800);
    const behind = projectDirection(vec3(-1, 0, 0.1), pose, vp);
    expect(behind.visible).toBe(false);
    expect(behind.y).toBeLessThan(0);
  });

  it('rolls with the camera', () => {
    const rolled = attitudeFromHPR({ heading: toRadians(90), pitch: 0, roll: toRadians(90) });
    // The world "up" direction appears to the left when rolled 90° right.
    const p = projectDirection(normalize(vec3(1, 0, 0.3)), rolled, vp);
    expect(p.x).toBeLessThan(800);
    expect(p.y).toBeCloseTo(450);
  });
});

describe('clampToEdge', () => {
  it('leaves on-screen points alone', () => {
    const p = clampToEdge({ x: 900, y: 500 }, vp, 40);
    expect(p).toMatchObject({ x: 900, y: 500, clamped: false });
  });

  it('moves off-screen points to the edge along the line from the centre', () => {
    const p = clampToEdge({ x: 3200, y: 450 }, vp, 40);
    expect(p.clamped).toBe(true);
    expect(p.x).toBeCloseTo(1560);
    expect(p.y).toBeCloseTo(450);
    expect(p.angle).toBeCloseTo(0);
    const q = clampToEdge({ x: 800, y: -2000 }, vp, 40);
    expect(q.y).toBeCloseTo(40);
    expect(q.angle).toBeCloseTo(Math.PI / 2);
  });
});
