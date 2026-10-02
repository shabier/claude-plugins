// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

// Half-block renderer: U+2580 per cell, fg = top pixel, bg = bottom.
// Text overlays whole cells. Colours are 0xRRGGBB.

const UPPER_HALF = 0x2580

// Row 0 is the score bar. Pixels start at y = 2.
export const BAR_PX = 2

export const UI = {
  bar: 0x15110f,
  text: 0xf3e6d8,
  dim: 0x9c8b7d,
  accent: 0xff7a3d,
  gold: 0xffcf3f,
} as const

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

export const hash = (n: number): number => {
  let t = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  t ^= t >>> 13
  t = Math.imul(t, 0xc2b2ae35)
  t ^= t >>> 16

  return (t >>> 0) / 4294967296
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

  // Min 1px each way. Far objects shrink below a pixel and would vanish.
  fill(x0: number, x1: number, y0: number, y1: number, color: number): void {
    const left = Math.max(0, Math.round(x0))
    const right = Math.min(this.w, Math.max(left + 1, Math.round(x1)))
    const top = Math.max(BAR_PX, Math.round(y0))
    const bottom = Math.min(this.h, Math.max(top + 1, Math.round(y1)))
    for (let y = top; y < bottom; y++) {
      this.px.fill(color, y * this.w + left, y * this.w + right)
    }
  }

  dot(x: number, y: number, color: number): void {
    const px = Math.floor(x)
    const py = Math.floor(y)
    if (px < 0 || px >= this.w || py < BAR_PX || py >= this.h) return
    this.px[py * this.w + px] = color
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

// ASCII only. Raster refuses anything not width 1, and ambiguous-width
// glyphs differ per terminal.
export const write = (
  cells: Uint32Array,
  columns: number,
  row: number,
  col: number,
  text: string,
  fg: number,
  bg: number,
): void => {
  if (row < 0 || row * columns * 3 >= cells.length) return
  for (let i = 0; i < text.length; i++) {
    const x = col + i
    if (x < 0 || x >= columns) continue
    const at = (row * columns + x) * 3
    cells[at] = text.charCodeAt(i)
    cells[at + 1] = fg
    cells[at + 2] = bg
  }
}

export type Line = { text: string; color: number }

// Narrow bar: the middle drops first, then the right.
export const scoreBar = (cells: Uint32Array, columns: number, left: Line, middle: Line | null, right: Line): void => {
  write(cells, columns, 0, 0, ' '.repeat(columns), UI.text, UI.bar)
  const l = ` ${left.text}`
  const r = `${right.text} `
  write(cells, columns, 0, 0, l, left.color, UI.bar)
  if (middle !== null && columns >= l.length + middle.text.length + r.length + 2) {
    write(cells, columns, 0, Math.floor((columns - middle.text.length) / 2), middle.text, middle.color, UI.bar)
  }
  if (columns >= l.length + r.length + 1) write(cells, columns, 0, columns - r.length, r, right.color, UI.bar)
}

// `at`: panel top as a fraction of screen height.
export const panel = (cells: Uint32Array, columns: number, rows: number, lines: readonly Line[], at = 0.3): void => {
  if (lines.length === 0) return
  const width = Math.min(columns, Math.max(...lines.map(line => line.text.length)) + 4)
  const left = Math.floor((columns - width) / 2)
  const first = Math.max(2, Math.floor(rows * at))
  for (let i = -1; i <= lines.length; i++) {
    write(cells, columns, first + i, left, ' '.repeat(width), UI.text, UI.bar)
  }
  lines.forEach((line, i) => {
    const text = line.text.slice(0, columns)
    write(cells, columns, first + i, Math.floor((columns - text.length) / 2), text, line.color, UI.bar)
  })
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// Native toBase64 in the mod sandbox (2.1.287). Manual path is for Node 20
// previews.
export const encode = (words: Uint32Array): string => {
  const bytes = new Uint8Array(words.buffer, words.byteOffset, words.byteLength)
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
