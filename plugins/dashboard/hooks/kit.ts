// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

import type { Tile, Tone } from './contract'

// Palette from sem's site (Ataraxy Labs, MIT). See CREDITS.md.
export const PALETTE: Record<Tone | 'bg' | 'surface' | 'border', number> = {
  bg: 0x0a0a0a,
  surface: 0x111111,
  border: 0x222222,
  fg: 0xe0e0e0,
  dim: 0x666666,
  faint: 0x444444,
  accent: 0xffffff,
  add: 0x4ade80,
  mod: 0xfacc15,
  del: 0xf87171,
  info: 0x60a5fa,
  link: 0x22d3ee,
}

const SPACE = 0x20
const SPARK = [0x2581, 0x2582, 0x2583, 0x2584, 0x2585, 0x2586, 0x2587, 0x2588] as const
const RULE = 0x2501

// 3x5 dot font, drawn as Braille: 2 cells wide, 2 rows tall per glyph.
const FONT: Readonly<Record<string, readonly string[]>> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '.##', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '..#', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  ':': ['...', '.#.', '...', '.#.', '...'],
  '%': ['#.#', '..#', '.#.', '#..', '#.#'],
  '.': ['...', '...', '...', '...', '.#.'],
  '-': ['...', '...', '###', '...', '...'],
  $: ['.##', '#..', '.#.', '..#', '##.'],
  k: ['#..', '#.#', '##.', '#.#', '#.#'],
  M: ['#.#', '###', '###', '#.#', '#.#'],
  ' ': ['...', '...', '...', '...', '...'],
}

// Braille dot bits by [column][row] inside one 2x4 cell.
const DOT = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
] as const

// Raster takes printable width-1 BMP characters only. Anything else becomes
// a space rather than failing the whole frame.
const safe = (cp: number): number => (cp < 0x20 || (cp >= 0x7f && cp < 0xa0) || cp > 0xffff ? SPACE : cp)

export class Board {
  readonly cells: Uint32Array
  // Link spans in board cells, for the host to lay Link elements over.
  readonly links: { x: number; y: number; text: string; url: string; tone: Tone }[] = []

  constructor(
    readonly columns: number,
    readonly rows: number,
  ) {
    this.cells = new Uint32Array(columns * rows * 3)
    for (let i = 0; i < columns * rows; i++) {
      this.cells[i * 3] = SPACE
      this.cells[i * 3 + 1] = PALETTE.fg
      this.cells[i * 3 + 2] = PALETTE.bg
    }
  }

  put(x: number, y: number, cp: number, fg: number, bg?: number): void {
    if (x < 0 || y < 0 || x >= this.columns || y >= this.rows) return
    const at = (y * this.columns + x) * 3
    this.cells[at] = safe(cp)
    this.cells[at + 1] = fg
    if (bg !== undefined) this.cells[at + 2] = bg
  }

  // Rounded frame, title set into the top edge, inside filled with surface.
  frame(x: number, y: number, w: number, h: number, title: string, isFocused: boolean): void {
    const edge = isFocused ? PALETTE.dim : PALETTE.border
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const isTop = dy === 0
        const isBottom = dy === h - 1
        const isLeft = dx === 0
        const isRight = dx === w - 1
        const cp =
          isTop && isLeft ? 0x256d : isTop && isRight ? 0x256e : isBottom && isLeft ? 0x2570 : isBottom && isRight ? 0x256f : isTop || isBottom ? 0x2500 : isLeft || isRight ? 0x2502 : SPACE
        this.put(x + dx, y + dy, cp, edge, isTop || isBottom || isLeft || isRight ? PALETTE.bg : PALETTE.surface)
      }
    }
    const label = ` ${title.toUpperCase()} `.slice(0, Math.max(0, w - 4))
    for (let i = 0; i < label.length; i++) {
      this.put(x + 2 + i, y, label.charCodeAt(i), isFocused ? PALETTE.accent : PALETTE.dim, PALETTE.bg)
    }
  }

  tile(x: number, y: number, w: number, h: number, isFocused = false): Tile {
    const left = x + 1
    const top = y + 1
    const cols = Math.max(0, w - 2)
    const rows = Math.max(0, h - 2)
    const put = (cx: number, cy: number, cp: number, tone: Tone) => {
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return
      this.put(left + cx, top + cy, cp, PALETTE[tone], PALETTE.surface)
    }

    return {
      cols,
      rows,
      isFocused,
      text: (tx, ty, s, tone = 'fg') => {
        let i = 0
        for (const ch of s) {
          put(Math.floor(tx) + i, Math.floor(ty), ch.codePointAt(0) ?? SPACE, tone)
          i += 1
        }
      },
      link: (lx, ly, s, url, tone = 'fg') => {
        const x0 = Math.floor(lx)
        const y0 = Math.floor(ly)
        const chars = [...s]
        chars.forEach((ch, i) => put(x0 + i, y0, ch.codePointAt(0) ?? SPACE, tone))
        // Only the part the tile shows becomes a link, so the overlay matches the cells.
        if (y0 < 0 || y0 >= rows || x0 < 0 || x0 >= cols || !url.startsWith('https://')) return
        const shown = chars.slice(0, cols - x0).join('')
        if (shown !== '') this.links.push({ x: left + x0, y: top + y0, text: shown, url, tone })
      },
      digits: (tx, ty, s, tone = 'fg', scale = 1) => {
        const glyphs = [...s].map(ch => FONT[ch] ?? FONT[' ']!)
        // Each font dot becomes scale x scale Braille dots; one blank dot row
        // on top keeps glyphs off the cell above.
        const advance = 4 * scale
        const tall = Math.ceil((5 * scale + 1) / 4)
        for (let cell = 0; cell < (glyphs.length * advance) / 2; cell++) {
          for (let row = 0; row < tall; row++) {
            let bits = 0
            for (let dc = 0; dc < 2; dc++) {
              const dotX = cell * 2 + dc
              const glyph = glyphs[Math.floor(dotX / advance)]!
              const gx = Math.floor((dotX % advance) / scale)
              for (let dr = 0; dr < 4; dr++) {
                const gy = Math.floor((row * 4 + dr - 1) / scale)
                if (row * 4 + dr >= 1 && gx < 3 && gy < 5 && glyph[gy]?.[gx] === '#') bits |= DOT[dc]![dr]!
              }
            }
            put(Math.floor(tx) + cell, Math.floor(ty) + row, 0x2800 + bits, tone)
          }
        }
      },
      meter: (mx, my, width, parts) => {
        let at = 0
        for (const part of parts) {
          const span = Math.round(Math.max(0, part.share) * width)
          for (let i = 0; i < span && at < width; i++, at++) put(Math.floor(mx) + at, Math.floor(my), RULE, part.tone)
        }
        for (; at < width; at++) put(Math.floor(mx) + at, Math.floor(my), RULE, 'faint')
      },
      spark: (sx, sy, width, values, tone = 'dim') => {
        const shown = values.slice(-width)
        const high = Math.max(1, ...shown)
        shown.forEach((v, i) => {
          const level = Math.max(0, Math.min(7, Math.round((v / high) * 7)))
          put(Math.floor(sx) + width - shown.length + i, Math.floor(sy), SPARK[level]!, tone)
        })
      },
    }
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// Native toBase64 in the mod sandbox (2.1.287). Manual path is for Node 20.
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
