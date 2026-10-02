// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

import { nextRandom, type Cartridge, type Phase } from '../cartridge'
import { panel, Pixels, scoreBar, UI, write } from '../screen'

export type Board = {
  phase: Phase
  rng: number
  // Row-major, 0 empty.
  tiles: number[]
  score: number
  hasWon: boolean
}

export type Direction = 'up' | 'down' | 'left' | 'right'

const SIZE = 4

// Indices per line, the end a slide packs towards first.
const linesFor = (direction: Direction): number[][] => {
  const lines: number[][] = []
  for (let a = 0; a < SIZE; a++) {
    const line: number[] = []
    for (let b = 0; b < SIZE; b++) {
      switch (direction) {
        case 'left':
          line.push(a * SIZE + b)
          break
        case 'right':
          line.push(a * SIZE + (SIZE - 1 - b))
          break
        case 'up':
          line.push(b * SIZE + a)
          break
        case 'down':
          line.push((SIZE - 1 - b) * SIZE + a)
          break
      }
    }
    lines.push(line)
  }

  return lines
}

// One merge per pair: [2,2,2,2] -> [4,4], not [8].
export const slideLine = (values: readonly number[]): { values: number[]; gained: number } => {
  const packed = values.filter(v => v !== 0)
  const out: number[] = []
  let gained = 0
  for (let i = 0; i < packed.length; i++) {
    const v = packed[i] ?? 0
    if (v === packed[i + 1]) {
      out.push(v * 2)
      gained += v * 2
      i++
    } else {
      out.push(v)
    }
  }
  while (out.length < values.length) out.push(0)

  return { values: out, gained }
}

const spawn = (b: Board) => {
  const empty = b.tiles.flatMap((v, i) => (v === 0 ? [i] : []))
  if (empty.length === 0) return
  const at = empty[Math.floor(nextRandom(b) * empty.length)] ?? 0
  b.tiles[at] = nextRandom(b) < 0.9 ? 2 : 4
}

const canMove = (b: Board): boolean =>
  b.tiles.some((v, i) => {
    if (v === 0) return true
    const right = i % SIZE < SIZE - 1 ? b.tiles[i + 1] : undefined
    const down = b.tiles[i + SIZE]

    return v === right || v === down
  })

export const newBoard = (seed: number): Board => {
  const b: Board = { phase: 'play', rng: seed | 0, tiles: new Array(SIZE * SIZE).fill(0), score: 0, hasWon: false }
  spawn(b)
  spawn(b)

  return b
}

export const slide = (b: Board, direction: Direction): boolean => {
  if (b.phase !== 'play') return false

  let hasMoved = false
  for (const line of linesFor(direction)) {
    const before = line.map(i => b.tiles[i] ?? 0)
    const { values, gained } = slideLine(before)
    line.forEach((i, k) => {
      if (b.tiles[i] !== values[k]) hasMoved = true
      b.tiles[i] = values[k] ?? 0
    })
    b.score += gained
  }
  if (!hasMoved) return false

  spawn(b)
  if (b.tiles.some(v => v >= 2048)) b.hasWon = true
  if (!canMove(b)) b.phase = 'over'

  return true
}

const TILE: Record<number, { bg: number; fg: number }> = {
  0: { bg: 0x3a332e, fg: 0x3a332e },
  2: { bg: 0xeee4da, fg: 0x776e65 },
  4: { bg: 0xede0c8, fg: 0x776e65 },
  8: { bg: 0xf2b179, fg: 0xf9f6f2 },
  16: { bg: 0xf59563, fg: 0xf9f6f2 },
  32: { bg: 0xf67c5f, fg: 0xf9f6f2 },
  64: { bg: 0xf65e3b, fg: 0xf9f6f2 },
  128: { bg: 0xedcf72, fg: 0xf9f6f2 },
  256: { bg: 0xedcc61, fg: 0xf9f6f2 },
  512: { bg: 0xedc850, fg: 0xf9f6f2 },
  1024: { bg: 0xedc53f, fg: 0xf9f6f2 },
  2048: { bg: 0xedc22e, fg: 0xf9f6f2 },
}
const BIG = { bg: 0x3c3a32, fg: 0xf9f6f2 }
const BACKDROP = 0x1d1916
const FRAME = 0x2a2420

export const frameWords = (b: Board, columns: number, rows: number, best: number): Uint32Array => {
  const p = new Pixels(columns, rows)
  p.fill(0, p.w, 0, p.h, BACKDROP)

  // Cells are 1:2, so a square tile is 2 columns per row.
  const byWidth = Math.floor((columns - 5) / SIZE)
  const byHeight = Math.floor((rows - 3 - 5) / SIZE) * 2
  const tileCols = Math.max(4, Math.min(14, byWidth, byHeight))
  const tileRows = Math.max(2, Math.round(tileCols / 2))
  const boardCols = SIZE * tileCols + SIZE + 1
  const boardRows = SIZE * tileRows + SIZE + 1
  const left = Math.max(0, Math.floor((columns - boardCols) / 2))
  const top = Math.max(2, Math.floor((rows - boardRows) / 2))

  p.fill(left, left + boardCols, top * 2, (top + boardRows) * 2, FRAME)
  const spots: { row: number; col: number; value: number }[] = []
  b.tiles.forEach((value, i) => {
    const col = left + 1 + (i % SIZE) * (tileCols + 1)
    const row = top + 1 + Math.floor(i / SIZE) * (tileRows + 1)
    p.fill(col, col + tileCols, row * 2, (row + tileRows) * 2, (TILE[value] ?? BIG).bg)
    spots.push({ row, col, value })
  })

  const cells = p.cells()
  for (const { row, col, value } of spots) {
    if (value === 0) continue
    const colors = TILE[value] ?? BIG
    const text = String(value).slice(0, tileCols)
    write(cells, columns, row + Math.floor((tileRows - 1) / 2), col + Math.floor((tileCols - text.length) / 2), text, colors.fg, colors.bg)
  }

  scoreBar(
    cells,
    columns,
    { text: `${b.score}`, color: UI.text },
    b.hasWon ? { text: '2048!', color: UI.gold } : null,
    { text: `best ${Math.max(best, b.score)}`, color: UI.dim },
  )
  if (b.phase === 'over') {
    panel(cells, columns, rows, [
      { text: 'NO MOVES LEFT', color: UI.accent },
      { text: `score ${b.score}`, color: UI.text },
      { text: 'r for a new board', color: UI.dim },
    ])
  }

  return cells
}

const DIRECTIONS: Record<string, Direction> = { up: 'up', down: 'down', left: 'left', right: 'right' }

export const twenty48: Cartridge = {
  id: '2048',
  title: '2048',
  tickMs: 0,
  controls: [
    { hotkey: 'w', label: 'up', action: 'up' },
    { hotkey: 'a', label: 'left', action: 'left' },
    { hotkey: 's', label: 'down', action: 'down' },
    { hotkey: 'd', label: 'right', action: 'right' },
    { hotkey: 'r', label: 'new', action: 'new' },
  ],
  start: seed => {
    let b = newBoard(seed)

    return {
      get phase() {
        return b.phase
      },
      get score() {
        return b.score
      },
      act: action => {
        if (action === 'new') {
          b = newBoard(Math.floor(nextRandom(b) * 2 ** 31))
          return
        }
        const direction = DIRECTIONS[action]
        if (direction !== undefined) slide(b, direction)
      },
      step: () => false,
      // Turn based. Nothing to pause.
      pause: () => {},
      frame: (columns, rows, best) => frameWords(b, columns, rows, best),
    }
  },
}
