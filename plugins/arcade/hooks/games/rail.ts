// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

import { nextRandom, RESTART_MS, type Cartridge, type Phase } from '../cartridge'
import { BAR_PX, clamp01, frac, hash, mix, panel, Pixels, scoreBar, shade, UI, type Line } from '../screen'

export type Action = 'left' | 'right' | 'jump' | 'roll' | 'pause'
export type Kind = 'train' | 'low' | 'high' | 'coin'

// `z`: metres to the front edge. Negative once passed.
export type Thing = { kind: Kind; lane: number; z: number; tint: number }

export type Run = {
  phase: Phase
  rng: number
  lane: number
  x: number
  y: number
  vy: number
  rollMs: number
  speed: number
  distance: number
  coins: number
  score: number
  things: Thing[]
  untilRow: number
  overMs: number
}

export const LANE_W = 2.2
export const TRAIN_LEN = 14
const FAR = 72
const GRAVITY = 34
const JUMP_V = 11
const SLAM_V = -22
const ROLL_MS = 650
const LANE_RATE = 7
const START_SPEED = 14
const MAX_SPEED = 32
const ACCEL = 0.22
const LOW_CLEARANCE = 0.8

const TINTS = [0xc8452c, 0x2e6fa8, 0xd9a23a, 0x3f8f5a] as const

const below = (g: Run, n: number): number => Math.floor(nextRandom(g) * n)

export const newRun = (seed: number, phase: Phase = 'title'): Run => {
  const g: Run = {
    phase,
    rng: seed | 0,
    lane: 1,
    x: 1,
    y: 0,
    vy: 0,
    rollMs: 0,
    speed: START_SPEED,
    distance: 0,
    coins: 0,
    score: 0,
    things: [],
    untilRow: 0,
    overMs: 0,
  }

  // 30m run-up before the first row.
  let z = 30
  while (z < FAR) {
    z += spawnRow(g, z)
  }
  g.untilRow = z - FAR

  return g
}

const coinLine = (g: Run, lane: number, z: number) => {
  for (let i = 0; i < 6; i++) {
    g.things.push({ kind: 'coin', lane, z: z + i * 2.4, tint: 0 })
  }
}

// Every row leaves a lane open. The gap after a train fits a 2-lane switch.
const spawnRow = (g: Run, z: number): number => {
  let hasTrain = false
  const put = (kind: Kind, lane: number) => {
    hasTrain ||= kind === 'train'
    g.things.push({ kind, lane, z, tint: TINTS[below(g, TINTS.length)] ?? TINTS[0] })
  }
  const blocker = (): Kind => {
    const r = nextRandom(g)

    return r < 0.55 ? 'train' : r < 0.8 ? 'low' : 'high'
  }

  const roll = nextRandom(g)
  if (roll < 0.4) {
    const open = below(g, 3)
    for (const lane of [0, 1, 2]) {
      if (lane !== open) put(blocker(), lane)
    }
    coinLine(g, open, z)
  } else if (roll < 0.78) {
    const blocked = below(g, 3)
    put(blocker(), blocked)
    if (nextRandom(g) < 0.5) coinLine(g, (blocked + 1 + below(g, 2)) % 3, z)
  } else {
    const kind = nextRandom(g) < 0.5 ? 'low' : 'high'
    for (const lane of [0, 1, 2]) put(kind, lane)
  }

  const room = Math.max(12, g.speed * 0.95) + nextRandom(g) * 8

  return (hasTrain ? TRAIN_LEN : 0) + room
}

const start = (g: Run): Run => newRun(below(g, 2 ** 31), 'play')

export const act = (g: Run, action: Action): Run => {
  switch (g.phase) {
    case 'title':
      return action === 'pause' ? g : start(g)
    case 'over':
      return g.overMs < RESTART_MS || action === 'pause' ? g : start(g)
    case 'paused':
      g.phase = 'play'
      return g
    case 'play':
      break
  }

  if (action === 'left') g.lane = Math.max(0, g.lane - 1)
  if (action === 'right') g.lane = Math.min(2, g.lane + 1)
  if (action === 'jump' && g.y === 0) {
    g.vy = JUMP_V
    g.rollMs = 0
  }
  if (action === 'roll') {
    g.rollMs = ROLL_MS
    if (g.y > 0) g.vy = Math.min(g.vy, SLAM_V)
  }
  if (action === 'pause') g.phase = 'paused'

  return g
}

