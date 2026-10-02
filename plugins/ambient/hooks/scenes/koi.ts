// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

import { hash, mix, noise1, Pixels, ramp, shade, type Scene } from '../screen'

const WATER = [0x082228, 0x0c3139, 0x113f47, 0x185159, 0x22646a] as const
const PAD = 0x3d8a47
const PAD_LIGHT = 0x5daf57
const PAD_DARK = 0x29613a
const PETAL = 0xf3a6c4
const CORE = 0xffe08a
const RIPPLE = 0x5f9ea0

// White, red, black, gold: kohaku, showa, ogon, tancho.
const VARIETIES = [
  { base: 0xf2ece4, patch: 0xe5532a, patchAt: 0.45, head: -1 },
  { base: 0x1e1d20, patch: 0xe5532a, patchAt: 0.5, head: -1 },
  { base: 0xf0b13a, patch: 0xffd679, patchAt: 0.6, head: -1 },
  { base: 0xf2ece4, patch: 0xf2ece4, patchAt: 2, head: 0xe23b2b },
] as const

type Fish = { seed: number; ax: number; ay: number; wx: number; wy: number; px: number; py: number; size: number }

const school = (w: number, h: number): Fish[] => {
  const count = Math.max(3, Math.min(9, Math.round((w * h) / 700)))
  return Array.from({ length: count }, (_, i) => ({
    seed: i * 31 + 7,
    ax: 0.3 + hash(i * 3 + 1) * 0.12,
    ay: 0.32 + hash(i * 3 + 2) * 0.1,
    wx: (0.09 + hash(i * 5 + 3) * 0.08) * (hash(i + 99) < 0.5 ? -1 : 1),
    wy: 0.07 + hash(i * 5 + 4) * 0.07,
    px: hash(i * 7 + 5) * Math.PI * 2,
    py: hash(i * 7 + 6) * Math.PI * 2,
    size: Math.max(1.1, w / 34) * (0.8 + hash(i * 11 + 8) * 0.45),
  }))
}

const at = (f: Fish, t: number, w: number, h: number) => ({
  x: w * (0.5 + f.ax * Math.sin(f.wx * t + f.px) + 0.06 * Math.sin(2.3 * f.wx * t + f.py)),
  y: h * (0.5 + f.ay * Math.sin(f.wy * t + f.py) + 0.05 * Math.sin(1.7 * f.wy * t + f.px)),
})

// Spine by arc length, walking back in time. Sampling by time instead bunches
// the body up wherever the path slows near a turn.
const spine = (f: Fish, t: number, w: number, h: number): { x: number; y: number }[] => {
  const count = Math.round(f.size * 6)
  const gap = Math.max(0.7, f.size * 0.75)
  const points = [at(f, t, w, h)]
  let back = t
  for (let i = 1; i < count; i++) {
    const last = points[points.length - 1]!
    for (let tries = 0; tries < 400; tries++) {
      back -= 0.04
      const p = at(f, back, w, h)
      if (Math.hypot(p.x - last.x, p.y - last.y) >= gap) {
        points.push(p)
        break
      }
    }
  }

  return points
}

const drawFish = (p: Pixels, f: Fish, t: number) => {
  const body = spine(f, t, p.w, p.h)
  const kind = VARIETIES[Math.floor(hash(f.seed) * VARIETIES.length)] ?? VARIETIES[0]
  const n = body.length
  const radius = (i: number) => f.size * (i < 2 ? 0.75 + i * 0.15 : Math.max(0.3, 1.05 - ((i - 2) / (n - 2)) * 0.8))

  // Shadow on the pond floor first, offset down-right.
  body.forEach((q, i) => p.disc(q.x + 1.2, q.y + 1.6, radius(i), WATER[0]))

  const tail = body[n - 1]
  const before = body[Math.max(0, n - 3)]
  if (tail !== undefined && before !== undefined) {
    const dx = tail.x - before.x
    const dy = tail.y - before.y
    const len = Math.hypot(dx, dy) || 1
    const wag = Math.sin(t * 5 + f.seed) * f.size * 0.9
    const fin = mix(kind.base, WATER[2], 0.35)
    for (const side of [-1, 1]) {
      p.disc(tail.x + (dx / len) * f.size * 1.2 + (-dy / len) * (side * f.size * 0.7 + wag), tail.y + (dy / len) * f.size * 1.2 + (dx / len) * (side * f.size * 0.7 + wag), f.size * 0.45, fin)
    }
  }

  for (let i = n - 1; i >= 0; i--) {
    const q = body[i]!
    const isPatch = noise1(i * 0.45 + f.seed, f.seed) > kind.patchAt
    const color = i <= 1 && kind.head >= 0 ? kind.head : isPatch ? kind.patch : kind.base
    p.disc(q.x, q.y, radius(i), color)
  }
}

