// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

import { nextRandom, RESTART_MS, type Cartridge, type Phase } from '../cartridge'
import { BAR_PX, mix, panel, Pixels, scoreBar, shade, UI, type Line } from '../screen'

export const WIDTH = 10
export const HEIGHT = 20
// Spawn rows above the well. Never drawn.
const HIDDEN = 2

// Spawn rotation + rotation box. Box 0 = O piece, never turns.
const SHAPES: readonly { cells: readonly (readonly [number, number])[]; box: number }[] = [
  { cells: [[0, 1], [1, 1], [2, 1], [3, 1]], box: 4 },
  { cells: [[1, 0], [2, 0], [1, 1], [2, 1]], box: 0 },
  { cells: [[1, 0], [0, 1], [1, 1], [2, 1]], box: 3 },
  { cells: [[1, 0], [2, 0], [0, 1], [1, 1]], box: 3 },
  { cells: [[0, 0], [1, 0], [1, 1], [2, 1]], box: 3 },
  { cells: [[0, 0], [0, 1], [1, 1], [2, 1]], box: 3 },
  { cells: [[2, 0], [0, 1], [1, 1], [2, 1]], box: 3 },
]

const COLORS = [0x3fc6d9, 0xf2c94c, 0xa65fd6, 0x5cc46b, 0xe0533d, 0x3f78d9, 0xf08a3c] as const

export type Piece = { kind: number; rot: number; x: number; y: number }

export type Well = {
  phase: Phase
  rng: number
  // Row-major, HIDDEN + HEIGHT rows. 0 empty, else kind + 1.
  board: number[]
  piece: Piece
  next: number
  bag: number[]
  score: number
  lines: number
  fallMs: number
  overMs: number
}

const ROWS = HIDDEN + HEIGHT

export const cellsOf = (piece: Piece): [number, number][] => {
  const shape = SHAPES[piece.kind] ?? SHAPES[0]!
  return shape.cells.map(([cx, cy]) => {
    let x = cx
    let y = cy
    for (let r = 0; r < piece.rot % 4 && shape.box > 0; r++) {
      const turned = shape.box - 1 - y
      y = x
      x = turned
    }

    return [piece.x + x, piece.y + y]
  })
}

const fits = (w: Well, piece: Piece): boolean =>
  cellsOf(piece).every(([x, y]) => x >= 0 && x < WIDTH && y < ROWS && (y < 0 || w.board[y * WIDTH + x] === 0))

// 7-bag: each kind once per bag. No droughts.
const draw = (w: Well): number => {
  if (w.bag.length === 0) {
    w.bag = [0, 1, 2, 3, 4, 5, 6]
    for (let i = w.bag.length - 1; i > 0; i--) {
      const j = Math.floor(nextRandom(w) * (i + 1))
      const swap = w.bag[i] ?? 0
      w.bag[i] = w.bag[j] ?? 0
      w.bag[j] = swap
    }
  }

  return w.bag.pop() ?? 0
}

// Lower row spawns visible. Fully hidden spawns stayed invisible for 1.6s
// at level 1.
const spawnPiece = (w: Well) => {
  w.piece = { kind: w.next, rot: 0, x: 3, y: HIDDEN - 1 }
  w.next = draw(w)
  if (!fits(w, w.piece)) {
    w.phase = 'over'
    w.overMs = 0
  }
}

export const level = (w: Well): number => 1 + Math.floor(w.lines / 10)

const fallInterval = (w: Well): number => Math.max(90, 800 - (level(w) - 1) * 70)

export const newWell = (seed: number, phase: Phase = 'title'): Well => {
  const w: Well = {
    phase,
    rng: seed | 0,
    board: new Array(ROWS * WIDTH).fill(0),
    piece: { kind: 0, rot: 0, x: 3, y: 0 },
    next: 0,
    bag: [],
    score: 0,
    lines: 0,
    fallMs: 0,
    overMs: 0,
  }
  w.next = draw(w)
  spawnPiece(w)

  return w
}

const LINE_SCORES = [0, 100, 300, 500, 800] as const

