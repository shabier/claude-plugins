// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

import { nextRandom, RESTART_MS, type Cartridge, type Phase } from '../cartridge'
import { BAR_PX, hash, panel, Pixels, scoreBar, shade, UI, type Line } from '../screen'

// Fixed world width. Pane width scales the view, not the game.
export const WIDTH = 9
export const TRAIN_LEN = 16
const START_GRASS = 4
const HOP_MS = 110
// Lanes/s once you move. Stand still ~16s and the eagle gets you.
const CREEP = 0.28
// Lanes kept below the player.
const BEHIND = 4
// Wrap margin. Must exceed the longest log (4) or logs pop in at the edge.
const PAD = 5
const LOOP = WIDTH + 2 * PAD
const TRAIN_SPEED = 22
const WARN_MS = 1300

export type Mover = { x: number; len: number; tint: number }

export type Lane =
  | { kind: 'grass'; trees: number[] }
  | { kind: 'road'; dir: 1 | -1; speed: number; movers: Mover[] }
  | { kind: 'river'; dir: 1 | -1; speed: number; movers: Mover[] }
  | { kind: 'rail'; dir: 1 | -1; waitMs: number; train: number | null }

export type Kind = Lane['kind']
export type Death = 'squashed' | 'splash' | 'swept' | 'train' | 'eagle'
type Facing = 'up' | 'down' | 'left' | 'right'

export type Hop = {
  phase: Phase
  rng: number
  // lanes[i] is lane `base + i`. Lanes below the view get shifted out.
  lanes: Lane[]
  base: number
  // Fractional while a log carries you.
  x: number
  lane: number
  fromX: number
  fromLane: number
  hopMs: number
  facing: Facing
  // Lane at the bottom edge. Fractional, so the view scrolls smoothly.
  view: number
  hasMoved: boolean
  score: number
  overMs: number
  death: Death | null
  // Tree-free column carried between grass lanes. Without it two grass lanes
  // can wall you in.
  pathCol: number
  plan: Kind[]
}

const below = (h: Hop, n: number): number => Math.floor(nextRandom(h) * n)
const sign = (h: Hop): 1 | -1 => (nextRandom(h) < 0.5 ? 1 : -1)

export const wrap = (x: number): number => (((x + PAD) % LOOP) + LOOP) % LOOP - PAD

const CAR_TINTS = [0xd94f3a, 0x3f78d9, 0xf2c94c, 0x3fb6a8, 0xa65fd6] as const

const fillLoop = (h: Hop, lengthOf: () => number, gapMin: number, gapMax: number, tinted: boolean): Mover[] => {
  const movers: Mover[] = []
  let u = nextRandom(h) * 2
  for (;;) {
    const len = lengthOf()
    if (u + len + gapMin > LOOP) break
    movers.push({ x: u - PAD, len, tint: tinted ? (CAR_TINTS[below(h, CAR_TINTS.length)] ?? CAR_TINTS[0]) : 0 })
    u += len + gapMin + below(h, gapMax - gapMin + 1)
  }

  return movers
}

// Every hazard group ends in 1-2 grass lanes.
const nextGroup = (h: Hop): Kind[] => {
  const r = nextRandom(h)
  const group: Kind[] =
    r < 0.4
      ? new Array<Kind>(1 + below(h, 3)).fill('road')
      : r < 0.66
        ? new Array<Kind>(1 + below(h, 2)).fill('river')
        : r < 0.82
          ? ['rail']
          : []

  return [...group, ...new Array<Kind>(1 + below(h, 2)).fill('grass')]
}

const makeLane = (h: Hop, n: number): Lane => {
  if (n < START_GRASS) return { kind: 'grass', trees: [] }
  if (h.plan.length === 0) h.plan = nextGroup(h)

  // Up to 1.5x speed by lane 160.
  const faster = 1 + Math.min(1, n / 160) * 0.5
  const kind = h.plan.shift() ?? 'grass'
  switch (kind) {
    case 'grass': {
      const next = Math.max(0, Math.min(WIDTH - 1, h.pathCol + below(h, 5) - 2))
      const low = Math.min(h.pathCol, next)
      const high = Math.max(h.pathCol, next)
      h.pathCol = next
      const trees: number[] = []
      for (let i = below(h, 4); i > 0; i--) {
        const col = below(h, WIDTH)
        if ((col < low || col > high) && !trees.includes(col)) trees.push(col)
      }
      return { kind: 'grass', trees }
    }
    case 'road':
      return {
        kind: 'road',
        dir: sign(h),
        speed: (1.2 + nextRandom(h) * 1.8) * faster,
        movers: fillLoop(h, () => (nextRandom(h) < 0.65 ? 1 : 2), 3, 6, true),
      }
    case 'river':
      return {
        kind: 'river',
        dir: sign(h),
        speed: (0.7 + nextRandom(h) * 0.8) * faster,
        movers: fillLoop(h, () => 2 + below(h, 3), 1, 3, false),
      }
    case 'rail':
      return { kind: 'rail', dir: sign(h), waitMs: 1500 + nextRandom(h) * 3500, train: null }
  }
}

