// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

import { describe, expect, test } from 'claude-code/testing'

import { CONTRACT, RESERVED_HOTKEYS, type GitSnapshot, type Input, type Widget } from '../hooks/contract'
import { UNIT_ROWS, unitsFor } from '../hooks/grid'
import { Board } from '../hooks/kit'
import { WIDGETS } from '../hooks/widgets'

// Every widget runs this suite. A new widget passes it or it does not ship.

const NOW = Date.UTC(2026, 9, 2, 12, 0, 0)

const GIT: GitSnapshot = {
  isRepo: true,
  branch: 'feat/a-branch-name-long-enough-to-need-truncating-in-a-narrow-tile',
  upstream: 'origin/main',
  ahead: 2,
  behind: 1,
  commits: [
    { hash: 'a118ea1f', subject: 'release ambient@0.1.1 arcade@0.1.1', author: 'S', at: NOW - 60_000 },
    { hash: '9246ecef', subject: 'x'.repeat(200), author: 'S', at: NOW - 86_400_000 * 3 },
  ],
  files: [
    { path: 'plugins/a/b/c/register.tsx', status: 'modified', adds: 42, dels: 7, isStaged: true },
    { path: 'new.ts', status: 'added', adds: 210, dels: 0, isStaged: false },
    { path: 'gone.ts', status: 'deleted', adds: 0, dels: 328, isStaged: false },
    { path: 'img.png', status: 'modified', adds: 0, dels: 0, isStaged: false },
    { path: 'loose.txt', status: 'untracked', adds: 0, dels: 0, isStaged: false },
  ],
}

// Hostile and boring inputs alike: empty, missing, garbage, failed.
const INPUTS: Input[] = [
  { kind: 'tick', now: NOW },
  { kind: 'session', session: { window: 0, turns: 0, history: [] } },
  { kind: 'session', session: { window: 200_000, contextTokens: 151_000, compactAt: 167_000, usd: 3.2, turns: 14, tokensPerTurn: 6_000, history: [1, 5, 9, 151_000] } },
  { kind: 'session', session: { window: 200_000, contextTokens: 151_000, usd: 3.2, turns: 14, history: [], plan: 'subscription' } },
  { kind: 'session', session: { window: 200_000, contextTokens: 9_000, usd: 0.4, turns: 1, history: [9_000], plan: 'api' } },
  { kind: 'git', git: { isRepo: false, branch: '', ahead: 0, behind: 0, commits: [], files: [] } },
  { kind: 'git', git: { isRepo: false, cwd: '~/a/very/long/path/that/will/not/fit/in/any/tile/at/all', branch: '', ahead: 0, behind: 0, commits: [], files: [] } },
  { kind: 'git', git: GIT },
  { kind: 'key', action: 'down' },
  { kind: 'key', action: 'toggle' },
  { kind: 'key', action: 'no-such-action' },
  { kind: 'prompt', text: '' },
  { kind: 'prompt', text: 'buy milk' },
  { kind: 'key', action: 'delete' },
  { kind: 'fetched', tag: 'top', ok: true, status: 200, text: '[1, 2, "three", null]' },
  { kind: 'fetched', tag: 'item:1', ok: true, status: 200, text: '{"id":1,"title":"Show HN: a thing","score":412,"descendants":88}' },
  { kind: 'fetched', tag: 'item:2', ok: true, status: 200, text: 'not json' },
  { kind: 'fetched', tag: 'top', ok: false, status: 503, text: '' },
  { kind: 'tick', now: NOW + 86_400_000 },
]

// Tile insides at both grid widths the host uses: the dock (2 units) and the
// requested 72 columns (4 units).
const tileSizes = (w: Widget<unknown>) =>
  [44, 72].flatMap(columns => {
    const units = unitsFor(columns)
    const unitCols = Math.floor(columns / units)
    return w.sizes.map(size => ({ cols: Math.min(size.w, units) * unitCols - 1, rows: size.h * UNIT_ROWS }))
  })

const run = (w: Widget<unknown>) => {
  let state = w.init(undefined, NOW).state
  for (const input of INPUTS) state = w.update(state, input).state
  return state
}

