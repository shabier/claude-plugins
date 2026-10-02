// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

// Units are screen heights, 0 top, 1 bottom. Pane size changes the view,
// not the physics.

import { nextRandom, RESTART_MS, type Cartridge, type Phase } from '../cartridge'
import { BAR_PX, hash, mix, panel, Pixels, scoreBar, shade, UI, type Line } from '../screen'

export type Pipe = { x: number; gap: number; isPassed: boolean }

export type Flight = {
  phase: Phase
  rng: number
  y: number
  vy: number
  // Screen heights scrolled.
  travel: number
  pipes: Pipe[]
  score: number
  overMs: number
  wingMs: number
}

export const GROUND = 0.88
export const BIRD_X = 0.2
export const BIRD_R = 0.028
export const PIPE_W = 0.15
export const GAP = 0.3
const SPACING = 0.6
const SPEED = 0.32
const GRAVITY = 2.4
const FLAP_V = -0.72
const MAX_FALL = 1.15

// Clamped so the lower pipe never starts below the ground line.
const gapAt = (f: Flight): number => 0.1 + nextRandom(f) * (GROUND - GAP - 0.18)

export const newFlight = (seed: number, phase: Phase = 'title'): Flight => {
  const f: Flight = { phase, rng: seed | 0, y: 0.45, vy: 0, travel: 0, pipes: [], score: 0, overMs: 0, wingMs: 0 }
  let x = 1.1
  while (x < 3) {
    f.pipes.push({ x, gap: gapAt(f), isPassed: false })
    x += SPACING
  }

  return f
}

const start = (f: Flight): Flight => {
  const next = newFlight(Math.floor(nextRandom(f) * 2 ** 31), 'play')
  next.vy = FLAP_V

  return next
}

export const act = (f: Flight, action: string): Flight => {
  switch (f.phase) {
    case 'title':
      return action === 'pause' ? f : start(f)
    case 'over':
      return f.overMs < RESTART_MS || action === 'pause' ? f : start(f)
    case 'paused':
      f.phase = 'play'
      return f
    case 'play':
      break
  }

  if (action === 'flap') {
    f.vy = FLAP_V
    f.wingMs = 160
  }
  if (action === 'pause') f.phase = 'paused'

  return f
}

const hits = (f: Flight, pipe: Pipe): boolean => {
  // Hitbox at 80% of the sprite. Forgiving on purpose.
  const r = BIRD_R * 0.8
  const birdX = f.travel + BIRD_X
  if (birdX + r < pipe.x || birdX - r > pipe.x + PIPE_W) return false

  return f.y - r < pipe.gap || f.y + r > pipe.gap + GAP
}

export const step = (f: Flight, ms: number): boolean => {
  if (f.phase === 'over') {
    const wasWaiting = f.overMs < RESTART_MS
    f.overMs += ms
    return wasWaiting && f.overMs >= RESTART_MS
  }
  if (f.phase !== 'play') return false

  const dt = Math.min(ms, 100) / 1000
  f.vy = Math.min(MAX_FALL, f.vy + GRAVITY * dt)
  f.y = Math.max(0, f.y + f.vy * dt)
  f.travel += SPEED * dt
  f.wingMs = Math.max(0, f.wingMs - ms)

  for (const pipe of f.pipes) {
    if (!pipe.isPassed && pipe.x + PIPE_W < f.travel + BIRD_X) {
      pipe.isPassed = true
      f.score += 1
    }
  }
  f.pipes = f.pipes.filter(pipe => pipe.x + PIPE_W > f.travel - 0.5)
  const last = f.pipes[f.pipes.length - 1]
  if (last !== undefined && last.x < f.travel + 3) {
    f.pipes.push({ x: last.x + SPACING, gap: gapAt(f), isPassed: false })
  }

  if (f.y + BIRD_R >= GROUND || f.pipes.some(pipe => hits(f, pipe))) {
    f.phase = 'over'
    f.overMs = 0
  }

  return true
}

const COLOR = {
  skyTop: 0x241a33,
  skyLow: 0xd9774a,
  hill: 0x3d2b45,
  hillFar: 0x5a3a52,
  pipe: 0x5aa845,
  pipeLight: 0x8fd16a,
  pipeDark: 0x2f6b26,
  grass: 0x6cbf4a,
  ground: 0xd9b36a,
  groundDark: 0xb8924f,
  bird: 0xf5c542,
  belly: 0xfbe6a2,
  wing: 0xe8a33a,
  eye: 0xffffff,
  pupil: 0x1a1513,
  beak: 0xf07a2a,
} as const

const messageFor = (f: Flight): Line[] => {
  switch (f.phase) {
    case 'title':
      return [
        { text: 'FLAP', color: UI.accent },
        { text: '', color: UI.text },
        { text: 'click here, then w', color: UI.text },
        { text: 'w flaps', color: UI.dim },
      ]
    case 'paused':
      return [
        { text: 'PAUSED', color: UI.accent },
        { text: 'click here, then w', color: UI.text },
      ]
    case 'over':
      return [
        { text: 'BONK', color: UI.accent },
        { text: `score ${f.score}`, color: UI.text },
        { text: f.overMs < RESTART_MS ? '' : 'w to fly again', color: UI.dim },
      ]
    case 'play':
      return []
  }
}

