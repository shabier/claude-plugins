// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

// Arcade <-> game contract. Anything not in here is the game's business.

export type Phase = 'title' | 'play' | 'paused' | 'over'

// Engine limit: a hotkey is one lowercase letter or digit.
export type Control = { hotkey: string; label: string; action: string }

export type Game = {
  readonly phase: Phase
  readonly score: number
  act(action: string): void
  // false skips the blit.
  step(ms: number): boolean
  pause(): void
  // [codePoint, fg, bg] per cell.
  frame(columns: number, rows: number, best: number): Uint32Array
}

export type Cartridge = {
  id: string
  title: string
  // 0 = turn based, no timer.
  tickMs: number
  controls: readonly Control[]
  start(seed: number): Game
}

// Restart lockout. A late press meant for the dead run would start the next.
export const RESTART_MS = 600

// mulberry32 (Tommy Ettinger). State lives on the game, so a seed replays a run.
export const nextRandom = (state: { rng: number }): number => {
  state.rng = (state.rng + 0x6d2b79f5) | 0
  let t = state.rng
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