export const laneAt = (h: Hop, n: number): Lane => {
  while (h.base + h.lanes.length <= n) h.lanes.push(makeLane(h, h.base + h.lanes.length))

  return h.lanes[n - h.base] ?? { kind: 'grass', trees: [] }
}

export const newHop = (seed: number, phase: Phase = 'title'): Hop => {
  const h: Hop = {
    phase,
    rng: seed | 0,
    lanes: [],
    base: 0,
    x: Math.floor(WIDTH / 2),
    lane: 0,
    fromX: Math.floor(WIDTH / 2),
    fromLane: 0,
    hopMs: 0,
    facing: 'up',
    view: -BEHIND,
    hasMoved: false,
    score: 0,
    overMs: 0,
    death: null,
    pathCol: Math.floor(WIDTH / 2),
    plan: [],
  }
  laneAt(h, 40)

  return h
}

const die = (h: Hop, death: Death) => {
  h.phase = 'over'
  h.death = death
  h.overMs = 0
}

const hop = (h: Hop, dx: number, dLane: number, facing: Facing) => {
  h.facing = facing
  const toLane = h.lane + dLane
  // Leaving a log snaps to the grid.
  const toX = Math.round(h.x) + dx
  if (toLane < 0 || toLane < h.view - 0.2 || toX < 0 || toX >= WIDTH) return
  const target = laneAt(h, toLane)
  if (target.kind === 'grass' && target.trees.includes(toX)) return

  h.fromX = h.x
  h.fromLane = h.lane
  h.hopMs = HOP_MS
  h.x = toX
  h.lane = toLane
  h.hasMoved = true
  h.score = Math.max(h.score, toLane)
  laneAt(h, toLane + 40)
}

const start = (h: Hop): Hop => newHop(Math.floor(nextRandom(h) * 2 ** 31), 'play')

export const act = (h: Hop, action: string): Hop => {
  switch (h.phase) {
    case 'title':
      return action === 'pause' ? h : start(h)
    case 'over':
      return h.overMs < RESTART_MS || action === 'pause' ? h : start(h)
    case 'paused':
      h.phase = 'play'
      return h
    case 'play':
      break
  }

  if (action === 'forward') hop(h, 0, 1, 'up')
  if (action === 'back') hop(h, 0, -1, 'down')
  if (action === 'left') hop(h, -1, 0, 'left')
  if (action === 'right') hop(h, 1, 0, 'right')
  if (action === 'pause') h.phase = 'paused'

  return h
}

const moveLane = (h: Hop, lane: Lane, ms: number) => {
  const dt = ms / 1000
  if (lane.kind === 'road' || lane.kind === 'river') {
    for (const m of lane.movers) m.x = wrap(m.x + lane.dir * lane.speed * dt)
    return
  }
  if (lane.kind !== 'rail') return

  if (lane.train === null) {
    lane.waitMs -= ms
    if (lane.waitMs <= 0) lane.train = lane.dir > 0 ? -TRAIN_LEN - 1 : WIDTH + 1
    return
  }
  lane.train += lane.dir * TRAIN_SPEED * dt
  const isGone = lane.dir > 0 ? lane.train > WIDTH + 1 : lane.train + TRAIN_LEN < -1
  if (isGone) {
    lane.train = null
    lane.waitMs = 2500 + nextRandom(h) * 4000
  }
}

const overlaps = (a0: number, a1: number, b0: number, b1: number): boolean => a0 < b1 && b0 < a1

export const logUnder = (lane: Lane, x: number): Mover | undefined =>
  lane.kind === 'river' ? lane.movers.find(m => x + 0.5 >= m.x && x + 0.5 <= m.x + m.len) : undefined