const drawPads = (p: Pixels, t: number) => {
  const count = Math.max(2, Math.round((p.w * p.h) / 900))
  for (let i = 0; i < count; i++) {
    const r = Math.max(2, (p.w / 14) * (0.6 + hash(i * 13 + 1) * 0.6))
    const cx = hash(i * 13 + 2) * p.w + Math.sin(t * 0.08 + i) * 0.6
    const cy = hash(i * 13 + 3) * p.h + Math.cos(t * 0.06 + i) * 0.6
    const notch = hash(i * 13 + 4) * Math.PI * 2
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x + 0.5 - cx
        const dy = y + 0.5 - cy
        const d = Math.hypot(dx, dy)
        if (d > r) continue
        const angle = Math.atan2(dy, dx)
        const off = Math.abs(((angle - notch + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
        if (off < 0.35 && d > r * 0.15) continue
        const color = d > r - 1 ? PAD_DARK : dx + dy < -r * 0.4 ? PAD_LIGHT : PAD
        p.dot(x, y, color)
      }
    }
    if (hash(i * 13 + 5) < 0.35) {
      p.disc(cx - r * 0.2, cy - r * 0.2, Math.max(1, r * 0.35), PETAL)
      p.dot(cx - r * 0.2, cy - r * 0.2, CORE)
    }
  }
}

// A ring every 4s from a seeded spot, 2.5s to fade.
const drawRipples = (p: Pixels, t: number) => {
  for (let k = Math.floor(t / 4) - 1; k <= Math.floor(t / 4); k++) {
    const age = t - (k * 4 + hash(k * 3 + 1) * 1.5)
    if (age < 0 || age > 2.5) continue
    const cx = hash(k * 3 + 2) * p.w
    const cy = hash(k * 3 + 3) * p.h
    const r = 0.5 + age * (p.w / 18)
    for (let a = 0; a < Math.PI * 2; a += 0.6 / Math.max(1, r)) {
      const x = cx + Math.cos(a) * r
      const y = cy + Math.sin(a) * r
      p.dot(x, y, mix(RIPPLE, p.get(x, y), age / 2.5))
    }
  }
}

const drawPetals = (p: Pixels, t: number) => {
  for (let i = 0; i < 7; i++) {
    const x = (hash(i * 5 + 40) * p.w + t * (0.6 + hash(i) * 0.6)) % p.w
    const y = (hash(i * 5 + 41) * p.h + Math.sin(t * 0.4 + i) * 2 + p.h) % p.h
    p.dot(x, y, PETAL)
  }
}

export const koi: Scene = {
  id: 'koi',
  title: 'koi pond',
  draw: (p, t) => {
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
        const v = Math.sin(x * 0.31 + t * 0.6) + Math.sin(y * 0.27 - t * 0.45) + Math.sin((x - y) * 0.17 + t * 0.25)
        const k = ((v + 3) / 6) ** 2.2
        p.px[y * p.w + x] = ramp(WATER, k, x, y)
      }
    }
    for (const f of school(p.w, p.h)) drawFish(p, f, t)
    drawRipples(p, t)
    drawPads(p, t)
    drawPetals(p, t)
    // Vignette: corners a shade deeper, so the pond reads as a pond.
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
        const dx = (x / p.w - 0.5) * 2
        const dy = (y / p.h - 0.5) * 2
        if (dx * dx + dy * dy > 1.25) p.px[y * p.w + x] = shade(p.px[y * p.w + x] ?? 0, 0.8)
      }
    }
  },
}
