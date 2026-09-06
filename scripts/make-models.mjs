#!/usr/bin/env node
/**
 * Generates the game's low-poly models as binary glTF files in public/models:
 * a fighter jet, a SAM launcher, a supply truck and a patrol boat.
 *
 * The geometry is built here from extruded convex polygons, so the game does
 * not depend on any third-party asset. glTF conventions: +Y up, +Z forward,
 * +X left, metres. Each origin sits at the point the simulation places the
 * entity at (centre of gravity for the jet, ground level for the rest).
 *
 * Usage: node scripts/make-models.mjs [output directory]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2] ?? 'public/models';

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
// Materials shared by all models.
// ---------------------------------------------------------------------------

const material = (name, rgb, metallic, roughness) => ({
  name,
  pbrMetallicRoughness: {
    baseColorFactor: [...rgb, 1],
    metallicFactor: metallic,
    roughnessFactor: roughness,
  },
});
const AIRFRAME = material('airframe', [0.62, 0.65, 0.68], 0.4, 0.6);
const CANOPY = material('canopy', [0.08, 0.12, 0.18], 0.8, 0.2);
const DARK = material('dark', [0.16, 0.16, 0.17], 0.6, 0.5);
const OLIVE = material('olive', [0.36, 0.4, 0.26], 0.2, 0.8);
const SAND = material('sand', [0.6, 0.55, 0.4], 0.1, 0.9);
const HULL = material('hull', [0.5, 0.52, 0.55], 0.3, 0.6);
const DECK = material('deck', [0.75, 0.75, 0.72], 0.1, 0.8);

// ---------------------------------------------------------------------------
// Jet (~15 m long, 9.5 m span), origin at the centre of gravity.
// ---------------------------------------------------------------------------

function jet() {
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

  return [
    [body, AIRFRAME],
    [glass, CANOPY],
    [dark, DARK],
  ];
}

// ---------------------------------------------------------------------------
// SAM launcher: a tracked chassis with a tilted box of four tubes; origin on
// the ground under the centre, launcher facing +Z.
// ---------------------------------------------------------------------------

function sam() {
  const chassis = new Mesh();
  const launcher = new Mesh();
  const tracks = new Mesh();
  chassis.box([0, 1.2, 0], [3.2, 1.2, 7]);
  tracks.box([1.9, 0.5, 0], [0.8, 1.0, 7.2]);
  tracks.box([-1.9, 0.5, 0], [0.8, 1.0, 7.2]);
  chassis.box([0, 2.2, 2], [2.4, 0.8, 2]); // cab
  // Launcher: four tubes elevated 45°, extruded along a tilted axis.
  const tilt = Math.PI / 4;
  const tube = (x, y) =>
    launcher.extrude(
      [
        [-0.35, -0.35],
        [0.35, -0.35],
        [0.35, 0.35],
        [-0.35, 0.35],
      ],
      -2.6,
      2.6,
      (u, v, w) => [
        x + u,
        y + v * Math.cos(tilt) + w * Math.sin(tilt) + 2.6,
        -v * Math.sin(tilt) + w * Math.cos(tilt) - 1,
      ],
    );
  tube(-1.2, 0.3);
  tube(-0.4, 0.3);
  tube(0.4, 0.3);
  tube(1.2, 0.3);
  launcher.box([0, 2.6, -1], [2.8, 0.5, 1.2]); // trunnion
  return [
    [chassis, OLIVE],
    [tracks, DARK],
    [launcher, SAND],
  ];
}

// ---------------------------------------------------------------------------
// Truck: cab + cargo box on wheels; origin on the ground, front toward +Z.
// ---------------------------------------------------------------------------

function truck() {
  const body = new Mesh();
  const wheels = new Mesh();
  const glass = new Mesh();
  body.box([0, 1.0, -1.2], [2.4, 0.6, 6.5]); // chassis
  body.box([0, 2.3, -2.2], [2.4, 2.2, 4.4]); // cargo box
  body.box([0, 1.9, 1.7], [2.2, 1.6, 2.2]); // cab
  glass.box([0, 2.2, 2.82], [1.9, 0.7, 0.1]); // windscreen
  for (const z of [1.8, -1.0, -2.6]) {
    for (const x of [1.15, -1.15]) wheels.box([x, 0.5, z], [0.4, 1.0, 1.0]);
  }
  return [
    [body, OLIVE],
    [wheels, DARK],
    [glass, CANOPY],
  ];
}

// ---------------------------------------------------------------------------
// Patrol boat (~38 m): pointed hull, deckhouse, mast; origin at the waterline
// under the centre, bow toward +Z.
// ---------------------------------------------------------------------------

function boat() {
  const hull = new Mesh();
  const deck = new Mesh();
  const dark = new Mesh();
  // Hull: a hexagon in plan (pointed bow), extruded downward with a taper.
  hull.extrude(
    [
      [-3.5, -17],
      [3.5, -17],
      [4.2, 4],
      [0, 19],
      [-4.2, 4],
    ],
    -2.5,
    1.2,
    (x, z, y) => {
      const t = (y + 2.5) / 3.7; // 0 at keel, 1 at deck
      const s = 0.45 + 0.55 * t;
      return [x * s, y, z];
    },
  );
  deck.box([0, 2.4, -2], [5.5, 2.4, 9]); // deckhouse
  deck.box([0, 4.6, -1], [3.5, 2.0, 4]); // bridge
  dark.box([0, 8, -2], [0.3, 5, 0.3]); // mast
  dark.box([0, 1.8, 10], [1.4, 1.2, 2.2]); // gun mount
  dark.box([0, 2.2, 12.5], [0.3, 0.3, 4]); // barrel
  return [
    [hull, HULL],
    [deck, DECK],
    [dark, DARK],
  ];
}

// ---------------------------------------------------------------------------
// GLB packing.
// ---------------------------------------------------------------------------

function writeGlb(name, parts) {
  const materials = parts.map(([, m]) => m);
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

  parts.forEach(([mesh], materialIndex) => {
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
    asset: { version: '2.0', generator: 'airium scripts/make-models.mjs' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives }],
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

  const out = join(outDir, `${name}.glb`);
  writeFileSync(out, Buffer.concat([header, jsonHeader, jsonPadded, binHeader, bin]));
  const triangles = parts.reduce((n, [m]) => n + m.positions.length / 9, 0);
  console.log(`wrote ${out}: ${triangles} triangles, ${header.readUInt32LE(8)} bytes`);
}

mkdirSync(outDir, { recursive: true });
writeGlb('jet', jet());
writeGlb('sam', sam());
writeGlb('truck', truck());
writeGlb('boat', boat());
