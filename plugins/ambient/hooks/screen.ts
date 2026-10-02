// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

// Fork of plugins/arcade/hooks/screen.ts. Plugins install one by one, so
// nothing is shared across plugin folders. No score bar here: full bleed.

const UPPER_HALF = 0x2580

export const clamp01 = (n: number): number => Math.max(0, Math.min(1, n))
export const frac = (n: number): number => n - Math.floor(n)

export const mix = (a: number, b: number, t: number): number => {
  const k = clamp01(t)
  const channel = (shift: number) => {
    const x = (a >> shift) & 0xff
    const y = (b >> shift) & 0xff

    return Math.round(x + (y - x) * k) << shift
  }

  return channel(16) | channel(8) | channel(0)
}

export const shade = (c: number, f: number): number => mix(0, c, f)

// MurmurHash3 fmix32 (Austin Appleby, public domain).
export const hash = (n: number): number => {
  let t = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  t ^= t >>> 13
  t = Math.imul(t, 0xc2b2ae35)
  t ^= t >>> 16

  return (t >>> 0) / 4294967296
}

export const hash2 = (x: number, y: number): number => hash(Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663))

// Value noise, smoothstep between integer lattice points.
export const noise1 = (x: number, seed: number): number => {
  const i = Math.floor(x)
  const f = x - i
  const a = hash(i * 7919 + seed)
  const b = hash((i + 1) * 7919 + seed)

  return a + (b - a) * f * f * (3 - 2 * f)
}

export const fbm1 = (x: number, seed: number, octaves = 4): number => {
  let sum = 0
  let amp = 0.5
  let norm = 0
  for (let o = 0; o < octaves; o++) {
    sum += noise1(x * 2 ** o, seed + o * 101) * amp
    norm += amp
    amp *= 0.5
  }

  return sum / norm
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16)

// Ordered 4x4 dither between two colours: the 8-bit look for gradients and fog.
export const dither = (a: number, b: number, t: number, x: number, y: number): number =>
  t > (BAYER[(y & 3) * 4 + (x & 3)] ?? 0.5) ? b : a

// Dithered ramp over palette stops, t in [0, 1].
export const ramp = (stops: readonly number[], t: number, x: number, y: number): number => {
  const at = clamp01(t) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(at))

  return dither(stops[i] ?? 0, stops[i + 1] ?? 0, at - i, x, y)
}

export class Pixels {
  readonly w: number
  readonly h: number
  readonly px: Uint32Array

  constructor(
    readonly columns: number,
    readonly rows: number,
  ) {
    this.w = columns
    this.h = rows * 2
    this.px = new Uint32Array(this.w * this.h)
  }

  get(x: number, y: number): number {
    const px = Math.max(0, Math.min(this.w - 1, Math.floor(x)))
    const py = Math.max(0, Math.min(this.h - 1, Math.floor(y)))

    return this.px[py * this.w + px] ?? 0
  }

  dot(x: number, y: number, color: number): void {
    const px = Math.floor(x)
    const py = Math.floor(y)
    if (px < 0 || px >= this.w || py < 0 || py >= this.h) return
    this.px[py * this.w + px] = color
  }

  // Min 1px each way. Far objects shrink below a pixel and would vanish.
  fill(x0: number, x1: number, y0: number, y1: number, color: number): void {
    const left = Math.max(0, Math.round(x0))
    const right = Math.min(this.w, Math.max(left + 1, Math.round(x1)))
    const top = Math.max(0, Math.round(y0))
    const bottom = Math.min(this.h, Math.max(top + 1, Math.round(y1)))
    for (let y = top; y < bottom; y++) this.px.fill(color, y * this.w + left, y * this.w + right)
  }

  disc(cx: number, cy: number, r: number, color: number): void {
    const rr = Math.max(0.5, r)
    for (let y = Math.floor(cy - rr); y <= Math.ceil(cy + rr); y++) {
      for (let x = Math.floor(cx - rr); x <= Math.ceil(cx + rr); x++) {
        const dx = x + 0.5 - cx
        const dy = y + 0.5 - cy
        if (dx * dx + dy * dy <= rr * rr) this.dot(x, y, color)
      }
    }
  }

  cells(): Uint32Array {
    const out = new Uint32Array(this.columns * this.rows * 3)
    for (let r = 0; r < this.rows; r++) {
      for (let x = 0; x < this.columns; x++) {
        const at = (r * this.columns + x) * 3
        out[at] = UPPER_HALF
        out[at + 1] = this.px[2 * r * this.w + x] ?? 0
        out[at + 2] = this.px[(2 * r + 1) * this.w + x] ?? 0
      }
    }

    return out
  }
}

// ASCII only. Raster refuses anything not width 1. Background comes from the
// cell's lower pixel so the label sits on the scene, not on a box.
export const label = (cells: Uint32Array, columns: number, row: number, col: number, text: string, fg: number): void => {
  for (let i = 0; i < text.length; i++) {
    const x = col + i
    const at = (row * columns + x) * 3
    if (x < 0 || x >= columns || at + 2 >= cells.length) continue
    cells[at] = text.charCodeAt(i)
    cells[at + 1] = fg
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// Native toBase64 in the mod sandbox (2.1.287). Manual path is for Node 20
// previews.
export const base64 = (bytes: Uint8Array): string => {
  const native = (bytes as unknown as { toBase64?: () => string }).toBase64
  if (typeof native === 'function') return native.call(bytes)

  const out: string[] = []
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out.push(B64.charAt((n >> 18) & 63), B64.charAt((n >> 12) & 63), B64.charAt((n >> 6) & 63), B64.charAt(n & 63))
  }
  const rest = bytes.length - i
  if (rest > 0) {
    const n = ((bytes[i] ?? 0) << 16) | (rest > 1 ? (bytes[i + 1] ?? 0) << 8 : 0)
    out.push(B64.charAt((n >> 18) & 63), B64.charAt((n >> 12) & 63), rest > 1 ? B64.charAt((n >> 6) & 63) : '=', '=')
  }

  return out.join('')
}

export const encodeCells = (cells: Uint32Array): string =>
  base64(new Uint8Array(cells.buffer, cells.byteOffset, cells.byteLength))

export type Scene = {
  id: string
  title: string
  // t in seconds since the pane opened.
  draw(p: Pixels, t: number): void
}