export const pause = (g: Run): void => {
  if (g.phase === 'play') g.phase = 'paused'
}

const lengthOf = (thing: Thing): number => (thing.kind === 'train' ? TRAIN_LEN : 0)

// Swept check. At 32 m/s one tick moves 1.6m; a point check misses thin
// barriers.
const crossed = (before: number, after: number): boolean => before >= -0.3 && after <= 0.3

export const step = (g: Run, ms: number): Phase => {
  if (g.phase === 'over') {
    g.overMs += ms
    return g.phase
  }
  if (g.phase !== 'play') return g.phase

  const dt = Math.min(ms, 100) / 1000
  g.speed = Math.min(MAX_SPEED, g.speed + ACCEL * dt)

  const reach = LANE_RATE * dt
  g.x += Math.max(-reach, Math.min(reach, g.lane - g.x))

  if (g.y > 0 || g.vy > 0) {
    g.vy -= GRAVITY * dt
    g.y = Math.max(0, g.y + g.vy * dt)
    if (g.y === 0) g.vy = 0
  }
  g.rollMs = Math.max(0, g.rollMs - ms)

  const run = g.speed * dt
  g.distance += run
  const lane = Math.round(g.x)

  for (const thing of g.things) {
    const before = thing.z
    thing.z -= run
    if (thing.lane !== lane) continue

    if (thing.kind === 'coin') {
      if (crossed(before, thing.z) && g.y < 2.2) {
        g.coins += 1
        thing.z = -1000
      }
      continue
    }

    const isHit =
      thing.kind === 'train'
        ? thing.z <= 0.3 && thing.z + TRAIN_LEN >= -0.3
        : thing.kind === 'low'
          ? crossed(before, thing.z) && g.y < LOW_CLEARANCE
          : crossed(before, thing.z) && g.rollMs === 0

    if (isHit) {
      g.phase = 'over'
      g.overMs = 0
    }
  }

  g.things = g.things.filter(thing => thing.z + lengthOf(thing) > -8)

  g.untilRow -= run
  while (g.untilRow <= 0) {
    g.untilRow += spawnRow(g, FAR + g.untilRow)
  }

  g.score = Math.floor(g.distance) + g.coins * 10

  return g.phase
}

const COLOR = {
  skyTop: 0x0c0a12,
  skyLow: 0x3b1e2a,
  glow: 0x7a3426,
  star: 0x8a7f9a,
  city: 0x1b1520,
  window: 0xffb35c,
  side: 0x2b2522,
  sideDark: 0x231e1c,
  platform: 0x5b5651,
  bed: 0x4a3f38,
  bedAlt: 0x433832,
  tie: 0x6d4b33,
  rail: 0xc4beb6,
  fog: 0x3b1e2a,
  glass: 0x9fd3e6,
  lamp: 0xfff2c0,
  bumper: 0x1e1a18,
  post: 0x8a8580,
  white: 0xf0e8e0,
  red: 0xd23c2c,
  yellow: 0xe8b420,
  black: 0x1e1a18,
  coin: 0xffcf3f,
  coinLight: 0xfff3b0,
  hoodie: 0xe8692c,
  hood: 0xb84f1f,
  pants: 0x2b3a67,
  shoe: 0xf2f2f2,
  hair: 0x3a2a22,
  cap: 0x2fa37a,
  shadow: 0x1a1513,
} as const

const CAM = 8

type View = { p: Pixels; horizon: number; feet: number; ppm: number; cx: number }

const makeView = (p: Pixels): View => {
  const horizon = BAR_PX + Math.round((p.h - BAR_PX) * 0.28)
  const feet = p.h - Math.max(3, Math.round(p.h * 0.06))
  const ppm = Math.max(1, Math.min(p.w / 8.6, (feet - horizon) / 5.5))

  return { p, horizon, feet, ppm, cx: p.w / 2 }
}

