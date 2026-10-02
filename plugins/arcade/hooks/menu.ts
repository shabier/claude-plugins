// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

import type { Cartridge } from './cartridge'
import { BAR_PX, hash, mix, Pixels, scoreBar, UI, write } from './screen'

const SKY_TOP = 0x0c0a12
const SKY_LOW = 0x3b1e2a
const STAR = 0x8a7f9a

export const menuWords = (
  carts: readonly Cartridge[],
  best: Readonly<Record<string, number>>,
  columns: number,
  rows: number,
): Uint32Array => {
  const p = new Pixels(columns, rows)
  for (let y = BAR_PX; y < p.h; y++) {
    const sky = mix(SKY_TOP, SKY_LOW, (y - BAR_PX) / p.h)
    for (let x = 0; x < p.w; x++) {
      p.px[y * p.w + x] = hash(x * 7919 + y * 104729) < 0.015 ? STAR : sky
    }
  }

  const cells = p.cells()
  scoreBar(cells, columns, { text: 'ARCADE', color: UI.accent }, null, { text: 'pick a number', color: UI.dim })

  const width = Math.min(columns - 2, 30)
  const left = Math.max(1, Math.floor((columns - width) / 2))
  const first = Math.max(3, Math.floor(rows * 0.25))
  carts.forEach((cart, i) => {
    const row = first + i * 2
    const score = best[cart.id]
    const right = score === undefined ? '' : `${score}`
    write(cells, columns, row, left, ' '.repeat(width), UI.text, UI.bar)
    write(cells, columns, row, left + 1, `${i + 1}`, UI.gold, UI.bar)
    write(cells, columns, row, left + 4, cart.title, UI.text, UI.bar)
    write(cells, columns, row, left + width - right.length - 1, right, UI.dim, UI.bar)
  })
  write(cells, columns, first + carts.length * 2 + 1, left, 'click here, then a number'.slice(0, width), UI.dim, SKY_LOW)

  return cells
}
