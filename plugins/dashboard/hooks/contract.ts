// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

// Widget contract v1. Widgets are pure: data in, cells out, no `$`. The host
// owns every side effect. Within v1 changes are additive only; a breaking
// change is v2 and the host refuses widgets it does not know.

export const CONTRACT = 1

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

// Grid units. The host clamps w to the columns the pane has.
export type Size = { w: 1 | 2 | 3 | 4; h: 1 | 2 | 3 }

// Semantic tones, never hex. One palette change restyles every widget.
export type Tone = 'fg' | 'dim' | 'faint' | 'accent' | 'add' | 'mod' | 'del' | 'info' | 'link'

export type Need = 'session' | 'git'

// Contract-owned shapes, mapped by the host from the engine's own. Engine API
// changes land in the host's mapping, not in every widget.
export type SessionSnapshot = {
  window: number
  contextTokens?: number
  compactAt?: number
  usd?: number
  turns: number
  // Context growth per answered turn, moving average.
  tokensPerTurn?: number
  history: readonly number[]
  // Subscription plans report usage windows; API keys report money.
  // Absent until the first response says which. (v1 addition.)
  plan?: 'subscription' | 'api'
}

export type GitFile = {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'
  adds: number
  dels: number
  isStaged: boolean
}

export type GitCommit = { hash: string; subject: string; author: string; at: number }

export type GitSnapshot = {
  isRepo: boolean
  // The folder git ran in, home shortened to ~. (v1 addition.)
  cwd?: string
  branch: string
  upstream?: string
  ahead: number
  behind: number
  commits: readonly GitCommit[]
  files: readonly GitFile[]
}

export type Input =
  | { kind: 'tick'; now: number }
  | { kind: 'session'; session: SessionSnapshot }
  | { kind: 'git'; git: GitSnapshot }
  | { kind: 'key'; action: string }
  | { kind: 'prompt'; text: string }
  | { kind: 'fetched'; tag: string; ok: boolean; status: number; text: string }

export type Effect = { kind: 'fetch'; tag: string; url: string } | { kind: 'toast'; text: string }

export type Step<S> = { state: S; effects?: readonly Effect[] }

// `n` is the host's: it moves focus to the next tile.
export const RESERVED_HOTKEYS = ['n'] as const
export type Key = { hotkey: string; label: string; action: string }

// The drawing surface of one tile, inside its border. Clips everything.
export type Tile = {
  readonly cols: number
  readonly rows: number
  // True when this tile's keys are the live ones. (v1 addition.)
  readonly isFocused: boolean
  text(x: number, y: number, s: string, tone?: Tone): void
  // Dot-matrix: 0-9 : % . - $ k M. Scale 1: 2 cells wide, 2 rows tall per
  // glyph. Scale 2: 4 wide, 3 tall. (v1 addition: `scale`.)
  digits(x: number, y: number, s: string, tone?: Tone, scale?: 1 | 2): void
  // Segments in order, each a share of the width; the rest drawn faint.
  meter(x: number, y: number, width: number, parts: readonly { share: number; tone: Tone }[]): void
  spark(x: number, y: number, width: number, values: readonly number[], tone?: Tone): void
  // Text that opens `url` on click. https only; anything else draws as plain
  // text. (v1 addition.)
  link(x: number, y: number, s: string, url: string, tone?: Tone): void
}

export type Widget<S> = {
  contract: typeof CONTRACT
  // Kebab-case, stable forever: keys layouts and saved state.
  id: string
  title: string
  sizes: readonly Size[]
  tickMs?: number
  needs?: readonly Need[]
  // A prompt starting with this and a space goes to the widget, never the model.
  prefix?: string
  keys?: readonly Key[]
  init(saved: Json | undefined, now: number): Step<S>
  update(state: S, input: Input): Step<S>
  draw(state: S, tile: Tile, now: number): void
  persist?(state: S): Json
}

// Typed at the definition, erased in the registry.
export const defineWidget = <S>(widget: Widget<S>): Widget<unknown> => widget as unknown as Widget<unknown>

// Dot-matrix size of `s` in cells.
export const digitsWidth = (s: string, scale: 1 | 2 = 1): number => s.length * 2 * scale
export const digitsHeight = (scale: 1 | 2 = 1): number => Math.ceil((5 * scale + 1) / 4)
