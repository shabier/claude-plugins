// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

import { defineWidget, type SessionSnapshot, type Tone } from '../contract'
import { compact } from '../format'

type Context = { session: SessionSnapshot | null }

const toneFor = (share: number): Tone => (share >= 0.8 ? 'del' : share >= 0.6 ? 'mod' : 'add')

export const context = defineWidget<Context>({
  contract: 1,
  id: 'context',
  title: 'Context',
  sizes: [
    { w: 2, h: 1 },
    { w: 2, h: 2 },
  ],
  needs: ['session'],
  init: () => ({ state: { session: null } }),
  update: (state, input) => (input.kind === 'session' ? { state: { session: input.session } } : { state }),
  draw: (state, tile) => {
    const s = state.session
    if (s === null || s.contextTokens === undefined) {
      const wait = 'waiting for the first response'
      tile.text(Math.max(0, Math.floor((tile.cols - wait.length) / 2)), Math.floor((tile.rows - 1) / 2), wait, 'faint')
      return
    }

    // Share of the compaction point when auto-compact is on, else of the window.
    const limit = s.compactAt ?? s.window
    const share = Math.min(1, s.contextTokens / Math.max(1, limit))
    const pct = `${Math.round(share * 100)}%`
    const left = `${compact(Math.max(0, limit - s.contextTokens))} left`
    const perTurn = s.tokensPerTurn ?? 0
    const turnsLeft = perTurn > 0 ? Math.floor(Math.max(0, limit - s.contextTokens) / perTurn) : undefined
    // Money only for API keys: on a subscription the number means nothing.
    const hasCost = s.plan === 'api' && s.usd !== undefined
    const hasSpark = s.history.length > 1 && tile.rows >= 3 + (hasCost ? 1 : 0) + 3

    // Fixed content, so it sits centred as one block, like the clock.
    const height = 3 + (hasCost ? 1 : 0) + (hasSpark ? 3 : 0)
    let y = Math.max(0, Math.floor((tile.rows - height) / 2))

    tile.meter(0, y, tile.cols, [{ share, tone: toneFor(share) }])
    tile.text(0, y + 1, `${compact(s.contextTokens)} / ${compact(limit)} ${s.compactAt === undefined ? 'window' : 'to compaction'}`, 'dim')
    tile.text(tile.cols - pct.length, y + 1, pct, toneFor(share))
    tile.text(0, y + 2, left, 'fg')
    tile.text(
      left.length + 2,
      y + 2,
      turnsLeft === undefined ? `${s.turns} turns so far` : `~${turnsLeft} turns at ${compact(perTurn)}/turn`,
      turnsLeft !== undefined && turnsLeft <= 3 ? 'mod' : 'dim',
    )
    y += 3
    if (hasCost) {
      tile.text(0, y, `$${(s.usd ?? 0).toFixed(2)} this session`, 'dim')
      y += 1
    }
    if (hasSpark) {
      tile.text(0, y + 1, 'context per turn', 'faint')
      tile.spark(0, y + 2, tile.cols, s.history, 'info')
    }
  },
})