const scaleAt = (z: number): number => CAM / (z + CAM)
const groundAt = (v: View, s: number): number => v.horizon + s * (v.feet - v.horizon)
const laneX = (v: View, lane: number, s: number): number => v.cx + (lane - 1) * LANE_W * s * v.ppm
const fogAt = (z: number): number => clamp01((z - 22) / 55) * 0.8

// `lane` may be fractional. Sizes in metres.
const block = (v: View, lane: number, z: number, width: number, base: number, height: number, color: number) => {
  const s = scaleAt(z)
  const k = s * v.ppm
  const mid = laneX(v, lane, s)
  const ground = groundAt(v, s)
  v.p.fill(mid - (width / 2) * k, mid + (width / 2) * k, ground - (base + height) * k, ground - base * k, color)
}

const groundColor = (lx: number, world: number, s: number, ppm: number, hasTies: boolean): number => {
  const half = LANE_W * 1.5
  const ax = Math.abs(lx)
  if (ax > half + 0.5) return Math.floor(world / 3) % 2 === 0 ? COLOR.side : COLOR.sideDark
  if (ax > half) return COLOR.platform

  const u = lx + half
  const lane = Math.min(2, Math.floor(u / LANE_W))
  const off = u - (lane + 0.5) * LANE_W
  const metresPerPixel = 1 / (s * ppm)
  const bed = lane % 2 === 0 ? COLOR.bed : COLOR.bedAlt
  // Far pixels are mostly gravel. Blend rail by coverage or the far track
  // turns into a grey funnel.
  if (Math.abs(Math.abs(off) - 0.55) < Math.max(0.07, metresPerPixel * 0.5)) {
    return mix(bed, COLOR.rail, Math.min(1, 0.22 / metresPerPixel))
  }
  if (hasTies && Math.abs(off) < 0.85 && frac(world / 1.1) < 0.4) return COLOR.tie

  return bed
}

const drawBackdrop = (v: View, g: Run) => {
  const { p } = v

  for (let y = BAR_PX; y < v.horizon; y++) {
    const t = (y - BAR_PX) / Math.max(1, v.horizon - BAR_PX)
    const sky = t < 0.75 ? mix(COLOR.skyTop, COLOR.skyLow, t / 0.75) : mix(COLOR.skyLow, COLOR.glow, (t - 0.75) / 0.25)
    for (let x = 0; x < p.w; x++) {
      p.px[y * p.w + x] = hash(x * 7919 + y * 104729) < 0.012 && t < 0.6 ? COLOR.star : sky
    }
  }

  const room = Math.max(2, (v.horizon - BAR_PX) * 0.7)
  for (let x = 0; x < p.w; x++) {
    const tall = Math.round((0.2 + hash(Math.floor(x / 4) + 31) * 0.65) * room)
    for (let y = Math.max(BAR_PX, v.horizon - tall); y < v.horizon; y++) {
      const isWindow = x % 4 !== 0 && hash(x * 131 + y * 977) < 0.14
      p.px[y * p.w + x] = isWindow ? COLOR.window : COLOR.city
    }
  }

  for (let y = v.horizon; y < p.h; y++) {
    const s = (y + 0.5 - v.horizon) / (v.feet - v.horizon)
    const z = CAM / s - CAM
    const zNext = CAM / ((y + 1.5 - v.horizon) / (v.feet - v.horizon)) - CAM
    const hasTies = z - zNext < 0.45
    const world = z + g.distance
    const fog = fogAt(z)
    for (let x = 0; x < p.w; x++) {
      const lx = (x + 0.5 - v.cx) / (s * v.ppm)
      p.px[y * p.w + x] = mix(groundColor(lx, world, s, v.ppm, hasTies), COLOR.fog, fog)
    }
  }
}

type Op = { z: number; draw: () => void }

const trainFace = (v: View, t: Thing) => {
  const tone = (color: number) => mix(color, COLOR.fog, fogAt(t.z))
  block(v, t.lane, t.z, 2.0, 0, 3.3, tone(t.tint))
  block(v, t.lane, t.z, 2.0, 0, 0.35, tone(COLOR.bumper))
  block(v, t.lane, t.z, 1.5, 1.9, 0.9, tone(COLOR.glass))
  block(v, t.lane - 0.27, t.z, 0.3, 0.6, 0.3, tone(COLOR.lamp))
  block(v, t.lane + 0.27, t.z, 0.3, 0.6, 0.3, tone(COLOR.lamp))
}

