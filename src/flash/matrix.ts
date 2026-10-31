import type { ColorTransform, Matrix, Rect } from './types';

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
export const CX_IDENTITY: ColorTransform = [1, 1, 1, 1, 0, 0, 0, 0];

export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return [1, 0, 0, 1, -m[4], -m[5]];
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

export function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function transformRect(m: Matrix, r: Rect): Rect {
  const pts = [apply(m, r[0], r[1]), apply(m, r[2], r[1]), apply(m, r[0], r[3]), apply(m, r[2], r[3])];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

export function concatCx(outer: ColorTransform | null, inner: ColorTransform | null): ColorTransform | null {
  if (!inner) return outer;
  if (!outer) return inner;
  return [
    outer[0] * inner[0],
    outer[1] * inner[1],
    outer[2] * inner[2],
    outer[3] * inner[3],
    outer[0] * inner[4] + outer[4],
    outer[1] * inner[5] + outer[5],
    outer[2] * inner[6] + outer[6],
    outer[3] * inner[7] + outer[7],
  ];
}

export function isIdentityCx(cx: ColorTransform | null): boolean {
  return !cx || (cx[0] === 1 && cx[1] === 1 && cx[2] === 1 && cx[3] === 1 && !cx[4] && !cx[5] && !cx[6] && !cx[7]);
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Applies a color transform to an RGBA color (rgb 0..255, a 0..1). */
export function cxColor(cx: ColorTransform | null, r: number, g: number, b: number, a: number): [number, number, number, number] {
  if (!cx) return [r, g, b, a];
  const na = clamp255(a * 255 * cx[3] + cx[7]) / 255;
  return [clamp255(r * cx[0] + cx[4]), clamp255(g * cx[1] + cx[5]), clamp255(b * cx[2] + cx[6]), na];
}

export function cssColor(r: number, g: number, b: number, a: number): string {
  return `rgba(${r | 0},${g | 0},${b | 0},${a})`;
}
