// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

import type { Size } from './contract'

export type Slot = { id: string; size: Size }
export type Placed = { id: string; x: number; y: number; w: number; h: number }

// Rows per grid unit, border included: 4 inner rows on a 1-high tile.
export const UNIT_ROWS = 6

export const unitsFor = (columns: number): number => (columns >= 64 ? 4 : columns >= 30 ? 2 : 1)

// First fit, row-major, in layout order. A tile wider than the grid shrinks
// to the grid instead of being dropped.
export const pack = (slots: readonly Slot[], units: number): Placed[] => {
  const taken: boolean[][] = []
  const isFree = (x: number, y: number, w: number, h: number) => {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) if (taken[y + dy]?.[x + dx]) return false
    }
    return true
  }
  const placed: Placed[] = []
  for (const slot of slots) {
    const w = Math.min(slot.size.w, units)
    const h = slot.size.h
    for (let y = 0; ; y++) {
      const x = [...Array(units - w + 1).keys()].find(x0 => isFree(x0, y, w, h))
      if (x === undefined) continue
      for (let dy = 0; dy < h; dy++) {
        taken[y + dy] ??= []
        for (let dx = 0; dx < w; dx++) taken[y + dy]![x + dx] = true
      }
      placed.push({ id: slot.id, x, y, w, h })
      break
    }
  }

  return placed
}

export const parseSize = (s: string): Size | undefined => {
  const m = /^([1-4])x([1-3])$/.exec(s.trim())
  if (m === null) return undefined
  return { w: Number(m[1]) as Size['w'], h: Number(m[2]) as Size['h'] }
}

export const showSize = (size: Size): string => `${size.w}x${size.h}`