export const frameWords = (f: Flight, columns: number, rows: number, best: number): Uint32Array => {
  const p = new Pixels(columns, rows)
  const h = p.h - BAR_PX
  const toY = (y: number) => BAR_PX + y * h
  const toX = (x: number) => (x - f.travel) * h
  const ground = toY(GROUND)

  for (let y = BAR_PX; y < ground; y++) {
    p.fill(0, p.w, y, y + 1, mix(COLOR.skyTop, COLOR.skyLow, (y - BAR_PX) / (ground - BAR_PX)))
  }

  for (const [speed, height, color, seed] of [
    [0.25, 0.16, COLOR.hillFar, 11],
    [0.5, 0.1, COLOR.hill, 23],
  ] as const) {
    for (let x = 0; x < p.w; x++) {
      const world = x / h + f.travel * speed
      const at = Math.floor(world * 6)
      const t = world * 6 - at
      const a = hash(at + seed)
      const b = hash(at + 1 + seed)
      const top = ground - (0.3 + (a + (b - a) * (3 - 2 * t) * t * t) * 0.7) * height * h
      p.fill(x, x + 1, top, ground, color)
    }
  }

  for (const pipe of f.pipes) {
    const x0 = toX(pipe.x)
    const x1 = toX(pipe.x + PIPE_W)
    if (x1 < 0 || x0 > p.w) continue
    const lip = 0.025 * h
    const gapTop = toY(pipe.gap)
    const gapBottom = toY(pipe.gap + GAP)
    for (const [y0, y1] of [
      [BAR_PX, gapTop],
      [gapBottom, ground],
    ] as const) {
      p.fill(x0, x1, y0, y1, COLOR.pipe)
      p.fill(x0 + (x1 - x0) * 0.15, x0 + (x1 - x0) * 0.3, y0, y1, COLOR.pipeLight)
      p.fill(x1 - (x1 - x0) * 0.15, x1, y0, y1, COLOR.pipeDark)
    }
    p.fill(x0 - lip * 0.6, x1 + lip * 0.6, gapTop - lip, gapTop, COLOR.pipe)
    p.fill(x0 - lip * 0.6, x1 + lip * 0.6, gapBottom, gapBottom + lip, COLOR.pipe)
    p.fill(x0 - lip * 0.6, x1 + lip * 0.6, gapTop - 1, gapTop, COLOR.pipeDark)
    p.fill(x0 - lip * 0.6, x1 + lip * 0.6, gapBottom, gapBottom + 1, COLOR.pipeLight)
  }

  p.fill(0, p.w, ground, ground + 1, COLOR.grass)
  for (let x = 0; x < p.w; x++) {
    const stripe = Math.floor((x / h + f.travel) * 25) % 2 === 0
    p.fill(x, x + 1, ground + 1, p.h, stripe ? COLOR.ground : COLOR.groundDark)
  }

  const cx = BIRD_X * h
  const cy = toY(f.y)
  const r = Math.max(2, BIRD_R * h * 1.25)
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r * 1.2); x <= Math.ceil(cx + r * 1.2); x++) {
      const dx = (x + 0.5 - cx) / (r * 1.2)
      const dy = (y + 0.5 - cy) / r
      if (dx * dx + dy * dy > 1) continue
      p.dot(x, y, dy > 0.3 ? COLOR.belly : COLOR.bird)
    }
  }
  const wingUp = f.wingMs > 0 || f.vy < -0.2
  p.fill(cx - r * 1.1, cx - r * 0.1, cy + (wingUp ? -r * 0.7 : 0), cy + (wingUp ? -r * 0.1 : r * 0.6), COLOR.wing)
  p.fill(cx + r * 0.25, cx + r * 0.85, cy - r * 0.75, cy - r * 0.1, COLOR.eye)
  p.dot(cx + r * 0.55, cy - r * 0.45, COLOR.pupil)
  p.fill(cx + r * 0.9, cx + r * 1.7, cy - r * 0.05, cy + r * 0.45, COLOR.beak)
  if (f.phase === 'over') p.fill(cx - r, cx + r, cy - r, cy + r, shade(COLOR.bird, 0.7))

  const cells = p.cells()
  scoreBar(cells, columns, { text: `${f.score}`, color: UI.text }, null, { text: `best ${Math.max(best, f.score)}`, color: UI.dim })
  panel(cells, columns, rows, messageFor(f))

  return cells
}

export const flap: Cartridge = {
  id: 'flap',
  title: 'Flap',
  tickMs: 33,
  controls: [
    { hotkey: 'w', label: 'flap', action: 'flap' },
    { hotkey: 'p', label: 'pause', action: 'pause' },
  ],
  start: seed => {
    let f = newFlight(seed)

    return {
      get phase() {
        return f.phase
      },
      get score() {
        return f.score
      },
      act: action => {
        f = act(f, action)
      },
      step: ms => step(f, ms),
      pause: () => {
        if (f.phase === 'play') f.phase = 'paused'
      },
      frame: (columns, rows, best) => frameWords(f, columns, rows, best),
    }
  },
}
