#!/usr/bin/env node
/**
 * Generates a low-poly fighter jet as a binary glTF (public/models/jet.glb).
 *
 * The geometry is built here from a handful of extruded convex polygons, so
 * the game does not depend on any third-party asset. glTF conventions: +Y up,
 * +Z forward, +X left, metres. The origin sits roughly at the centre of
 * gravity, which is where the simulation places the aircraft.
 *
 * Usage: node scripts/make-jet-model.mjs [output.glb]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const out = process.argv[2] ?? 'public/models/jet.glb';

/** Flat-shaded triangle soup per material. */
class Mesh {
  constructor() {
    this.positions = [];
    this.normals = [];
  }

  /** Adds one solid: a convex polygon `poly` (2D, counter-clockwise) extruded from w0 to w1. */
  extrude(poly, w0, w1, map) {
    const top = poly.map(([u, v]) => map(u, v, w1));
    const bottom = poly.map(([u, v]) => map(u, v, w0));
    const all = [...top, ...bottom];
    const centroid = all
      .reduce((c, p) => [c[0] + p[0], c[1] + p[1], c[2] + p[2]], [0, 0, 0])
      .map((c) => c / all.length);
    const n = poly.length;
    for (let i = 1; i < n - 1; i++) {
      this.tri(top[0], top[i], top[i + 1], centroid);
      this.tri(bottom[0], bottom[i + 1], bottom[i], centroid);
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.tri(top[i], bottom[i], bottom[j], centroid);
      this.tri(top[i], bottom[j], top[j], centroid);
    }
  }

  /** A box centred at (x, y, z) with the given full extents. */
  box([x, y, z], [sx, sy, sz]) {
    const hx = sx / 2;
    const hy = sy / 2;
    this.extrude(
      [
        [-hx, -hy],
        [hx, -hy],
        [hx, hy],
        [-hx, hy],
      ],
      z - sz / 2,
      z + sz / 2,
      (u, v, w) => [x + u, y + v, w],
    );
  }

