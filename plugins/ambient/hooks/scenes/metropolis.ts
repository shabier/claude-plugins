// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

import { hash, hash2, mix, Pixels, ramp, type Scene } from '../screen'

const SKY = [0x060918, 0x0b1230, 0x16214a, 0x26336a] as const
const STAR = 0xb8c4e8
const MOON = 0xe8e4d2
const CRATER = 0xc4bfa8
const FAR = 0x1b2242
const FAR_WINDOW = 0x56689a
const MID = 0x0f1428
const WARM = 0xffd27a
const COOL = 0xbfe3ff
const BEACON = 0xff4040
const TRACK = 0x2a3048
const TRAIN = 0x3a4566
const TRAIN_WINDOW = 0xfff0b8
const WATER = 0x050814

type Tower = { x: number; w: number; top: number; seed: number }

// Seeded by pane width: the same pane draws the same city every frame.
const skyline = (p: Pixels, layer: number, ground: number, low: number, high: number, minW: number, maxW: number): Tower[] => {
  const towers: Tower[] = []
  let x = -2
  let i = 0
  while (x < p.w + 2) {
    const seed = layer * 1000 + i
    const w = minW + Math.floor(hash(seed * 3 + 1) * (maxW - minW + 1))
    const tall = p.h * (low + hash(seed * 3 + 2) * (high - low))
    towers.push({ x, w, top: ground - tall, seed })
    x += w + (hash(seed * 3 + 3) < 0.3 ? 1 : 0)
    i += 1
  }

  return towers
}

export const metropolis: Scene = {
  id: 'metropolis',
  title: 'metropolis',
  draw: (p, t) => {
    const ground = Math.round(p.h * 0.8)

    for (let y = 0; y < ground; y++) {
      for (let x = 0; x < p.w; x++) {
        const twinkle = hash2(x + Math.floor(t * 0.7) * 3, y) < 0.8
        p.px[y * p.w + x] = y < p.h * 0.45 && hash2(x, y) < 0.01 && twinkle ? STAR : ramp(SKY, y / ground, x, y)
      }
    }

    const moonR = Math.max(2, p.w * 0.07)
    const moonX = p.w * 0.22
    const moonY = p.h * 0.16
    p.disc(moonX, moonY, moonR, MOON)
    p.dot(moonX - moonR * 0.3, moonY - moonR * 0.2, CRATER)
    p.dot(moonX + moonR * 0.35, moonY + moonR * 0.3, CRATER)

    for (const tower of skyline(p, 1, ground, 0.25, 0.55, 3, 7)) {
      p.fill(tower.x, tower.x + tower.w, tower.top, ground, FAR)
      for (let y = Math.ceil(tower.top) + 1; y < ground - 1; y += 2) {
        for (let x = tower.x + 1; x < tower.x + tower.w - 1; x += 2) {
          if (hash2(x * 7 + tower.seed, y) < 0.18) p.dot(x, y, FAR_WINDOW)
        }
      }
      // Beacons on the tallest towers, blinking out of phase.
      if (ground - tower.top > p.h * 0.45) {
        p.fill(tower.x + tower.w / 2, tower.x + tower.w / 2 + 1, tower.top - 3, tower.top, FAR)
        if (Math.floor(t * 1.2 + hash(tower.seed) * 2) % 2 === 0) p.dot(tower.x + tower.w / 2, tower.top - 3, BEACON)
      }
    }

    for (const tower of skyline(p, 2, ground, 0.12, 0.38, 4, 9)) {
      p.fill(tower.x, tower.x + tower.w, tower.top, ground, MID)
      for (let y = Math.ceil(tower.top) + 1; y < ground - 1; y += 2) {
        for (let x = tower.x + 1; x < tower.x + tower.w - 1; x += 2) {
          // Offices switch on and off in their own rhythm, about every 9s.
          const epoch = Math.floor(t / 9 + hash2(x, y))
          if (hash2(x * 13 + tower.seed + epoch * 7, y) < 0.32) p.dot(x, y, hash2(x, y + 1) < 0.7 ? WARM : COOL)
        }
      }
    }

    // Elevated line: a three-car train every 18s.
    const trackY = Math.round(p.h * 0.75)
    p.fill(0, p.w, trackY, trackY + 1, TRACK)
    const length = Math.max(12, p.w * 0.6)
    const trainX = ((t % 18) / 18) * (p.w + length * 1.5) - length
    p.fill(trainX, trainX + length, trackY - 2, trackY, TRAIN)
    for (let x = Math.ceil(trainX) + 1; x < trainX + length - 1; x += 2) {
      if (x % 9 !== 0) p.dot(x, trackY - 2, TRAIN_WINDOW)
    }

    // The river mirrors the city, broken up by ripples.
    for (let y = ground; y < p.h; y++) {
      const mirror = ground - (y - ground) - 1
      const shift = Math.round(Math.sin(y * 1.3 + t * 2.2) * 1.2)
      for (let x = 0; x < p.w; x++) {
        p.px[y * p.w + x] = mix(p.get(x + shift, mirror), WATER, 0.45 + (y - ground) / (p.h - ground) * 0.3)
      }
    }
  },
}