export const step = (h: Hop, ms: number): boolean => {
  if (h.phase === 'over') {
    const wasWaiting = h.overMs < RESTART_MS
    h.overMs += ms
    return wasWaiting && h.overMs >= RESTART_MS
  }
  if (h.phase !== 'play') return false

  const clipped = Math.min(ms, 100)
  const dt = clipped / 1000
  h.hopMs = Math.max(0, h.hopMs - clipped)
  for (const lane of h.lanes) moveLane(h, lane, clipped)

  const here = laneAt(h, h.lane)
  if (here.kind === 'river' && h.hopMs === 0) {
    if (logUnder(here, h.x) === undefined) die(h, 'splash')
    else {
      h.x += here.dir * here.speed * dt
      if (h.x < -0.45 || h.x > WIDTH - 0.55) die(h, 'swept')
    }
  }
  if (here.kind === 'road' && here.movers.some(m => overlaps(m.x, m.x + m.len, h.x + 0.2, h.x + 0.8))) {
    die(h, 'squashed')
  }
  if (here.kind === 'rail' && here.train !== null && overlaps(here.train, here.train + TRAIN_LEN, h.x + 0.1, h.x + 0.9)) {
    die(h, 'train')
  }

  if (h.hasMoved) h.view += CREEP * dt
  h.view = Math.max(h.view, h.lane - BEHIND)
  if (h.phase === 'play' && h.lane < h.view - 0.6) die(h, 'eagle')

  while (h.base < h.view - 6 && h.lanes.length > 1) {
    h.lanes.shift()
    h.base += 1
  }

  return true
}

const COLOR = {
  grass: 0x5fa34a,
  grassAlt: 0x569a44,
  road: 0x3a3533,
  dash: 0xd8d0c0,
  curb: 0x5b5651,
  water: 0x2e6fa8,
  ripple: 0x4a8ccc,
  log: 0x7a5232,
  logEnd: 0x9c6b44,
  bark: 0x5e3e26,
  gravel: 0x4a3f38,
  tie: 0x6d4b33,
  rail: 0xc4beb6,
  lightOn: 0xff4a36,
  lightOff: 0x5a2a22,
  trunk: 0x6b4a32,
  leaf: 0x2f7a3a,
  leafLight: 0x45a050,
  leafDark: 0x245e2c,
  glass: 0x9fd3e6,
  cargo: 0xe8e2d8,
  train: 0xc8452c,
  chicken: 0xf5f2ea,
  comb: 0xe0442f,
  beak: 0xf08a3c,
  shadow: 0x1a1513,
  splash: 0xdff1ff,
} as const

type View = { p: Pixels; tile: number; ox: number; time: number }

const laneTop = (v: View, h: Hop, n: number): number => v.p.h - (n - h.view + 1) * v.tile
const colX = (v: View, x: number): number => v.ox + x * v.tile

const backdrop = (v: View, h: Hop, n: number, lane: Lane) => {
  const { p, tile } = v
  const top = laneTop(v, h, n)
  const bg =
    lane.kind === 'grass'
      ? n % 2 === 0
        ? COLOR.grass
        : COLOR.grassAlt
      : lane.kind === 'road'
        ? COLOR.road
        : lane.kind === 'river'
          ? COLOR.water
          : COLOR.gravel
  p.fill(0, p.w, top, top + tile, bg)
  p.fill(0, v.ox, top, top + tile, shade(bg, 0.55))
  p.fill(colX(v, WIDTH), p.w, top, top + tile, shade(bg, 0.55))

  if (lane.kind === 'road') {
    const ahead = laneAt(h, n + 1)
    if (ahead.kind === 'road') {
      for (let x = v.ox; x < colX(v, WIDTH); x++) {
        if (Math.floor((x - v.ox) / 2) % 2 === 0) p.dot(x, top, COLOR.dash)
      }
    } else {
      p.fill(v.ox, colX(v, WIDTH), top, top + 1, COLOR.curb)
    }
  }
  if (lane.kind === 'river') {
    for (let x = v.ox; x < colX(v, WIDTH); x++) {
      for (let y = Math.ceil(top); y < top + tile; y++) {
        if (hash(x * 31 + Math.floor(y + v.time / 400) * 977 + n * 7) < 0.08) p.dot(x, y, COLOR.ripple)
      }
    }
  }
  if (lane.kind === 'rail') {
    for (let x = 0; x < WIDTH; x++) p.fill(colX(v, x) + tile * 0.4, colX(v, x) + tile * 0.6, top, top + tile, COLOR.tie)
    p.fill(v.ox, colX(v, WIDTH), top + tile * 0.25, top + tile * 0.25 + 1, COLOR.rail)
    p.fill(v.ox, colX(v, WIDTH), top + tile * 0.75, top + tile * 0.75 + 1, COLOR.rail)
    const isWarning = lane.train !== null || lane.waitMs < WARN_MS
    const isLit = isWarning && Math.floor(v.time / 250) % 2 === 0
    p.fill(colX(v, WIDTH) + 1, colX(v, WIDTH) + Math.max(2, tile * 0.5), top + tile * 0.2, top + tile * 0.8, isLit ? COLOR.lightOn : COLOR.lightOff)
  }
}

