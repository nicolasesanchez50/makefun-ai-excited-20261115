/**
 * MURMURATION — a breaking wave made of starlings, at dawn, over a lone surfer.
 *
 * Draws one 1024x1024 PNG procedurally. Node standard library only.
 * Deterministic: fixed seed, no clock, no Math.random.
 *
 * Usage:
 *   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';

// ---------------------------------------------------------------- constants

const W = 1024;
const H = 1024;
const SS = 2; // supersample factor
const CW = W * SS;
const CH = H * SS;

const HORIZON = 0.70 * H;

// ---------------------------------------------------------------- prng

function mulberry32(a: number): () => number {
  let s = a >>> 0;
  return function (): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(0x5eed1a7e);

// ---------------------------------------------------------------- helpers

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
function mixc(a: number[], b: number[], t: number): number[] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function hex(h: string): number[] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// colour stops for the sky, from zenith (0) to horizon (1)
const SKY: Array<[number, number[]]> = [
  [0.0, hex('#070a1c')],
  [0.26, hex('#241a4e')],
  [0.55, hex('#6a2a6b')],
  [0.79, hex('#ff6b4a')],
  [0.93, hex('#ffab6a')],
  [1.0, hex('#ffd08a')],
];

function skyAt(t: number): number[] {
  t = clamp(t, 0, 1);
  for (let i = 0; i < SKY.length - 1; i++) {
    const a = SKY[i];
    const b = SKY[i + 1];
    if (t <= b[0]) {
      const u = (t - a[0]) / (b[0] - a[0] || 1);
      return mixc(a[1], b[1], u * u * (3 - 2 * u));
    }
  }
  return SKY[SKY.length - 1][1].slice();
}

// ---------------------------------------------------------------- canvas

const buf = new Float32Array(CW * CH * 3);

function put(x: number, y: number, r: number, g: number, b: number): void {
  if (x < 0 || y < 0 || x >= CW || y >= CH) return;
  const i = (y * CW + x) * 3;
  buf[i] = r;
  buf[i + 1] = g;
  buf[i + 2] = b;
}

function add(x: number, y: number, r: number, g: number, b: number): void {
  if (x < 0 || y < 0 || x >= CW || y >= CH) return;
  const i = (y * CW + x) * 3;
  buf[i] += r;
  buf[i + 1] += g;
  buf[i + 2] += b;
}

// additive soft disc
function splat(cx: number, cy: number, rad: number, col: number[], k: number): void {
  const x0 = Math.max(0, Math.floor(cx - rad));
  const x1 = Math.min(CW - 1, Math.ceil(cx + rad));
  const y0 = Math.max(0, Math.floor(cy - rad));
  const y1 = Math.min(CH - 1, Math.ceil(cy + rad));
  const inv = 1 / (rad * rad);
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const d2 = (dx * dx + dy * dy) * inv;
      if (d2 >= 1) continue;
      const f = (1 - d2) * (1 - d2) * k;
      const i = (y * CW + x) * 3;
      buf[i] += col[0] * f;
      buf[i + 1] += col[1] * f;
      buf[i + 2] += col[2] * f;
    }
  }
}

// tiny ordered dither table to break up sky banding
const DITH = new Float32Array(64 * 64);
{
  const dr = mulberry32(0xd17b3e);
  for (let i = 0; i < DITH.length; i++) DITH[i] = (dr() - 0.5) * 1.15;
}
function dither(x: number, y: number): number {
  return DITH[((y & 63) << 6) | (x & 63)];
}

// ---------------------------------------------------------------- sky + sun

const SUNX = 0.612 * W;
const SUNY = 0.664 * H;
const SUNR = 88;
const HALOR = 330;
const SUNCOL = hex('#fff6d8');
const SUNWARM = hex('#ffcf8a');

function drawSky(): void {
  for (let y = 0; y < CH; y++) {
    const yy = y / SS;
    const t = clamp(yy / HORIZON, 0, 1);
    const base = skyAt(t);
    // gentle vertical dither per row, plus per-pixel noise
    for (let x = 0; x < CW; x++) {
      const d = dither(x, y);
      put(x, y, base[0] + d, base[1] + d, base[2] + d);
    }
  }

  // sun halo: wide additive bloom, squared falloff
  const hx = SUNX * SS;
  const hy = SUNY * SS;
  const hr = HALOR * SS;
  const x0 = Math.max(0, Math.floor(hx - hr));
  const x1 = Math.min(CW - 1, Math.ceil(hx + hr));
  const y0 = Math.max(0, Math.floor(hy - hr));
  const y1 = Math.min(CH - 1, Math.ceil(hy + hr));
  for (let y = y0; y <= y1; y++) {
    const dy = y - hy;
    for (let x = x0; x <= x1; x++) {
      const dx = x - hx;
      const d = Math.sqrt(dx * dx + dy * dy) / hr;
      if (d >= 1) continue;
      const f = Math.pow(1 - d, 2.4);
      const i = (y * CW + x) * 3;
      buf[i] += SUNWARM[0] * f * 0.46;
      buf[i + 1] += SUNWARM[1] * f * 0.30;
      buf[i + 2] += SUNWARM[2] * f * 0.17;
    }
  }

  // compact inner glow
  for (let k = 0; k < 3; k++) splat(hx, hy, (150 + k * 90) * SS * 0.46, SUNCOL, 0.17 - k * 0.045);

  // sun disc with antialiased edge
  const r = SUNR * SS;
  const dx0 = Math.max(0, Math.floor(hx - r - 3));
  const dx1 = Math.min(CW - 1, Math.ceil(hx + r + 3));
  const dy0 = Math.max(0, Math.floor(hy - r - 3));
  const dy1 = Math.min(CH - 1, Math.ceil(hy + r + 3));
  for (let y = dy0; y <= dy1; y++) {
    for (let x = dx0; x <= dx1; x++) {
      const dx = x - hx;
      const dy = y - hy;
      const d = Math.sqrt(dx * dx + dy * dy);
      const a = clamp((r + 0.9 - d) / 1.8, 0, 1);
      if (a <= 0) continue;
      const i = (y * CW + x) * 3;
      buf[i] = lerp(buf[i], SUNCOL[0] + 8, a);
      buf[i + 1] = lerp(buf[i + 1], SUNCOL[1] + 6, a);
      buf[i + 2] = lerp(buf[i + 2], SUNCOL[2], a);
    }
  }
}

// ---------------------------------------------------------------- sea

function drawSea(): void {
  const top = HORIZON * SS;
  const deep = hex('#05070f');
  const mid = hex('#0d1230');
  for (let y = Math.floor(top); y < CH; y++) {
    const t = clamp((y / SS - HORIZON) / (H - HORIZON), 0, 1);
    const c = mixc(mid, deep, smoothstep(0, 0.75, t));
    for (let x = 0; x < CW; x++) {
      const d = dither(x, y) * 0.7;
      put(x, y, c[0] + d, c[1] + d, c[2] + d);
    }
  }

  // warm haze band right at the horizon
  for (let y = Math.floor(top) - 26 * SS; y < top + 30 * SS; y++) {
    if (y < 0 || y >= CH) continue;
    const dy = (y - top) / (SS * 26);
    const a = Math.exp(-dy * dy * 1.5) * 0.55;
    for (let x = 0; x < CW; x++) {
      const dx = (x / SS - SUNX) / (W * 0.55);
      const f = a * Math.exp(-dx * dx * 0.9);
      if (f <= 0.002) continue;
      add(x, y, 255 * f, 150 * f, 92 * f);
    }
  }

  // broad reflection column under the sun
  const seaH = CH - top;
  for (let y = Math.floor(top); y < CH; y++) {
    const ty = (y - top) / seaH;
    const halfW = (14 + ty * 120) * SS;
    const a = (1 - ty) * 0.5;
    for (let x = 0; x < CW; x++) {
      const dx = (x - SUNX * SS) / halfW;
      if (Math.abs(dx) > 1) continue;
      const f = a * Math.pow(1 - dx * dx, 2.0);
      add(x, y, 255 * f * 0.55, 176 * f * 0.5, 108 * f * 0.42);
    }
  }

  // glitter: hundreds of short horizontal dashes in a widening wedge
  const r2 = mulberry32(0x91a22b);
  const n = 2600;
  for (let i = 0; i < n; i++) {
    const ty = Math.pow(r2(), 2.1); // denser near horizon
    const y = HORIZON + ty * (H - HORIZON);
    const halfW = 26 + ty * 240;
    // gaussian-ish lateral spread
    const gx = (r2() + r2() + r2() - 1.5) / 1.5;
    const x = SUNX + gx * halfW;
    const len = 2 + r2() * (7 + ty * 26);
    const bright = (0.20 + r2() * 0.75) * (1 - ty * 0.72) * Math.exp(-gx * gx * 0.7);
    if (bright < 0.02) continue;
    const yy = Math.round(y * SS);
    const xa = Math.round((x - len * 0.5) * SS);
    const steps = Math.max(1, Math.round(len * SS));
    const col = mixc(hex('#ffcf8a'), hex('#fff6d8'), r2() * 0.7);
    for (let s = 0; s < steps; s++) {
      const a = bright * (0.55 + 0.45 * Math.sin((s / steps) * Math.PI));
      add(xa + s, yy, col[0] * a * 0.85, col[1] * a * 0.8, col[2] * a * 0.7);
    }
  }

  // faint horizontal swell lines
  const r3 = mulberry32(0x77c1);
  for (let i = 0; i < 90; i++) {
    const ty = Math.pow(r3(), 0.7);
    const y = HORIZON + ty * (H - HORIZON);
    const x0 = r3() * W * 0.9 - W * 0.1;
    const len = 60 + r3() * 420;
    const a = 0.05 + r3() * 0.09;
    const yy = Math.round(y * SS);
    const xa = Math.round(x0 * SS);
    for (let s = 0; s < len * SS; s++) {
      const f = a * Math.sin((s / (len * SS)) * Math.PI);
      add(xa + s, yy, 90 * f, 120 * f, 190 * f);
    }
  }
}

// ---------------------------------------------------------------- wave mass
// A comma/paisley: a rising body on the left, crest curling over to the right
// and folding down into a hollow. Built as a thick tapered tube along a spine,
// unioned with a big soft body mass in the lower left.

const SPINE: Array<[number, number]> = [
  [0.028, 1.085],
  [0.078, 0.905],
  [0.126, 0.718],
  [0.184, 0.542],
  [0.260, 0.412],
  [0.354, 0.320],
  [0.460, 0.270],
  [0.560, 0.274],
  [0.634, 0.334],
  [0.678, 0.424],
  [0.674, 0.516],
  [0.640, 0.602],
  [0.590, 0.674],
  [0.536, 0.722],
];

const WIDTH_KEYS: Array<[number, number]> = [
  [0.0, 0.300],
  [0.12, 0.258],
  [0.26, 0.218],
  [0.38, 0.178],
  [0.48, 0.146],
  [0.56, 0.116],
  [0.64, 0.086],
  [0.72, 0.060],
  [0.80, 0.040],
  [0.88, 0.026],
  [0.94, 0.017],
  [1.0, 0.008],
];

function widthAt(t: number): number {
  for (let i = 0; i < WIDTH_KEYS.length - 1; i++) {
    const a = WIDTH_KEYS[i];
    const b = WIDTH_KEYS[i + 1];
    if (t <= b[0]) {
      const u = (t - a[0]) / (b[0] - a[0] || 1);
      return lerp(a[1], b[1], u);
    }
  }
  return WIDTH_KEYS[WIDTH_KEYS.length - 1][1];
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

type SpineSample = { x: number; y: number; tx: number; ty: number; w: number; t: number };

const spineSamples: SpineSample[] = [];
{
  const per = 48;
  const raw: Array<{ x: number; y: number; t: number }> = [];
  for (let i = 0; i < SPINE.length - 1; i++) {
    const p0 = SPINE[Math.max(0, i - 1)];
    const p1 = SPINE[i];
    const p2 = SPINE[i + 1];
    const p3 = SPINE[Math.min(SPINE.length - 1, i + 2)];
    for (let s = 0; s < per; s++) {
      const u = s / per;
      raw.push({
        x: catmull(p0[0], p1[0], p2[0], p3[0], u),
        y: catmull(p0[1], p1[1], p2[1], p3[1], u),
        t: 0,
      });
    }
  }
  raw.push({ x: SPINE[SPINE.length - 1][0], y: SPINE[SPINE.length - 1][1], t: 0 });

  // arc length parameterisation
  let total = 0;
  const acc: number[] = [0];
  for (let i = 1; i < raw.length; i++) {
    total += Math.hypot(raw[i].x - raw[i - 1].x, raw[i].y - raw[i - 1].y);
    acc.push(total);
  }
  for (let i = 0; i < raw.length; i++) {
    const t = acc[i] / total;
    const a = raw[Math.max(0, i - 1)];
    const b = raw[Math.min(raw.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    spineSamples.push({
      x: raw[i].x * W,
      y: raw[i].y * H,
      tx: dx / l,
      ty: dy / l,
      w: widthAt(t) * W,
      t,
    });
  }
}

// coarse scalar field for the wave mass + local flow direction
const GS = 4; // grid cell size in 1024-space px
const GW = Math.ceil(W / GS) + 2;
const GH = Math.ceil(H / GS) + 2;
const field = new Float32Array(GW * GH);
const tanX = new Float32Array(GW * GH);
const tanY = new Float32Array(GW * GH);

function splatField(cx: number, cy: number, rad: number, val: number, tx: number, ty: number): void {
  const gx = cx / GS;
  const gy = cy / GS;
  const gr = rad / GS;
  const x0 = Math.max(0, Math.floor(gx - gr));
  const x1 = Math.min(GW - 1, Math.ceil(gx + gr));
  const y0 = Math.max(0, Math.floor(gy - gr));
  const y1 = Math.min(GH - 1, Math.ceil(gy + gr));
  const inv = 1 / (gr * gr);
  for (let y = y0; y <= y1; y++) {
    const dy = y - gy;
    for (let x = x0; x <= x1; x++) {
      const dx = x - gx;
      const d2 = (dx * dx + dy * dy) * inv;
      if (d2 >= 1) continue;
      const f = val * (1 - d2);
      const i = y * GW + x;
      if (f > field[i]) {
        field[i] = f;
        tanX[i] = tx;
        tanY[i] = ty;
      }
    }
  }
}

function buildField(): void {
  // tube along the spine
  for (const s of spineSamples) {
    // inward taper: value 1 at the spine, 0 at the rim
    splatField(s.x, s.y, s.w, 1.0, s.tx, s.ty);
    // a soft inner core so the mass is solid rather than peaked
    splatField(s.x, s.y, s.w * 0.72, 1.0, s.tx, s.ty);
    splatField(s.x, s.y, s.w * 0.42, 1.0, s.tx, s.ty);
  }

  // body mass filling the lower left, so the wave has weight at its base.
  // Kept deliberately narrow and low: a wide belly here makes the silhouette
  // read as a breaching whale rather than a wave.
  const bx = -0.045 * W;
  const by = 0.985 * H;
  const brx = 0.255 * W;
  const bry = 0.255 * H;
  const rot = -0.18;
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      const px = x * GS - bx;
      const py = y * GS - by;
      const rx = px * cs - py * sn;
      const ry = px * sn + py * cs;
      const d = Math.sqrt((rx * rx) / (brx * brx) + (ry * ry) / (bry * bry));
      if (d >= 1) continue;
      const f = Math.pow(1 - d * d, 0.75);
      const i = y * GW + x;
      if (f > field[i]) {
        field[i] = f;
        tanX[i] = -0.55;
        tanY[i] = -0.83;
      }
    }
  }
}

function sampleField(x: number, y: number): number {
  const gx = clamp(x / GS, 0, GW - 1.001);
  const gy = clamp(y / GS, 0, GH - 1.001);
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const fx = gx - ix;
  const fy = gy - iy;
  const i = iy * GW + ix;
  const a = field[i];
  const b = field[i + 1];
  const c = field[i + GW];
  const d = field[i + GW + 1];
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}

function drawWaveMass(): void {
  const base = hex('#0a0e22');
  const deep = hex('#05070d');
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      const f = sampleField(x / SS, y / SS);
      // feathered edge, solid core
      let a = smoothstep(0.045, 0.5, f);
      if (a <= 0.001) continue;
      a = Math.pow(a, 0.85) * 0.985;
      const i = (y * CW + x) * 3;
      const c = mixc(base, deep, smoothstep(0.5, 1.0, f) * 0.55);
      buf[i] = lerp(buf[i], c[0], a);
      buf[i + 1] = lerp(buf[i + 1], c[1], a);
      buf[i + 2] = lerp(buf[i + 2], c[2], a);
    }
  }
}

// ---------------------------------------------------------------- field sampling

function sampleGrad(x: number, y: number): [number, number, number] {
  const gx = clamp(x / GS, 1, GW - 2.001);
  const gy = clamp(y / GS, 1, GH - 2.001);
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const fx = gx - ix;
  const fy = gy - iy;
  const i = iy * GW + ix;
  const a = field[i];
  const b = field[i + 1];
  const c = field[i + GW];
  const d = field[i + GW + 1];
  const f = lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
  const dx = (b - a) * (1 - fy) + (d - c) * fy;
  const dy = (c - a) * (1 - fx) + (d - b) * fx;
  return [dx / GS, dy / GS, f];
}

// ---------------------------------------------------------------- drawing primitives

type Mode = 'blend' | 'add';

function blendPx(x: number, y: number, col: number[], a: number, mode: Mode): void {
  if (a <= 0 || x < 0 || y < 0 || x >= CW || y >= CH) return;
  const i = (y * CW + x) * 3;
  if (mode === 'add') {
    buf[i] += col[0] * a;
    buf[i + 1] += col[1] * a;
    buf[i + 2] += col[2] * a;
  } else {
    buf[i] = lerp(buf[i], col[0], a);
    buf[i + 1] = lerp(buf[i + 1], col[1], a);
    buf[i + 2] = lerp(buf[i + 2], col[2], a);
  }
}

function segDist(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const vx = x1 - x0;
  const vy = y1 - y0;
  const wx = px - x0;
  const wy = py - y0;
  const l2 = vx * vx + vy * vy;
  let t = l2 > 0 ? (wx * vx + wy * vy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = wx - vx * t;
  const dy = wy - vy * t;
  return Math.sqrt(dx * dx + dy * dy);
}

function stroke(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  w: number,
  col: number[],
  a: number,
  mode: Mode,
): void {
  const pad = w * 0.5 + 1.5;
  const bx0 = Math.max(0, Math.floor(Math.min(x0, x1) - pad));
  const bx1 = Math.min(CW - 1, Math.ceil(Math.max(x0, x1) + pad));
  const by0 = Math.max(0, Math.floor(Math.min(y0, y1) - pad));
  const by1 = Math.min(CH - 1, Math.ceil(Math.max(y0, y1) + pad));
  const half = w * 0.5;
  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) {
      const d = segDist(x + 0.5, y + 0.5, x0, y0, x1, y1);
      const cov = clamp((half + 0.62 - d) / 1.24, 0, 1);
      if (cov <= 0) continue;
      blendPx(x, y, col, a * cov, mode);
    }
  }
}

// a single starling: apex forward, two swept wings
function bird(
  x: number,
  y: number,
  dir: number,
  len: number,
  col: number[],
  a: number,
  mode: Mode,
  wing: number,
  thick: number,
): void {
  const c = Math.cos(dir);
  const s = Math.sin(dir);
  for (const sgn of [-1, 1]) {
    const ang = Math.PI + sgn * wing;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const ex = x + (c * ca - s * sa) * len;
    const ey = y + (s * ca + c * sa) * len;
    stroke(x, y, ex, ey, thick, col, a, mode);
  }
  blendPx(Math.round(x), Math.round(y), col, a * 0.8, mode);
}

// ---------------------------------------------------------------- birds

const C_LIT = hex('#ffe6ad');
const C_LIT_HOT = hex('#fff8dd');
const C_SHADOW = hex('#05070d');
const C_SHADOW_EDGE = hex('#2a3a6b');

type Cell = { x: number; y: number; f: number; nx: number; ny: number; face: number };

const rimLit: Cell[] = [];
const rimShade: Cell[] = [];
const bodyCells: Cell[] = [];

function classify(): void {
  const sx = SUNX;
  const sy = SUNY;
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const i = gy * GW + gx;
      const f = field[i];
      if (f < 0.012) continue;
      const x = gx * GS + GS * 0.5;
      const y = gy * GS + GS * 0.5;
      const [dx, dy] = sampleGrad(x, y);
      const dl = Math.hypot(dx, dy) || 1;
      // outward normal is the direction of decreasing field
      const nx = -dx / dl;
      const ny = -dy / dl;
      const vx = sx - x;
      const vy = sy - y;
      const vl = Math.hypot(vx, vy) || 1;
      const face = (nx * vx + ny * vy) / vl;
      const cell: Cell = { x, y, f, nx, ny, face };
      if (f < 0.30) {
        if (face > 0.02) rimLit.push(cell);
        else rimShade.push(cell);
      } else {
        bodyCells.push(cell);
      }
    }
  }
}

function pickCell(list: Cell[], r: () => number, edgeBias: number): Cell {
  // prefer cells near the rim (low f): sample a few, keep the most marginal
  let best = list[Math.floor(r() * list.length) % list.length];
  for (let k = 0; k < edgeBias; k++) {
    const c = list[Math.floor(r() * list.length) % list.length];
    if (c.f < best.f) best = c;
  }
  return best;
}

function drawBirds(): void {
  classify();
  const r = mulberry32(0xb12d5);

  // ---- rim-lit birds: the lit leading edge, dense and bright
  const nLit = 3600;
  for (let i = 0; i < nLit; i++) {
    const c = pickCell(rimLit, r, 3);
    const jx = (r() - 0.5) * GS * 1.5;
    const jy = (r() - 0.5) * GS * 1.5;
    const x = (c.x + jx) * SS;
    const y = (c.y + jy) * SS;
    // flow: along the rim, perpendicular to the outward normal
    let dir = Math.atan2(c.nx, -c.ny);
    dir += (r() - 0.5) * 0.7;
    const len = (3.4 + r() * 6.2) * SS;
    const wing = 0.44 + r() * 0.30;
    const hot = c.face > 0.35 && r() > 0.45;
    const col = hot ? C_LIT_HOT : C_LIT;
    const a = 0.66 + r() * 0.34;
    bird(x, y, dir, len, col, a, 'blend', wing, 1.05 * SS);
    if (hot) {
      blendPx(Math.round(x), Math.round(y), C_LIT_HOT, 0.30 * r(), 'add');
    }
  }

  // ---- shadowed rim: dark birds with a cold blue edge
  const nShade = 1500;
  for (let i = 0; i < nShade; i++) {
    const c = pickCell(rimShade, r, 2);
    const x = (c.x + (r() - 0.5) * GS * 1.4) * SS;
    const y = (c.y + (r() - 0.5) * GS * 1.4) * SS;
    let dir = Math.atan2(c.nx, -c.ny) + (r() - 0.5) * 0.9;
    const len = (3.0 + r() * 5.4) * SS;
    bird(x, y + 0.7 * SS, dir, len, C_SHADOW_EDGE, 0.34 + r() * 0.3, 'blend', 0.48, 1.15 * SS);
    bird(x, y, dir, len * 0.94, C_SHADOW, 0.85, 'blend', 0.46, 0.8 * SS);
  }

  // ---- interior body: dark birds, texture only
  const nBody = 4300;
  for (let i = 0; i < nBody; i++) {
    const c = pickCell(bodyCells, r, 2);
    const x = (c.x + (r() - 0.5) * GS * 1.6) * SS;
    const y = (c.y + (r() - 0.5) * GS * 1.6) * SS;
    let dir = Math.atan2(c.nx, -c.ny) + (r() - 0.5) * 1.0;
    const len = (3.0 + r() * 5.0) * SS;
    const cold = r() > 0.55;
    if (cold) {
      bird(x, y + 0.6 * SS, dir, len, C_SHADOW_EDGE, 0.16 + r() * 0.16, 'blend', 0.5, 1.0 * SS);
    }
    bird(x, y, dir, len, C_SHADOW, 0.75, 'blend', 0.46, 0.8 * SS);
  }

  // ---- strays peeling off the crest into open sky
  const nStray = 520;
  for (let i = 0; i < nStray; i++) {
    const t = r();
    const si = Math.min(spineSamples.length - 1, Math.floor(Math.pow(t, 0.6) * spineSamples.length));
    const sp = spineSamples[si];
    // outward direction at that spine point: right-hand normal
    const nx = -sp.ty;
    const ny = sp.tx;
    const dist = 8 + Math.pow(r(), 1.6) * (70 + 190 * r());
    const x = sp.x + nx * (sp.w * 0.75 + dist) + (r() - 0.5) * 70;
    const y = sp.y + ny * (sp.w * 0.75 + dist) + (r() - 0.5) * 70 - Math.pow(r(), 2) * 60;
    if (x < 2 || y < 2 || x > W - 2 || y > H - 2) continue;
    // birds leaving the mass fly outward and up
    const dir = Math.atan2(ny, nx) + (r() - 0.5) * 1.4;
    const len = (3.0 + r() * 4.6) * SS;
    const lit = r() > 0.35;
    bird(x * SS, y * SS, dir, len, lit ? C_LIT : C_SHADOW, lit ? 0.55 + r() * 0.4 : 0.6, 'blend', 0.5, 0.85 * SS);
  }

  // ---- water sheeting DOWN the face.
  // Chains that start inside the mass and run downhill until they spill off the
  // edge. This is the cue that separates "wave" from "smooth dark dome": water
  // runs down a face, a body does not.
  const nStreak = 210;
  for (let i = 0; i < nStreak; i++) {
    // seed on the front (sunward) half of the mass, below the crest
    let x = (0.10 + r() * 0.58) * W;
    let y = (0.20 + r() * 0.55) * H;
    if (sampleField(x, y) < 0.25) continue;
    const steps = 8 + Math.floor(r() * 30);
    const stepLen = 9 + r() * 14;
    const drift = -0.10 - r() * 0.18; // lean toward the hollow as it falls
    let px = x;
    let py = y;
    for (let s = 0; s < steps; s++) {
      const f = sampleField(px, py);
      if (f < 0.10) break;
      const ang = Math.PI * 0.5 + drift;
      const nx = px + Math.cos(ang) * stepLen;
      const ny = py + Math.sin(ang) * stepLen;
      const fade = 1 - s / steps;
      const col = s % 3 === 0 ? hex('#3b5a92') : hex('#243257');
      bird(nx * SS, ny * SS, Math.PI * 0.5 + drift + (r() - 0.5) * 0.5, (2.2 + r() * 2.6) * SS, col, (0.20 + r() * 0.34) * fade, 'blend', 0.5, 0.7 * SS);
      px = nx;
      py = ny;
    }
  }

  // ---- the plume: a directed ribbon of birds flung off the crest tip,
  // running lower-left to upper-right so the diagonal stays alive at 300px.
  const tip = spineSamples[spineSamples.length - 1];
  const ax = 0.615 * W;
  const ay = 0.395 * H; // where the plume starts
  const bx = 0.985 * W;
  const by = 0.075 * H; // and where it thins out
  const nPlume = 900;
  for (let i = 0; i < nPlume; i++) {
    const t = Math.pow(r(), 0.72); // denser at the wave end
    const cx = lerp(ax, bx, t);
    const cy = lerp(ay, by, t) - Math.sin(t * Math.PI) * 46;
    // ribbon half-width narrows as it travels
    const hw = (16 + 66 * (1 - t)) * (0.9 + 0.5 * r());
    const off = (r() + r() + r() - 1.5) / 1.5;
    const x = cx + off * hw;
    const y = cy + off * hw * 0.85 + (r() - 0.5) * 16;
    if (x < 2 || y < 2 || x > W - 2 || y > H - 2) continue;
    const dir = Math.atan2(by - ay, bx - ax) + (r() - 0.5) * 0.75;
    const len = (3.0 + r() * 5.2) * SS;
    // against the purple sky these are dark specks with a warm edge
    const lit = r() > 0.62;
    if (lit) {
      bird(x * SS, y * SS + 0.8 * SS, dir, len * 1.04, hex('#3a2a4e'), 0.30 + r() * 0.25, 'blend', 0.5, 0.9 * SS);
      bird(x * SS, y * SS, dir, len, C_LIT, 0.35 + r() * 0.42, 'blend', 0.48, 0.78 * SS);
    } else {
      bird(x * SS, y * SS, dir, len, C_SHADOW, 0.55 + r() * 0.4, 'blend', 0.5, 0.85 * SS);
    }
  }
  void tip;
}

// ---------------------------------------------------------------- crest light + spray

type Seg = [number, number, number, number];

// Marching-squares contour of the mass field at threshold T, in 1024-space.
function contour(T: number): Seg[] {
  const segs: Seg[] = [];
  const at = (x: number, y: number): number => field[y * GW + x];
  const lerpPt = (x0: number, y0: number, v0: number, x1: number, y1: number, v1: number): [number, number] => {
    const u = (T - v0) / (v1 - v0 || 1);
    return [(x0 + (x1 - x0) * u) * GS, (y0 + (y1 - y0) * u) * GS];
  };
  for (let y = 0; y < GH - 1; y++) {
    for (let x = 0; x < GW - 1; x++) {
      const a = at(x, y);
      const b = at(x + 1, y);
      const c = at(x + 1, y + 1);
      const d = at(x, y + 1);
      let idx = 0;
      if (a > T) idx |= 8;
      if (b > T) idx |= 4;
      if (c > T) idx |= 2;
      if (d > T) idx |= 1;
      if (idx === 0 || idx === 15) continue;
      const top = () => lerpPt(x, y, a, x + 1, y, b);
      const right = () => lerpPt(x + 1, y, b, x + 1, y + 1, c);
      const bottom = () => lerpPt(x, y + 1, d, x + 1, y + 1, c);
      const left = () => lerpPt(x, y, a, x, y + 1, d);
      const push = (p: [number, number], q: [number, number]): void => {
        segs.push([p[0], p[1], q[0], q[1]]);
      };
      switch (idx) {
        case 1:
          push(left(), bottom());
          break;
        case 2:
          push(bottom(), right());
          break;
        case 3:
          push(left(), right());
          break;
        case 4:
          push(top(), right());
          break;
        case 5:
          push(left(), top());
          push(bottom(), right());
          break;
        case 6:
          push(top(), bottom());
          break;
        case 7:
          push(left(), top());
          break;
        case 8:
          push(top(), left());
          break;
        case 9:
          push(top(), bottom());
          break;
        case 10:
          push(top(), right());
          push(left(), bottom());
          break;
        case 11:
          push(top(), right());
          break;
        case 12:
          push(left(), right());
          break;
        case 13:
          push(bottom(), right());
          break;
        case 14:
          push(left(), bottom());
          break;
        default:
          break;
      }
    }
  }
  return segs;
}

function drawsSegGlow(s: Seg, face: number): void {
  const mx = (s[0] + s[2]) * 0.5;
  const my = (s[1] + s[3]) * 0.5;
  const lit = smoothstep(-0.05, 0.42, face);
  if (lit <= 0.01) return;
  const x0 = s[0] * SS;
  const y0 = s[1] * SS;
  const x1 = s[2] * SS;
  const y1 = s[3] * SS;
  // wide warm bloom
  stroke(x0, y0, x1, y1, 9.5 * SS, hex('#ffb066'), 0.030 * lit, 'add');
  stroke(x0, y0, x1, y1, 4.2 * SS, hex('#ffcf8a'), 0.075 * lit, 'add');
  // thin hot core
  stroke(x0, y0, x1, y1, 1.5 * SS, hex('#fff6d8'), 0.55 * lit, 'add');
  void mx;
  void my;
}

function drawCrestLight(): void {
  const segs = contour(0.085);
  const sunLen = Math.hypot(SUNX, SUNY) || 1;

  for (const s of segs) {
    const mx = (s[0] + s[2]) * 0.5;
    const my = (s[1] + s[3]) * 0.5;
    const [gx, gy] = sampleGrad(mx, my);
    const gl = Math.hypot(gx, gy) || 1;
    const nx = -gx / gl;
    const ny = -gy / gl;
    const vx = SUNX - mx;
    const vy = SUNY - my;
    const vl = Math.hypot(vx, vy) || 1;
    drawsSegGlow(s, (nx * vx + ny * vy) / vl);
  }

  // light bleeding through the thin part of the crest: a soft additive band
  // just inside the silhouette, so the lip looks translucent rather than solid.
  const hx = SUNX;
  const hy = SUNY;
  for (const s of segs) {
    const mx = (s[0] + s[2]) * 0.5;
    const my = (s[1] + s[3]) * 0.5;
    const [gx, gy] = sampleGrad(mx, my);
    const gl = Math.hypot(gx, gy) || 1;
    const nx = gx / gl; // inward
    const ny = gy / gl;
    const vx = hx - mx;
    const vy = hy - my;
    const vl = Math.hypot(vx, vy) || 1;
    const face = (-nx * vx - ny * vy) / vl;
    const lit = smoothstep(0.0, 0.5, face);
    if (lit <= 0.01) continue;
    for (let k = 1; k <= 4; k++) {
      const d = k * 5.5;
      const a = lit * (0.062 - k * 0.011);
      if (a <= 0) continue;
      stroke(
        (s[0] + nx * d) * SS,
        (s[1] + ny * d) * SS,
        (s[2] + nx * d) * SS,
        (s[3] + ny * d) * SS,
        3.0 * SS,
        hex('#ffd7a0'),
        a,
        'add',
      );
    }
  }
  void sunLen;
}

function drawSpray(): void {
  const rr = mulberry32(0x517a3);
  const tipIdx = spineSamples.length - 1;
  const tip = spineSamples[tipIdx];
  const n = 1500;
  for (let i = 0; i < n; i++) {
    // sample along the crest, biased toward the tip
    const u = Math.pow(rr(), 1.5);
    const si = Math.floor(0.36 * spineSamples.length + u * 0.64 * (spineSamples.length - 1));
    const sp = spineSamples[Math.min(si, tipIdx)];
    const nx = -sp.ty;
    const ny = sp.tx;
    // fan outward from the crest surface
    const spread = (rr() + rr() - 1) * 1.5;
    const ang = Math.atan2(ny, nx) + spread;
    const d = sp.w * 0.55 + Math.pow(rr(), 1.7) * (46 + 150 * rr());
    const x = sp.x + Math.cos(ang) * d;
    const y = sp.y + Math.sin(ang) * d - Math.pow(rr(), 2.2) * 40;
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const nearTip = sp.t;
    const bright = (0.20 + rr() * 0.80) * (0.55 + 1.1 * nearTip) * (1 - d / 260);
    if (bright <= 0.02) continue;
    const col = rr() > 0.55 ? hex('#fff6d8') : hex('#ffcf8a');
    const sz = (0.7 + rr() * 1.6) * SS;
    if (rr() > 0.55) {
      // short streak along the flight direction
      const sa = ang + (rr() - 0.5) * 0.6;
      const sl = (2 + rr() * 7) * SS;
      stroke(
        x * SS,
        y * SS,
        x * SS + Math.cos(sa) * sl,
        y * SS + Math.sin(sa) * sl,
        sz * 0.8,
        col,
        bright * 0.55,
        'add',
      );
    } else {
      splat(x * SS, y * SS, sz * 1.6, col, bright * 0.7);
    }
  }
  // concentrated burst right at the crest tip
  for (let i = 0; i < 420; i++) {
    const ang = -0.5 + rr() * 1.5;
    const d = Math.pow(rr(), 1.4) * 220;
    const x = (tip.x + Math.cos(ang) * d * 0.85 + 26) * SS;
    const y = (tip.y + Math.sin(ang) * d * 0.8 - d * 0.15) * SS;
    const b = (1 - d / 230) * (0.35 + rr() * 0.65);
    if (b <= 0) continue;
    splat(x, y, (0.8 + rr() * 1.9) * SS, hex('#fff6d8'), b * 0.55);
  }
}

// ---------------------------------------------------------------- surfer

function drawSurfer(): void {
  const sx = 0.515 * W;
  const sy = 0.932 * H;
  const s = SS;

  // wake: thin bright streaks trailing left
  const wr = mulberry32(0x9a1e);
  for (let i = 0; i < 46; i++) {
    const t = wr();
    const x0 = sx - 4 - t * 120;
    const y0 = sy + 6 + t * 8 + (wr() - 0.5) * 3;
    const len = 10 + wr() * 46;
    const a = (1 - t) * 0.5 * (0.4 + wr() * 0.6);
    stroke(x0 * s, y0 * s, (x0 + len) * s, (y0 + 0.8) * s, 0.9 * s, hex('#ffd7a0'), a * 0.5, 'add');
  }
  for (let i = 0; i < 22; i++) {
    const t = wr();
    const x0 = sx + 2 + t * 60;
    const y0 = sy + 8 + t * 5;
    stroke(x0 * s, y0 * s, (x0 + 18 + wr() * 30) * s, (y0 + 1.2) * s, 0.8 * s, hex('#fff0d0'), (1 - t) * 0.30, 'add');
  }

  // board
  const bx = sx;
  const by = sy + 15;
  const bcol = hex('#ff4d2e');
  const bcol2 = hex('#ff8a5c');
  for (let i = -22; i <= 22; i++) {
    const u = i / 22;
    const th = (1 - u * u) * 2.4 + 0.35;
    const yy = by + u * 1.6 + Math.sin(u * 3) * 0.4;
    const a = 1 - Math.pow(Math.abs(u), 3) * 0.35;
    stroke((bx + i) * s, yy * s, (bx + i) * s, (yy + th) * s, 1.1 * s, i > -6 ? bcol2 : bcol, a, 'blend');
  }
  stroke((bx - 23) * s, by * s, (bx + 23) * s, (by + 1.4) * s, 1.6 * s, bcol, 0.95, 'blend');
  // warm glint under the board
  splat(bx * s, (by + 7) * s, 30 * s, hex('#ffb070'), 0.16);

  // rider: crouched, compact, ~42px tall
  const dark = hex('#05070f');
  const hipX = bx + 0.5;
  const hipY = sy - 2;
  const headX = bx + 5.5;
  const headY = sy - 25;
  // torso
  stroke(hipX * s, hipY * s, headX * s, (headY + 5) * s, 4.6 * s, dark, 1, 'blend');
  // head
  splat(headX * s, (headY - 1) * s, 4.6 * s, dark, 1);
  // bent front leg
  stroke(hipX * s, hipY * s, (bx + 9) * s, (sy + 9) * s, 3.4 * s, dark, 1, 'blend');
  stroke((bx + 9) * s, (sy + 9) * s, (bx + 6) * s, (by - 1) * s, 3.0 * s, dark, 1, 'blend');
  // back leg
  stroke(hipX * s, hipY * s, (bx - 8) * s, (sy + 8) * s, 3.2 * s, dark, 1, 'blend');
  stroke((bx - 8) * s, (sy + 8) * s, (bx - 11) * s, (by - 1) * s, 2.8 * s, dark, 1, 'blend');
  // arms out for balance
  stroke((headX - 1) * s, (headY + 7) * s, (bx + 20) * s, (sy - 16) * s, 2.6 * s, dark, 1, 'blend');
  stroke((headX - 1) * s, (headY + 7) * s, (bx - 12) * s, (sy - 20) * s, 2.5 * s, dark, 1, 'blend');
  // rim light on the sunward side
  stroke((headX + 1.6) * s, (headY + 5) * s, (hipX + 2) * s, (hipY - 3) * s, 1.0 * s, hex('#ffcf8a'), 0.75, 'add');
  splat((headX + 2.2) * s, (headY - 2) * s, 3.0 * s, hex('#ffe0a8'), 0.5);
}

// ---------------------------------------------------------------- foreground water
// A brighter band of water in front of the wave's base, with a foam line where
// the wave meets the sea. Without this the black mass reads as a whale belly.

function drawForeground(): void {
  const r = mulberry32(0x2b9f41);
  const startY = 0.845 * H;

  // ---- churn: whitewater boiling at the wave's base, which is what makes the
  // mass read as water hitting water instead of a body floating in air.
  const churnY = (u: number): number =>
    0.868 * H + Math.sin(u * 3.1 - 0.9) * 0.026 * H + Math.pow(u, 1.9) * 0.040 * H;
  for (let i = 0; i < 7200; i++) {
    const u = Math.pow(r(), 0.9);
    const x = -0.03 * W + u * 0.82 * W;
    const yb = churnY(u);
    const y = yb + (r() - 0.28) * (22 + 66 * r());
    if (y > H || y < 0) continue;
    const d = Math.hypot(x - SUNX, y - SUNY);
    const lit = clamp(1 - (d - 260) / 700, 0.18, 1.0);
    const edge = 1 - Math.pow(Math.abs(u - 0.30) / 0.72, 2) * 0.55;
    const a = (0.10 + r() * 0.55) * lit * edge * smoothstep(0, 0.12, 0.9 - Math.abs(y - yb) / 90);
    if (a <= 0.01) continue;
    const col = r() > 0.55 ? hex('#e8f2ff') : r() > 0.3 ? hex('#9fb8dd') : hex('#ffd9a8');
    splat(x * SS, y * SS, (1.0 + r() * 3.2) * SS, col, a * 0.36);
  }

  // long boiling streaks along the base
  for (let i = 0; i < 900; i++) {
    const u = Math.pow(r(), 0.85);
    const x = -0.03 * W + u * 0.80 * W;
    const yb = churnY(u);
    const y = yb + (r() - 0.3) * 46;
    const len = (5 + r() * 40) * (1 - u * 0.35);
    const a = (0.05 + r() * 0.26) * (1 - u * 0.5);
    stroke(
      x * SS,
      y * SS,
      (x + len) * SS,
      (y + (r() - 0.45) * 6) * SS,
      (0.8 + r() * 1.3) * SS,
      hex('#dbe9ff'),
      a,
      'add',
    );
  }

  // band of slightly lifted water, brightest just under the churn
  for (let y = Math.floor(startY * SS); y < CH; y++) {
    const t = (y / SS - startY) / (H - startY);
    for (let x = 0; x < CW; x++) {
      const wob = Math.sin(x * 0.0035 + 1.2) * 5 + Math.sin(x * 0.0011 - 0.4) * 8;
      const yy = y / SS + wob;
      const tt = clamp((yy - startY) / (H - startY), 0, 1);
      const a = (1 - tt) * 0.26 + 0.04;
      const i = (y * CW + x) * 3;
      buf[i] += 16 * a;
      buf[i + 1] += 32 * a;
      buf[i + 2] += 58 * a;
    }
  }

  // darken the very bottom so the surfer's bright board has something to sit on
  for (let y = Math.floor(0.955 * H * SS); y < CH; y++) {
    const t = clamp((y / SS - 0.955 * H) / (0.045 * H), 0, 1);
    for (let x = 0; x < CW; x++) {
      const i = (y * CW + x) * 3;
      const k = 1 - t * 0.5;
      buf[i] *= k;
      buf[i + 1] *= k;
      buf[i + 2] *= k;
    }
  }
}

// ---------------------------------------------------------------- png writer

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(b: Buffer, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const body = Buffer.concat([head.subarray(4), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body, 0, body.length), 0);
  return Buffer.concat([head, data, crc]);
}

// downsampled RGB image, 0..255
const px = new Uint8Array(W * H * 3);

function downsample(): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy++) {
        const row = (y * SS + sy) * CW;
        for (let sx = 0; sx < SS; sx++) {
          const i = (row + x * SS + sx) * 3;
          r += buf[i];
          g += buf[i + 1];
          b += buf[i + 2];
        }
      }
      const k = 1 / (SS * SS);
      const o = (y * W + x) * 3;
      px[o] = clamp(Math.round(r * k), 0, 255);
      px[o + 1] = clamp(Math.round(g * k), 0, 255);
      px[o + 2] = clamp(Math.round(b * k), 0, 255);
    }
  }
}

function filterRow(type: number, row: Uint8Array, prev: Uint8Array, bpp: number): Uint8Array {
  const out = new Uint8Array(row.length + 1);
  out[0] = type;
  for (let i = 0; i < row.length; i++) {
    const a = i >= bpp ? row[i - bpp] : 0;
    const b = prev[i];
    const c = i >= bpp ? prev[i - bpp] : 0;
    let v = 0;
    if (type === 0) v = row[i];
    else if (type === 1) v = row[i] - a;
    else if (type === 2) v = row[i] - b;
    else if (type === 3) v = row[i] - ((a + b) >> 1);
    else {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      v = row[i] - pred;
    }
    out[i + 1] = v & 0xff;
  }
  return out;
}

function encodePNG(): Buffer {
  const bpp = 3;
  const stride = W * bpp;
  const rows: Buffer[] = [];
  let prev = new Uint8Array(stride);
  for (let y = 0; y < H; y++) {
    const row = px.subarray(y * stride, (y + 1) * stride);
    // pick the filter with the smallest sum of absolute signed residuals
    let best = 0;
    let bestScore = Infinity;
    let bestBuf: Uint8Array | null = null;
    for (let t = 0; t < 5; t++) {
      const f = filterRow(t, row, prev, bpp);
      let s = 0;
      for (let i = 1; i < f.length; i++) {
        const v = f[i] < 128 ? f[i] : 256 - f[i];
        s += v;
      }
      if (s < bestScore) {
        bestScore = s;
        best = t;
        bestBuf = f;
      }
    }
    rows.push(Buffer.from(bestBuf!));
    prev = row;
  }
  const raw = Buffer.concat(rows);
  const idat = deflateSync(raw, { level: 9, memLevel: 9 });

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- main

function main(): void {
  drawSky();
  drawSea();
  buildField();
  drawWaveMass();
  drawBirds();
  drawCrestLight();
  drawSpray();
  drawForeground();
  drawSurfer();
  downsample();
  const png = encodePNG();
  const dir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(dir, { recursive: true });
  const out = join(dir, 'entry.png');
  writeFileSync(out, png);
  process.stdout.write(`wrote ${out} (${png.length} bytes)\n`);
}

main();