// 0.6m slices, back to front. Roof and inner side show without a mesh.
const train = (v: View, t: Thing, ops: Op[]) => {
  const near = -CAM + 1.5
  const back = Math.min(t.z + TRAIN_LEN, FAR + 2)
  const front = Math.max(t.z, near)
  if (back <= front) return

  for (let z = back; z > front; z -= 0.6) {
    ops.push({
      z,
      draw: () => {
        block(v, t.lane, z, 2.0, 0, 3.3, mix(shade(t.tint, 0.6), COLOR.fog, fogAt(z)))
        block(v, t.lane, z, 2.0, 3.15, 0.15, mix(shade(t.tint, 0.85), COLOR.fog, fogAt(z)))
      },
    })
  }
  if (t.z >= near) ops.push({ z: t.z, draw: () => trainFace(v, t) })
}

const stripes = (v: View, t: Thing, base: number, height: number, a: number, b: number) => {
  const s = scaleAt(t.z)
  const k = s * v.ppm
  const mid = laneX(v, t.lane, s)
  const ground = groundAt(v, s)
  const fog = fogAt(t.z)
  const left = Math.round(mid - 1.0 * k)
  const right = Math.max(left + 1, Math.round(mid + 1.0 * k))
  for (let x = left; x < right; x++) {
    const m = (x + 0.5 - mid) / k
    const color = Math.floor((m + 5) / 0.4) % 2 === 0 ? a : b
    v.p.fill(x, x + 1, ground - (base + height) * k, ground - base * k, mix(color, COLOR.fog, fog))
  }
}

const barrier = (v: View, t: Thing) => {
  const isLow = t.kind === 'low'
  const top = isLow ? 1.0 : 2.1
  const post = mix(COLOR.post, COLOR.fog, fogAt(t.z))
  block(v, t.lane - 0.43, t.z, 0.12, 0, top, post)
  block(v, t.lane + 0.43, t.z, 0.12, 0, top, post)
  if (isLow) stripes(v, t, 0.55, 0.45, COLOR.red, COLOR.white)
  else stripes(v, t, 1.35, 0.75, COLOR.yellow, COLOR.black)
}

const coin = (v: View, t: Thing, spin: number) => {
  const s = scaleAt(t.z)
  const k = s * v.ppm
  const mid = laneX(v, t.lane, s)
  const centre = groundAt(v, s) - 0.75 * k
  const ry = Math.max(0.5, 0.3 * k)
  const rx = Math.max(0.5, ry * Math.abs(Math.cos(spin + t.z * 0.5)))
  const fog = fogAt(t.z)
  for (let y = Math.floor(centre - ry); y <= Math.ceil(centre + ry); y++) {
    for (let x = Math.floor(mid - rx); x <= Math.ceil(mid + rx); x++) {
      const dx = (x + 0.5 - mid) / rx
      const dy = (y + 0.5 - centre) / ry
      if (dx * dx + dy * dy > 1.3) continue
      v.p.dot(x, y, mix(dy < -0.2 && dx < 0 ? COLOR.coinLight : COLOR.coin, COLOR.fog, fog))
    }
  }
}