  /** Winding is fixed so the face normal points away from the solid's centroid. */
  tri(a, b, c, centroid) {
    let normal = cross(sub(b, a), sub(c, a));
    const len = Math.hypot(...normal);
    if (len < 1e-9) return;
    normal = normal.map((x) => x / len);
    if (dot(normal, sub(a, centroid)) < 0) {
      [b, c] = [c, b];
      normal = normal.map((x) => -x);
    }
    for (const p of [a, b, c]) {
      this.positions.push(...p);
      this.normals.push(...normal);
    }
  }
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

// ---------------------------------------------------------------------------
// Geometry. All numbers are metres; the jet is ~15 m long with a 9.5 m span.
// ---------------------------------------------------------------------------

const body = new Mesh();
const glass = new Mesh();
const dark = new Mesh();

// Nose cone: pyramid from the tip to the front bulkhead.
body.extrude(
  [
    [-0.7, -0.6],
    [0.7, -0.6],
    [0.7, 0.6],
    [-0.7, 0.6],
  ],
  4.6,
  7.6,
  (u, v, w) => {
    const t = (7.6 - w) / 3; // 0 at the tip, 1 at the bulkhead
    return [u * Math.max(t, 0.05), v * Math.max(t, 0.05) + 0.1 * (1 - t), w];
  },
);
// Main fuselage.
body.extrude(
  [
    [-0.75, -0.7],
    [0.75, -0.7],
    [0.85, 0.3],
    [0.35, 0.8],
    [-0.35, 0.8],
    [-0.85, 0.3],
  ],
  -6,
  4.6,
  (u, v, w) => [u, v, w],
);
// Spine behind the canopy.
body.box([0, 0.9, -2.5], [0.7, 0.4, 5]);
// Tail cone with the nozzle.
body.extrude(
  [
    [-0.75, -0.7],
    [0.75, -0.7],
    [0.85, 0.3],
    [0.35, 0.8],
    [-0.35, 0.8],
    [-0.85, 0.3],
  ],
  -7.4,
  -6,
  (u, v, w) => {
    const t = (w + 7.4) / 1.4;
    const s = 0.7 + 0.3 * t;
    return [u * s, v * s, w];
  },
);
dark.box([0, 0, -7.55], [1.1, 1.1, 0.4]);

// Canopy.
glass.extrude(
  [
    [-0.45, 0.8],
    [0.45, 0.8],
    [0.4, 1.35],
    [-0.4, 1.35],
  ],
  1.0,
  4.4,
  (u, v, w) => {
    const t = Math.min(1, (w - 1.0) / 0.9); // taper the rear
    const front = Math.min(1, (4.4 - w) / 1.2); // and the front
    const h = 0.8 + (v - 0.8) * Math.min(1, 0.35 + 0.65 * Math.min(t, front));
    return [u, h, w];
  },
);

// Intake under the belly.
dark.extrude(
  [
    [-0.55, -1.25],
    [0.55, -1.25],
    [0.6, -0.7],
    [-0.6, -0.7],
  ],
  -1,
  3.2,
  (u, v, w) => [u, v, w],
);

// Wings: trapezoids swept back, extruded in Y (thickness).
const wing = (side) =>
  body.extrude(
    [
      [0.8, 1.2],
      [0.8, -4.6],
      [4.75, -4.3],
      [4.75, -2.6],
    ].map(([x, z]) => [side * x, z]),
    -0.1,
    0.1,
    (x, z, y) => [x, y, z],
  );
wing(1);
wing(-1);

// Horizontal stabilisers.
const stab = (side) =>
  body.extrude(
    [
      [0.7, -4.9],
      [0.7, -7.3],
      [2.8, -7.4],
      [2.8, -6.4],
    ].map(([x, z]) => [side * x, z]),
    -0.06,
    0.06,
    (x, z, y) => [x, y + 0.1, z],
  );
stab(1);
stab(-1);

// Vertical tail, extruded in X.
body.extrude(
  [
    [-3.6, 1.0],
    [-7.2, 1.0],
    [-7.4, 3.6],
    [-6.2, 3.6],
  ],
  -0.06,
  0.06,
  (z, y, x) => [x, y, z],
);

// Wingtip missile rails.
const rail = (side) => dark.box([side * 4.75, 0, -3.2], [0.2, 0.2, 2.8]);
rail(1);
rail(-1);

// ---------------------------------------------------------------------------
// GLB packing.
// ---------------------------------------------------------------------------

const materials = [
  {
    name: 'airframe',
    pbrMetallicRoughness: {
      baseColorFactor: [0.62, 0.65, 0.68, 1],
      metallicFactor: 0.4,
      roughnessFactor: 0.6,
    },
  },
  {
    name: 'canopy',
    pbrMetallicRoughness: {
      baseColorFactor: [0.08, 0.12, 0.18, 1],
      metallicFactor: 0.8,
      roughnessFactor: 0.2,
    },
  },
  {
    name: 'dark',
    pbrMetallicRoughness: {
      baseColorFactor: [0.16, 0.16, 0.17, 1],
      metallicFactor: 0.6,
      roughnessFactor: 0.5,
    },
  },
];

const parts = [body, glass, dark];
const buffers = [];
const bufferViews = [];
const accessors = [];
const primitives = [];
let byteOffset = 0;

function pushBuffer(data, target) {
  const padded = (data.byteLength + 3) & ~3;
  const view = { buffer: 0, byteOffset, byteLength: data.byteLength, target };
  bufferViews.push(view);
  const bytes = new Uint8Array(padded);
  bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  buffers.push(bytes);
  byteOffset += padded;
  return bufferViews.length - 1;
}

parts.forEach((mesh, materialIndex) => {
  const positions = new Float32Array(mesh.positions);
  const normals = new Float32Array(mesh.normals);
  const count = positions.length / 3;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i * 3 + k]);
      max[k] = Math.max(max[k], positions[i * 3 + k]);
    }
  }
  const posView = pushBuffer(positions, 34962);
  const nrmView = pushBuffer(normals, 34962);
  accessors.push({ bufferView: posView, componentType: 5126, count, type: 'VEC3', min, max });
  accessors.push({ bufferView: nrmView, componentType: 5126, count, type: 'VEC3' });
  primitives.push({
    attributes: { POSITION: accessors.length - 2, NORMAL: accessors.length - 1 },
    material: materialIndex,
    mode: 4,
  });
});

const json = {
  asset: { version: '2.0', generator: 'airium scripts/make-jet-model.mjs' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: 'jet' }],
  meshes: [{ name: 'jet', primitives }],
  materials,
  accessors,
  bufferViews,
  buffers: [{ byteLength: byteOffset }],
};

const jsonBytes = Buffer.from(JSON.stringify(json));
const jsonPadded = Buffer.alloc((jsonBytes.length + 3) & ~3, 0x20);
jsonBytes.copy(jsonPadded);
const bin = Buffer.concat(buffers.map((b) => Buffer.from(b)));

const header = Buffer.alloc(12);
header.write('glTF', 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + bin.length, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(jsonPadded.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4); // JSON
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(bin.length, 0);
binHeader.writeUInt32LE(0x004e4942, 4); // BIN

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([header, jsonHeader, jsonPadded, binHeader, bin]));
const triangles = parts.reduce((n, m) => n + m.positions.length / 9, 0);
console.log(`wrote ${out}: ${triangles} triangles, ${header.readUInt32LE(8)} bytes`);