describe('widget contract', () => {
  test('identities are stable and keys are legal', () => {
    const ids = WIDGETS.map(w => w.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const w of WIDGETS) {
      expect({ id: w.id, ok: /^[a-z][a-z0-9-]*$/.test(w.id) }).toEqual({ id: w.id, ok: true })
      expect({ id: w.id, contract: w.contract }).toEqual({ id: w.id, contract: CONTRACT })
      expect({ id: w.id, ascii: /^[\x20-\x7e]+$/.test(w.title) }).toEqual({ id: w.id, ascii: true })
      expect(w.sizes.length).toBeGreaterThan(0)
      const hotkeys = (w.keys ?? []).map(k => k.hotkey)
      expect(new Set(hotkeys).size).toBe(hotkeys.length)
      for (const hotkey of hotkeys) {
        expect({ id: w.id, hotkey, legal: /^[a-z0-9]$/.test(hotkey) && !RESERVED_HOTKEYS.includes(hotkey as 'n') }).toEqual({ id: w.id, hotkey, legal: true })
      }
    }
  })

  test('every widget survives every input, then draws at every size inside 50ms', () => {
    for (const w of WIDGETS) {
      let state = w.init(undefined, NOW).state
      for (const input of INPUTS) {
        state = w.update(state, input).state
        for (const { cols, rows } of tileSizes(w)) {
          const board = new Board(cols + 2, rows)
          const started = Date.now()
          w.draw(state, board.tile(0, 0, cols + 2, rows), NOW)
          expect({ id: w.id, input: input.kind, cols, slow: Date.now() - started > 50 }).toEqual({ id: w.id, input: input.kind, cols, slow: false })
        }
      }
    }
  })

  test('drawing stays inside the tile', () => {
    for (const w of WIDGETS) {
      const state = run(w)
      const [{ cols, rows }] = tileSizes(w) as [{ cols: number; rows: number }]
      const clean = new Board(cols + 20, rows + 10)
      clean.frame(5, 3, cols + 2, rows, w.title, false)
      const drawn = new Board(cols + 20, rows + 10)
      drawn.frame(5, 3, cols + 2, rows, w.title, false)
      w.draw(state, drawn.tile(5, 3, cols + 2, rows), NOW)
      const outside: number[] = []
      for (let y = 0; y < rows + 10; y++) {
        for (let x = 0; x < cols + 20; x++) {
          const isInside = x > 5 && x < 5 + cols + 1 && y > 3 && y < 3 + rows - 1
          const at = (y * (cols + 20) + x) * 3
          if (!isInside && drawn.cells[at] !== clean.cells[at]) outside.push(at)
        }
      }
      expect({ id: w.id, outside: outside.length }).toEqual({ id: w.id, outside: 0 })
      // Link spans sit inside the tile too, and point at https only.
      for (const span of drawn.links) {
        const ok = span.x > 5 && span.x + [...span.text].length <= 5 + cols + 1 && span.y > 3 && span.y < 3 + rows - 1 && span.url.startsWith('https://')
        expect({ id: w.id, span: span.text, ok }).toEqual({ id: w.id, span: span.text, ok: true })
      }
    }
  })

  test('persist round-trips through JSON', () => {
    for (const w of WIDGETS) {
      if (w.persist === undefined) continue
      const saved = JSON.parse(JSON.stringify(w.persist(run(w))))
      const again = w.init(saved, NOW).state
      expect({ id: w.id, same: w.persist(again) }).toEqual({ id: w.id, same: saved })
    }
  })

  test('effects are only fetch and toast, fetches only over https', () => {
    for (const w of WIDGETS) {
      const effects = [...(w.init(undefined, NOW).effects ?? [])]
      let state = w.init(undefined, NOW).state
      for (const input of INPUTS) {
        const step = w.update(state, input)
        state = step.state
        effects.push(...(step.effects ?? []))
      }
      for (const e of effects) {
        const ok = e.kind === 'toast' || (e.kind === 'fetch' && e.url.startsWith('https://'))
        expect({ id: w.id, effect: e.kind, ok }).toEqual({ id: w.id, effect: e.kind, ok: true })
      }
    }
  })
})