const runner = (v: View, g: Run) => {
  const lane = g.x
  const b = g.y
  const s = scaleAt(0)
  const k = s * v.ppm
  const ground = groundAt(v, s)
  const mid = laneX(v, lane, s)

  v.p.fill(mid - 0.45 * k, mid + 0.45 * k, ground - 1, ground, COLOR.shadow)

  if (g.rollMs > 0) {
    const r = 0.45 * k
    const centre = ground - (b + 0.45) * k
    for (let y = Math.floor(centre - r); y <= Math.ceil(centre + r); y++) {
      for (let x = Math.floor(mid - r); x <= Math.ceil(mid + r); x++) {
        const dx = x + 0.5 - mid
        const dy = y + 0.5 - centre
        if (dx * dx + dy * dy > r * r * 1.2) continue
        v.p.dot(x, y, dy < -r * 0.3 ? COLOR.hair : COLOR.hoodie)
      }
    }
    return
  }

  const isAir = b > 0.05
  const legs = isAir ? 0.5 : 0.75
  const swing = isAir ? 0 : Math.sin(g.distance * 2.2) > 0 ? 0.15 : 0
  block(v, lane - 0.1, 0, 0.2, b + swing, legs - swing, COLOR.pants)
  block(v, lane + 0.1, 0, 0.2, b + (0.15 - swing), legs - (0.15 - swing), COLOR.pants)
  block(v, lane - 0.1, 0, 0.22, b + swing, 0.12, COLOR.shoe)
  block(v, lane + 0.1, 0, 0.22, b + (0.15 - swing), 0.12, COLOR.shoe)
  block(v, lane, 0, 0.7, b + legs, 0.62, COLOR.hoodie)
  block(v, lane, 0, 0.5, b + legs + 0.5, 0.14, COLOR.hood)
  block(v, lane, 0, 0.36, b + legs + 0.62, 0.3, COLOR.hair)
  block(v, lane, 0, 0.4, b + legs + 0.84, 0.12, COLOR.cap)
}

const messageFor = (g: Run): Line[] => {
  switch (g.phase) {
    case 'title':
      return [
        { text: 'RAIL RUNNER', color: UI.accent },
        { text: '', color: UI.text },
        { text: 'click here, then w', color: UI.text },
        { text: 'a d move  w jump  s roll', color: UI.dim },
      ]
    case 'paused':
      return [
        { text: 'PAUSED', color: UI.accent },
        { text: 'click here, then w', color: UI.text },
      ]
    case 'over':
      return [
        { text: 'CRASHED', color: UI.accent },
        { text: `score ${g.score}  $${g.coins}`, color: UI.text },
        { text: g.overMs < RESTART_MS ? '' : 'w to run again', color: UI.dim },
      ]
    case 'play':
      return []
  }
}

export const frameWords = (g: Run, columns: number, rows: number, best: number): Uint32Array => {
  const p = new Pixels(columns, rows)
  const v = makeView(p)
  drawBackdrop(v, g)

  const ops: Op[] = []
  const spin = g.distance * 0.35
  for (const t of g.things) {
    if (t.z > FAR + 2) continue
    if (t.kind === 'train') train(v, t, ops)
    else if (t.z > -CAM + 1.5) ops.push({ z: t.z, draw: () => (t.kind === 'coin' ? coin(v, t, spin) : barrier(v, t)) })
  }
  ops.push({ z: -0.01, draw: () => runner(v, g) })
  ops.sort((a, b) => b.z - a.z)
  for (const op of ops) op.draw()

  const cells = p.cells()
  scoreBar(
    cells,
    columns,
    { text: `${g.score}`, color: UI.text },
    { text: `$${g.coins}`, color: UI.gold },
    { text: `best ${Math.max(best, g.score)}`, color: UI.dim },
  )
  panel(cells, columns, rows, messageFor(g))

  return cells
}

export const railRunner: Cartridge = {
  id: 'rail',
  title: 'Rail Runner',
  tickMs: 50,
  controls: [
    { hotkey: 'a', label: 'left', action: 'left' },
    { hotkey: 'd', label: 'right', action: 'right' },
    { hotkey: 'w', label: 'jump', action: 'jump' },
    { hotkey: 's', label: 'roll', action: 'roll' },
    { hotkey: 'p', label: 'pause', action: 'pause' },
  ],
  start: seed => {
    let g = newRun(seed)

    return {
      get phase() {
        return g.phase
      },
      get score() {
        return g.score
      },
      act: action => {
        g = act(g, action as Action)
      },
      step: ms => {
        const before = g.phase
        const wasWaiting = before === 'over' && g.overMs < RESTART_MS
        step(g, ms)

        return before === 'play' || (wasWaiting && g.overMs >= RESTART_MS)
      },
      pause: () => pause(g),
      frame: (columns, rows, best) => frameWords(g, columns, rows, best),
    }
  },
}