const lock = (w: Well) => {
  for (const [x, y] of cellsOf(w.piece)) {
    if (y >= 0) w.board[y * WIDTH + x] = w.piece.kind + 1
  }

  let cleared = 0
  for (let y = ROWS - 1; y >= 0; y--) {
    const row = w.board.slice(y * WIDTH, (y + 1) * WIDTH)
    if (row.every(v => v !== 0)) {
      w.board.splice(y * WIDTH, WIDTH)
      w.board.unshift(...new Array(WIDTH).fill(0))
      cleared += 1
      y += 1
    }
  }
  w.score += (LINE_SCORES[cleared] ?? 800) * level(w)
  w.lines += cleared
  w.fallMs = 0
  spawnPiece(w)
}

const shift = (w: Well, dx: number, dy: number): boolean => {
  const moved = { ...w.piece, x: w.piece.x + dx, y: w.piece.y + dy }
  if (!fits(w, moved)) return false
  w.piece = moved

  return true
}

// Kicks: 0, -1, +1, -2, +2 columns. Not SRS.
const rotate = (w: Well) => {
  const turned = { ...w.piece, rot: (w.piece.rot + 1) % 4 }
  for (const kick of [0, -1, 1, -2, 2]) {
    const tried = { ...turned, x: turned.x + kick }
    if (fits(w, tried)) {
      w.piece = tried
      return
    }
  }
}

export const dropRow = (w: Well): number => {
  let ghost = w.piece
  for (;;) {
    const lower = { ...ghost, y: ghost.y + 1 }
    if (!fits(w, lower)) return ghost.y
    ghost = lower
  }
}

const start = (w: Well): Well => newWell(Math.floor(nextRandom(w) * 2 ** 31), 'play')

export const act = (w: Well, action: string): Well => {
  switch (w.phase) {
    case 'title':
      return action === 'pause' ? w : start(w)
    case 'over':
      return w.overMs < RESTART_MS || action === 'pause' ? w : start(w)
    case 'paused':
      w.phase = 'play'
      return w
    case 'play':
      break
  }

  if (action === 'left') shift(w, -1, 0)
  if (action === 'right') shift(w, 1, 0)
  if (action === 'rotate') rotate(w)
  if (action === 'down') {
    if (shift(w, 0, 1)) w.score += 1
    else lock(w)
  }
  if (action === 'drop') {
    const to = dropRow(w)
    w.score += (to - w.piece.y) * 2
    w.piece = { ...w.piece, y: to }
    lock(w)
  }
  if (action === 'pause') w.phase = 'paused'

  return w
}

export const step = (w: Well, ms: number): boolean => {
  if (w.phase === 'over') {
    const wasWaiting = w.overMs < RESTART_MS
    w.overMs += ms
    return wasWaiting && w.overMs >= RESTART_MS
  }
  if (w.phase !== 'play') return false

  w.fallMs += ms
  let hasMoved = false
  while (w.fallMs >= fallInterval(w) && w.phase === 'play') {
    w.fallMs -= fallInterval(w)
    if (!shift(w, 0, 1)) lock(w)
    hasMoved = true
  }

  return hasMoved
}

const WELL_BG = 0x14110f
const WELL_DOT = 0x221d1a
const WELL_EDGE = 0x5b5651
const BACKDROP = 0x1d1916

const brick = (p: Pixels, x: number, y: number, size: number, color: number) => {
  p.fill(x, x + size, y, y + size, color)
  if (size < 3) return
  p.fill(x, x + size, y, y + 1, mix(color, 0xffffff, 0.35))
  p.fill(x, x + 1, y, y + size, mix(color, 0xffffff, 0.2))
  p.fill(x, x + size, y + size - 1, y + size, shade(color, 0.6))
  p.fill(x + size - 1, x + size, y, y + size, shade(color, 0.7))
}