const things = (v: View, h: Hop, n: number, lane: Lane) => {
  const { p, tile } = v
  const top = laneTop(v, h, n)

  if (lane.kind === 'grass') {
    for (const col of lane.trees) {
      const x = colX(v, col)
      p.fill(x + tile * 0.42, x + tile * 0.58, top + tile * 0.6, top + tile, COLOR.trunk)
      p.fill(x + tile * 0.12, x + tile * 0.88, top + tile * 0.05, top + tile * 0.72, COLOR.leaf)
      p.fill(x + tile * 0.12, x + tile * 0.5, top + tile * 0.05, top + tile * 0.3, COLOR.leafLight)
      p.fill(x + tile * 0.12, x + tile * 0.88, top + tile * 0.62, top + tile * 0.72, COLOR.leafDark)
    }
  }
  if (lane.kind === 'road') {
    for (const m of lane.movers) {
      const x0 = colX(v, m.x)
      const x1 = colX(v, m.x + m.len)
      const y0 = top + tile * 0.15
      const y1 = top + tile * 0.9
      if (m.len > 1) {
        const cab = (x1 - x0) * 0.3
        const cabAt = lane.dir > 0 ? x1 - cab : x0
        p.fill(x0, x1, y0, y1, COLOR.cargo)
        p.fill(cabAt, cabAt + cab, y0, y1, m.tint)
      } else {
        p.fill(x0, x1, y0, y1, m.tint)
        p.fill(x0 + (x1 - x0) * 0.3, x1 - (x1 - x0) * 0.3, y0, y1, shade(m.tint, 0.75))
      }
      const front = lane.dir > 0 ? x1 - Math.max(1, tile * 0.2) : x0
      p.fill(front, front + Math.max(1, tile * 0.2), y0 + 1, y1 - 1, COLOR.glass)
      p.fill(x0, x1, y1 - 1, y1, shade(m.tint, 0.4))
    }
  }
  if (lane.kind === 'river') {
    for (const m of lane.movers) {
      const x0 = colX(v, m.x)
      const x1 = colX(v, m.x + m.len)
      p.fill(x0, x1, top + tile * 0.15, top + tile * 0.85, COLOR.log)
      p.fill(x0, x1, top + tile * 0.5, top + tile * 0.5 + 1, COLOR.bark)
      p.fill(x0, x0 + 1, top + tile * 0.15, top + tile * 0.85, COLOR.logEnd)
      p.fill(x1 - 1, x1, top + tile * 0.15, top + tile * 0.85, COLOR.logEnd)
    }
  }
  if (lane.kind === 'rail' && lane.train !== null) {
    const x0 = colX(v, lane.train)
    const x1 = colX(v, lane.train + TRAIN_LEN)
    p.fill(x0, x1, top + tile * 0.05, top + tile * 0.95, COLOR.train)
    for (let car = 0; car < TRAIN_LEN; car += 2) {
      p.fill(colX(v, lane.train + car + 0.4), colX(v, lane.train + car + 1.4), top + tile * 0.3, top + tile * 0.6, COLOR.glass)
    }
    const nose = lane.dir > 0 ? x1 - 1 : x0
    p.fill(nose, nose + 1, top + tile * 0.05, top + tile * 0.95, shade(COLOR.train, 0.6))
  }
}

