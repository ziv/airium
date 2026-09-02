import { describe, expect, it } from 'vitest';
import { attitudeFromHPR, hprFromAttitude, rotateBody } from './attitude';
import { cross, dot, toRadians } from './math3d';

const closeTo = (v: number, expected: number) => expect(v).toBeCloseTo(expected, 6);

describe('attitudeFromHPR', () => {
  it('points north and level for all-zero HPR', () => {
    const { forward, right, up } = attitudeFromHPR({ heading: 0, pitch: 0, roll: 0 });
    expect(forward).toEqual({ x: 0, y: 1, z: 0 });
    expect(right).toEqual({ x: 1, y: -0, z: 0 });
    expect(up).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('heading 90 points east', () => {
    const { forward } = attitudeFromHPR({ heading: toRadians(90), pitch: 0, roll: 0 });
    closeTo(forward.x, 1);
    closeTo(forward.y, 0);
  });

  it('positive pitch raises the nose', () => {
    const { forward } = attitudeFromHPR({ heading: 0, pitch: toRadians(30), roll: 0 });
    closeTo(forward.z, Math.sin(toRadians(30)));
  });

  it('positive roll dips the right wing', () => {
    const { right, up } = attitudeFromHPR({ heading: 0, pitch: 0, roll: toRadians(20) });
    expect(right.z).toBeLessThan(0);
    expect(up.x).toBeGreaterThan(0);
  });

  it('produces an orthonormal right-handed triad (up = right x forward)', () => {
    const att = attitudeFromHPR({ heading: 1.1, pitch: 0.4, roll: -0.7 });
    closeTo(dot(att.forward, att.right), 0);
    closeTo(dot(att.forward, att.up), 0);
    closeTo(dot(att.right, att.up), 0);
    const u = cross(att.right, att.forward);
    closeTo(u.x, att.up.x);
    closeTo(u.y, att.up.y);
    closeTo(u.z, att.up.z);
  });
});

describe('hprFromAttitude', () => {
  it('round-trips arbitrary angles', () => {
    const cases = [
      { heading: 0, pitch: 0, roll: 0 },
      { heading: toRadians(90), pitch: toRadians(10), roll: toRadians(-30) },
      { heading: toRadians(270), pitch: toRadians(-45), roll: toRadians(120) },
      { heading: toRadians(359), pitch: toRadians(60), roll: toRadians(-170) },
    ];
    for (const hpr of cases) {
      const back = hprFromAttitude(attitudeFromHPR(hpr));
      closeTo(back.heading, hpr.heading);
      closeTo(back.pitch, hpr.pitch);
      closeTo(back.roll, hpr.roll);
    }
  });
});

describe('rotateBody', () => {
  const level = attitudeFromHPR({ heading: 0, pitch: 0, roll: 0 });

  it('roll right increases roll', () => {
    const hpr = hprFromAttitude(rotateBody(level, 'roll', toRadians(15)));
    closeTo(hpr.roll, toRadians(15));
    closeTo(hpr.pitch, 0);
    closeTo(hpr.heading, 0);
  });

  it('pitch up increases pitch', () => {
    const hpr = hprFromAttitude(rotateBody(level, 'pitch', toRadians(15)));
    closeTo(hpr.pitch, toRadians(15));
    closeTo(hpr.roll, 0);
  });

  it('yaw right increases heading (clockwise)', () => {
    const hpr = hprFromAttitude(rotateBody(level, 'yaw', toRadians(15)));
    closeTo(hpr.heading, toRadians(15));
    closeTo(hpr.pitch, 0);
    closeTo(hpr.roll, 0);
  });

  it('pitching while banked 90 degrees changes heading, as in a real aircraft', () => {
    const banked = attitudeFromHPR({ heading: 0, pitch: 0, roll: toRadians(90) });
    const hpr = hprFromAttitude(rotateBody(banked, 'pitch', toRadians(10)));
    closeTo(hpr.heading, toRadians(10));
  });

  it('stays orthonormal after many small rotations', () => {
    let att = level;
    for (let i = 0; i < 5000; i++) {
      att = rotateBody(att, 'roll', 0.01);
      att = rotateBody(att, 'pitch', 0.007);
      att = rotateBody(att, 'yaw', -0.003);
    }
    closeTo(dot(att.forward, att.forward), 1);
    closeTo(dot(att.forward, att.right), 0);
    closeTo(dot(att.right, att.up), 0);
  });
});
