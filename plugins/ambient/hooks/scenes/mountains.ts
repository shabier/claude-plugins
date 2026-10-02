// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

import { clamp01, dither, fbm1, hash, hash2, mix, Pixels, ramp, type Scene } from '../screen'

const SKY = [0x14122b, 0x2b2350, 0x5a3a6b, 0xb35a5f, 0xf08a5d, 0xf5c27a] as const
const SUN = 0xffd896
const SUN_EDGE = 0xffb36b
const STAR = 0xc9c3e6
const CLOUD = 0xe89a78
const MIST = 0x9a7aa8
const SNOW = 0xe6dcf0
const BIRD = 0x241a33
const PINE = 0x120e22

// Far to near. Parallax: nearer ridges scroll faster.
// Scales are tuned for a narrow pane: wide-pane scales flatten into a band.
const RIDGES = [
  { base: 0.62, amp: 0.3, scale: 0.09, speed: 0.5, color: 0x6e5c92, fog: 0.3, seed: 11 },
  { base: 0.7, amp: 0.2, scale: 0.12, speed: 1.2, color: 0x4b3e6e, fog: 0.22, seed: 23 },
  { base: 0.8, amp: 0.14, scale: 0.16, speed: 2.6, color: 0x2e2649, fog: 0.12, seed: 37 },
  { base: 0.9, amp: 0.09, scale: 0.22, speed: 5.5, color: 0x1a1530, fog: 0, seed: 51 },
] as const

// fbm sits around 0.3-0.7. Stretched to 0-1, or every ridge comes out flat.
const heightAt = (r: (typeof RIDGES)[number], x: number, t: number): number =>
  clamp01((fbm1((x + t * r.speed) * r.scale, r.seed) - 0.3) / 0.45)

const ridgeTop = (p: Pixels, r: (typeof RIDGES)[number], x: number, t: number): number =>
  p.h * r.base - p.h * r.amp * heightAt(r, x, t)

export const mountains: Scene = {
  id: 'mountains',
  title: 'mountains at dusk',
  draw: (p, t) => {
    const horizon = p.h * 0.6
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
        let c = ramp(SKY, y / horizon, x, y)
        if (y < p.h * 0.35 && hash2(x, y) < 0.012 && hash2(x + Math.floor(t * 1.5), y) < 0.85) c = STAR
        p.px[y * p.w + x] = c
      }
    }

    const sunX = p.w * 0.68
    const sunY = p.h * 0.4
    const sunR = Math.max(3, p.w * 0.12)
    p.disc(sunX, sunY, sunR + 1.5, mix(SKY[4], SUN_EDGE, 0.5))
    p.disc(sunX, sunY, sunR, SUN)

    // Thin clouds, drifting.
    for (let i = 0; i < 4; i++) {
      const len = p.w * (0.25 + hash(i * 3) * 0.3)
      const y = p.h * (0.12 + hash(i * 3 + 1) * 0.3)
      const x0 = ((hash(i * 3 + 2) * (p.w + len) + t * (0.8 + i * 0.3)) % (p.w + len)) - len
      for (let x = Math.floor(x0); x < x0 + len; x++) {
        const edge = Math.min(x - x0, x0 + len - x) / (len * 0.3)
        p.dot(x, y, dither(p.get(x, y), CLOUD, clamp01(edge), x, Math.floor(y)))
      }
    }

    // Birds: a flock of three every 14s, right to left.
    const flight = (t % 14) / 9
    if (flight < 1) {
      const by = p.h * (0.22 + hash(Math.floor(t / 14)) * 0.12)
      for (let b = 0; b < 3; b++) {
        const bx = p.w * (1.1 - flight * 1.3) + b * 3
        const flap = Math.floor(t * 4 + b) % 2
        p.dot(bx - 1, by + b - flap, BIRD)
        p.dot(bx, by + b, BIRD)
        p.dot(bx + 1, by + b - flap, BIRD)
      }
    }

    for (const r of RIDGES) {
      for (let x = 0; x < p.w; x++) {
        const v = heightAt(r, x, t)
        const top = p.h * r.base - p.h * r.amp * v
        const snow = r === RIDGES[0] ? Math.max(0, v - 0.55) * p.h * r.amp * 0.6 : 0
        for (let y = Math.max(0, Math.floor(top)); y < p.h; y++) {
          const depth = clamp01((y - top) / (p.h * 0.35))
          // The first row sits above `top`, so y - top < 0 there: test snow > 0 first.
          p.px[y * p.w + x] = snow > 0 && y - top < snow ? SNOW : dither(r.color, MIST, depth * r.fog, x, y)
        }
      }
    }

    // Pines on the nearest ridge, scrolling with it.
    const near = RIDGES[3]
    const spacing = Math.max(3, Math.round(p.w / 14))
    const offset = (t * near.speed) % spacing
    for (let i = -1; i <= p.w / spacing + 1; i++) {
      const x = i * spacing - offset
      const world = Math.round((x + t * near.speed) / spacing)
      if (hash(world * 17) < 0.35) continue
      const tall = 3 + Math.round(hash(world * 19) * p.h * 0.08)
      const base = ridgeTop(p, near, x, t) + 1
      for (let dy = 0; dy < tall; dy++) {
        const half = (dy / tall) * Math.max(1, tall * 0.35)
        p.fill(x - half, x + half + 1, base - tall + dy, base - tall + dy + 1, PINE)
      }
    }
  },
}
