// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

import { hash, hash2, mix, Pixels, ramp, type Scene } from '../screen'

const SKY = [0x05030c, 0x10081f, 0x240c38, 0x45114f, 0x6a1a5a] as const
const TOWER = 0x120c22
const RIM = 0x2e2150
const SUN_TOP = 0xffd166
const SUN_LOW = 0xff3cac
const CYAN = 0x2de2e6
const PINK = 0xff3cac
const YELLOW = 0xf9c80e
const HAZE = 0x5a1d6b
const RAIN = 0x6f7fb8
const STREET = 0x07050d
const NEONS = [CYAN, PINK, YELLOW] as const

type Tower = { x: number; w: number; top: number; seed: number; neon: number }

const towers = (p: Pixels, ground: number): Tower[] => {
  const out: Tower[] = []
  let x = -1
  let i = 0
  while (x < p.w + 1) {
    const w = 5 + Math.floor(hash(i * 5 + 1) * 8)
    const top = ground - p.h * (0.45 + hash(i * 5 + 2) * 0.45)
    out.push({ x, w, top, seed: i, neon: NEONS[Math.floor(hash(i * 5 + 3) * NEONS.length)] ?? CYAN })
    x += w + 1 + Math.floor(hash(i * 5 + 4) * 3)
    i += 1
  }

  return out
}

// A vertical sign: neon cells with dark gaps, so it reads as glyphs.
const sign = (p: Pixels, x: number, y: number, w: number, h: number, color: number, seed: number, t: number) => {
  // Flicker: about 3% of 125ms slots go dim.
  const isDim = hash(seed * 31 + Math.floor(t * 8)) < 0.03
  const lit = isDim ? mix(color, TOWER, 0.7) : color
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const isGap = hash2(dx + seed * 17, Math.floor(dy / 3) * 5 + (dy % 3)) < 0.3 && dx > 0 && dx < w - 1
      p.dot(x + dx, y + dy, isGap ? TOWER : lit)
    }
  }
}

export const cyberpunk: Scene = {
  id: 'cyberpunk',
  title: 'neon district',
  draw: (p, t) => {
    const ground = Math.round(p.h * 0.84)

    for (let y = 0; y < ground; y++) {
      for (let x = 0; x < p.w; x++) p.px[y * p.w + x] = ramp(SKY, y / ground, x, y)
    }

    // Synthwave sun: yellow to pink, sliced by gaps that widen towards the bottom.
    const sunX = p.w * 0.5
    const sunY = p.h * 0.36
    const sunR = Math.max(4, p.w * 0.3)
    for (let y = Math.floor(sunY - sunR); y <= sunY + sunR; y++) {
      const k = (y - (sunY - sunR)) / (2 * sunR)
      const gap = k > 0.5 && (y - Math.floor(sunY)) % 4 < 1 + (k - 0.5) * 6
      if (gap) continue
      for (let x = Math.floor(sunX - sunR); x <= sunX + sunR; x++) {
        const dx = x + 0.5 - sunX
        const dy = y + 0.5 - sunY
        if (dx * dx + dy * dy <= sunR * sunR) p.dot(x, y, mix(SUN_TOP, SUN_LOW, k))
      }
    }

    for (const tower of towers(p, ground)) {
      // Towers in front of the sun stop below its middle, so it rises over them.
      const isCentral = Math.abs(tower.x + tower.w / 2 - sunX) < sunR
      const top = isCentral ? Math.max(tower.top, sunY + sunR * 0.25) : tower.top
      p.fill(tower.x, tower.x + tower.w, top, ground, TOWER)
      p.fill(tower.x, tower.x + 1, top, ground, RIM)
      // Neon strip down one side.
      const strip = hash(tower.seed * 7) < 0.5 ? tower.x + 1 : tower.x + tower.w - 1
      p.fill(strip, strip + 1, top + 2, ground, mix(tower.neon, TOWER, 0.35))
      for (let y = Math.ceil(top) + 2; y < ground; y += 3) {
        for (let x = tower.x + 2; x < tower.x + tower.w - 2; x += 2) {
          if (hash2(x + tower.seed * 41, y) < 0.2) p.dot(x, y, hash2(x, y) < 0.5 ? mix(CYAN, TOWER, 0.4) : mix(PINK, TOWER, 0.4))
        }
      }
      if (tower.w >= 7 && hash(tower.seed * 13) < 0.7) {
        const signY = top + 3 + hash(tower.seed * 11) * (ground - top) * 0.4
        sign(p, tower.x + 2, signY, 3, Math.max(5, Math.round(p.h * 0.1)), tower.neon, tower.seed, t)
      }
    }

    // Haze bands drifting across mid-height.
    for (let band = 0; band < 2; band++) {
      const cy = p.h * (0.45 + band * 0.18) + Math.sin(t * 0.2 + band) * 2
      for (let y = Math.floor(cy - 2); y <= cy + 2; y++) {
        for (let x = 0; x < p.w; x++) {
          // Blend, not dither: dithered haze reads as dotted lines.
          const k = (1 - Math.abs(y - cy) / 3) * 0.3
          if (y >= 0 && y < ground) p.dot(x, y, mix(p.get(x, y), HAZE, k))
        }
      }
    }

    // Hover traffic in three lanes, both ways.
    for (let lane = 0; lane < 3; lane++) {
      const y = Math.round(p.h * (0.28 + lane * 0.14))
      const dir = lane % 2 === 0 ? 1 : -1
      for (let car = 0; car < 2; car++) {
        const speed = 6 + hash(lane * 7 + car) * 8
        const span = p.w + 10
        const x = (((hash(lane * 3 + car * 11) * span + dir * t * speed) % span) + span) % span - 5
        p.fill(x - 1, x + 2, y, y + 1, 0x1a1428)
        p.dot(dir > 0 ? x + 2 : x - 2, y, CYAN)
        p.dot(dir > 0 ? x - 2 : x + 2, y, PINK)
      }
    }

    // Wet street mirrors the neon.
    for (let y = ground; y < p.h; y++) {
      const mirror = ground - (y - ground) - 1
      const shift = Math.round(Math.sin(y * 1.7 + t * 3) * 1.5)
      for (let x = 0; x < p.w; x++) {
        p.px[y * p.w + x] = mix(p.get(x + shift, mirror), STREET, 0.5)
      }
    }

    // Rain, slanted, over everything.
    const drops = Math.round((p.w * p.h) / 45)
    for (let i = 0; i < drops; i++) {
      const fall = p.h + 12
      const y = (hash(i * 3 + 1) * fall + t * (38 + hash(i) * 14)) % fall - 6
      const x = (((hash(i * 3 + 2) * p.w - y * 0.25) % p.w) + p.w) % p.w
      p.dot(x, y, mix(RAIN, p.get(x, y), 0.35))
      p.dot(x + 0.25, y - 1, mix(RAIN, p.get(x, y - 1), 0.65))
    }
  },
}