const chicken = (v: View, h: Hop) => {
  const { p, tile } = v
  const t = h.hopMs > 0 ? 1 - h.hopMs / HOP_MS : 1
  const x = h.fromX + (h.x - h.fromX) * t
  const lane = h.fromLane + (h.lane - h.fromLane) * t
  const lift = Math.sin(Math.PI * t) * tile * 0.35
  const top = v.p.h - (lane - h.view + 1) * tile
  const x0 = colX(v, x) + tile * 0.18
  const x1 = colX(v, x) + tile * 0.82
  const y0 = top + tile * 0.15 - lift
  const y1 = top + tile * 0.85 - lift

  if (h.death === 'train') return
  if (h.death === 'splash' || h.death === 'swept') {
    p.fill(x0 - 1, x1 + 1, top + tile * 0.4, top + tile * 0.6, COLOR.splash)
    p.fill(x0, x1, top + tile * 0.2, top + tile * 0.8, COLOR.splash)
    return
  }
  if (h.death === 'squashed') {
    p.fill(x0 - 1, x1 + 1, top + tile * 0.45, top + tile * 0.7, COLOR.chicken)
    return
  }

  if (lift > 0.5) p.fill(x0, x1, top + tile * 0.7, top + tile * 0.9, COLOR.shadow)
  p.fill(x0, x1, y0, y1, COLOR.chicken)
  const mid = (x0 + x1) / 2
  const midY = (y0 + y1) / 2
  switch (h.facing) {
    case 'up':
      p.fill(mid - 0.5, mid + 0.5, y0 - 1, y0, COLOR.comb)
      break
    case 'down':
      p.fill(mid - 0.5, mid + 0.5, y1, y1 + 1, COLOR.beak)
      p.fill(mid - 0.5, mid + 0.5, y0, y0 + 1, COLOR.comb)
      break
    case 'left':
      p.fill(x0 - 1, x0, midY - 0.5, midY + 0.5, COLOR.beak)
      p.fill(mid - 0.5, mid + 0.5, y0 - 1, y0, COLOR.comb)
      break
    case 'right':
      p.fill(x1, x1 + 1, midY - 0.5, midY + 0.5, COLOR.beak)
      p.fill(mid - 0.5, mid + 0.5, y0 - 1, y0, COLOR.comb)
      break
  }
}

const DEATHS: Record<Death, string> = {
  squashed: 'SQUASHED',
  splash: 'SPLASH',
  swept: 'SWEPT AWAY',
  train: 'HIT BY A TRAIN',
  eagle: 'TOO SLOW',
}

const messageFor = (h: Hop): Line[] => {
  switch (h.phase) {
    case 'title':
      return [
        { text: 'ROAD HOPPER', color: UI.accent },
        { text: '', color: UI.text },
        { text: 'click here, then w', color: UI.text },
        { text: 'w hop  a d sideways  s back', color: UI.dim },
      ]
    case 'paused':
      return [
        { text: 'PAUSED', color: UI.accent },
        { text: 'click here, then w', color: UI.text },
      ]
    case 'over':
      return [
        { text: DEATHS[h.death ?? 'squashed'], color: UI.accent },
        { text: `score ${h.score}`, color: UI.text },
        { text: h.overMs < RESTART_MS ? '' : 'w to hop again', color: UI.dim },
      ]
    case 'play':
      return []
  }
}

export const frameWords = (h: Hop, columns: number, rows: number, best: number, time = 0): Uint32Array => {
  const p = new Pixels(columns, rows)
  const tile = Math.max(2, Math.floor(p.w / WIDTH))
  const v: View = { p, tile, ox: Math.floor((p.w - WIDTH * tile) / 2), time }

  const first = Math.floor(h.view)
  const last = Math.ceil(h.view + (p.h - BAR_PX) / tile) + 1
  for (let n = first; n <= last; n++) backdrop(v, h, n, laneAt(h, n))
  for (let n = first; n <= last; n++) {
    const lane = laneAt(h, n)
    if (lane.kind !== 'rail') things(v, h, n, lane)
  }
  chicken(v, h)
  // Trains last: they draw over the chicken.
  for (let n = first; n <= last; n++) {
    const lane = laneAt(h, n)
    if (lane.kind === 'rail') things(v, h, n, lane)
  }

  const cells = p.cells()
  scoreBar(cells, columns, { text: `${h.score}`, color: UI.text }, null, { text: `best ${Math.max(best, h.score)}`, color: UI.dim })
  panel(cells, columns, rows, messageFor(h))

  return cells
}

export const roadHopper: Cartridge = {
  id: 'hopper',
  title: 'Road Hopper',
  tickMs: 50,
  controls: [
    { hotkey: 'w', label: 'hop', action: 'forward' },
    { hotkey: 'a', label: 'left', action: 'left' },
    { hotkey: 'd', label: 'right', action: 'right' },
    { hotkey: 's', label: 'back', action: 'back' },
    { hotkey: 'p', label: 'pause', action: 'pause' },
  ],
  start: seed => {
    let h = newHop(seed)
    let time = 0

    return {
      get phase() {
        return h.phase
      },
      get score() {
        return h.score
      },
      act: action => {
        h = act(h, action)
      },
      step: ms => {
        time += ms
        return step(h, ms)
      },
      pause: () => {
        if (h.phase === 'play') h.phase = 'paused'
      },
      frame: (columns, rows, best) => frameWords(h, columns, rows, best, time),
    }
  },
}