const messageFor = (w: Well): Line[] => {
  switch (w.phase) {
    case 'title':
      return [
        { text: 'BLOCK DROP', color: UI.accent },
        { text: '', color: UI.text },
        { text: 'click here, then w', color: UI.text },
        { text: 'a d move  w turn', color: UI.dim },
        { text: 's down  x drop', color: UI.dim },
      ]
    case 'paused':
      return [
        { text: 'PAUSED', color: UI.accent },
        { text: 'click here, then w', color: UI.text },
      ]
    case 'over':
      return [
        { text: 'TOPPED OUT', color: UI.accent },
        { text: `score ${w.score}  lines ${w.lines}`, color: UI.text },
        { text: w.overMs < RESTART_MS ? '' : 'w to play again', color: UI.dim },
      ]
    case 'play':
      return []
  }
}

export const frameWords = (w: Well, columns: number, rows: number, best: number): Uint32Array => {
  const p = new Pixels(columns, rows)
  p.fill(0, p.w, 0, p.h, BACKDROP)

  // 12px side column: 4 bricks of the next piece at size 2.
  const side = 12
  const size = Math.max(1, Math.min(Math.floor((p.w - 2 - side) / WIDTH), Math.floor((p.h - BAR_PX - 4) / HEIGHT)))
  const wellW = WIDTH * size
  const wellH = HEIGHT * size
  const left = Math.max(1, Math.floor((p.w - wellW - side) / 2))
  const top = BAR_PX + Math.max(1, Math.floor((p.h - BAR_PX - wellH) / 2))

  p.fill(left - 1, left + wellW + 1, top - 1, top + wellH + 1, WELL_EDGE)
  p.fill(left, left + wellW, top, top + wellH, WELL_BG)
  if (size >= 3) {
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) p.dot(left + x * size + Math.floor(size / 2), top + y * size + Math.floor(size / 2), WELL_DOT)
    }
  }

  for (let y = HIDDEN; y < ROWS; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const v = w.board[y * WIDTH + x] ?? 0
      if (v !== 0) brick(p, left + x * size, top + (y - HIDDEN) * size, size, COLORS[v - 1] ?? COLORS[0])
    }
  }

  if (w.phase === 'play' || w.phase === 'paused') {
    const color = COLORS[w.piece.kind] ?? COLORS[0]
    const ghostY = dropRow(w)
    for (const [x, y] of cellsOf({ ...w.piece, y: ghostY })) {
      if (y >= HIDDEN) p.fill(left + x * size, left + (x + 1) * size, top + (y - HIDDEN) * size, top + (y - HIDDEN + 1) * size, shade(color, 0.3))
    }
    for (const [x, y] of cellsOf(w.piece)) {
      if (y >= HIDDEN) brick(p, left + x * size, top + (y - HIDDEN) * size, size, color)
    }
  }

  const small = Math.max(1, Math.min(size, 2))
  const nx = left + wellW + 3
  const ny = top + 2
  for (const [x, y] of cellsOf({ kind: w.next, rot: 0, x: 0, y: 0 })) {
    brick(p, nx + x * small, ny + y * small, small, COLORS[w.next] ?? COLORS[0])
  }

  const cells = p.cells()
  scoreBar(
    cells,
    columns,
    { text: `${w.score}`, color: UI.text },
    { text: `L${level(w)} ${w.lines}`, color: UI.gold },
    { text: `best ${Math.max(best, w.score)}`, color: UI.dim },
  )
  panel(cells, columns, rows, messageFor(w))

  return cells
}

export const blockDrop: Cartridge = {
  id: 'blocks',
  title: 'Block Drop',
  tickMs: 50,
  controls: [
    { hotkey: 'a', label: 'left', action: 'left' },
    { hotkey: 'd', label: 'right', action: 'right' },
    { hotkey: 'w', label: 'turn', action: 'rotate' },
    { hotkey: 's', label: 'down', action: 'down' },
    { hotkey: 'x', label: 'drop', action: 'drop' },
    { hotkey: 'p', label: 'pause', action: 'pause' },
  ],
  start: seed => {
    let w = newWell(seed)

    return {
      get phase() {
        return w.phase
      },
      get score() {
        return w.score
      },
      act: action => {
        w = act(w, action)
      },
      step: ms => step(w, ms),
      pause: () => {
        if (w.phase === 'play') w.phase = 'paused'
      },
      frame: (columns, rows, best) => frameWords(w, columns, rows, best),
    }
  },
}
