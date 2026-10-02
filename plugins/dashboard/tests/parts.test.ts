// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

import { describe, expect, test } from 'claude-code/testing'

import { parseLog, parseNumstat, parseStatus, snapshot } from '../hooks/gitparse'
import { pack } from '../hooks/grid'
import { safeHref } from '../hooks/href'
import { Board } from '../hooks/kit'
import { clock } from '../hooks/widgets/clock'
import { context } from '../hooks/widgets/context'

describe('git parsing', () => {
  const STATUS = [
    '# branch.oid 4f2c1e0aaaa',
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +2 -1',
    '1 .M N... 100644 100644 100644 aaaa bbbb plugins/x/register.tsx',
    '1 A. N... 000000 100644 100644 0000 cccc new file.ts',
    '1 D. N... 100644 000000 000000 dddd 0000 gone.ts',
    '2 R. N... 100644 100644 100644 eeee ffff R100 renamed.ts\told.ts',
    '? loose.txt',
  ].join('\n')

  test('status: branch, ahead/behind, kinds, paths with spaces, renames', () => {
    const s = parseStatus(STATUS)
    expect([s.branch, s.upstream, s.ahead, s.behind]).toEqual(['main', 'origin/main', 2, 1])
    expect(s.files.map(f => [f.path, f.status, f.isStaged])).toEqual([
      ['plugins/x/register.tsx', 'modified', false],
      ['new file.ts', 'added', true],
      ['gone.ts', 'deleted', true],
      ['renamed.ts', 'renamed', true],
      ['loose.txt', 'untracked', false],
    ])
  })

  test('numstat: sums staged and unstaged, binary counts as 0, renames key on the new path', () => {
    const n = parseNumstat('3\t1\tplugins/x/register.tsx\n-\t-\timg.png\n4\t0\tplugins/{old.ts => renamed.ts}\n2\t2\tplugins/x/register.tsx')
    expect(n.get('plugins/x/register.tsx')).toEqual({ adds: 5, dels: 3 })
    expect(n.get('img.png')).toEqual({ adds: 0, dels: 0 })
    expect(n.get('plugins/renamed.ts')).toEqual({ adds: 4, dels: 0 })
  })

  test('log: unit separator fields, subjects keep their own pipes', () => {
    const [c] = parseLog('4f2c1e0\x1fShabier\x1f1759406400\x1fdrop music | for real')
    expect(c).toEqual({ hash: '4f2c1e0', author: 'Shabier', at: 1759406400000, subject: 'drop music | for real' })
  })

  test('snapshot joins status with numstat', () => {
    const s = snapshot(STATUS, '', '3\t1\tplugins/x/register.tsx', '')
    expect(s.files[0]).toEqual({ path: 'plugins/x/register.tsx', status: 'modified', adds: 3, dels: 1, isStaged: false })
  })
})

describe('grid', () => {
  test('first fit, no overlaps, wide tiles shrink to the grid', () => {
    const placed = pack(
      [
        { id: 'a', size: { w: 2, h: 1 } },
        { id: 'b', size: { w: 2, h: 2 } },
        { id: 'c', size: { w: 2, h: 1 } },
        { id: 'd', size: { w: 4, h: 2 } },
      ],
      4,
    )
    expect(placed).toEqual([
      { id: 'a', x: 0, y: 0, w: 2, h: 1 },
      { id: 'b', x: 2, y: 0, w: 2, h: 2 },
      { id: 'c', x: 0, y: 1, w: 2, h: 1 },
      { id: 'd', x: 0, y: 2, w: 4, h: 2 },
    ])
    expect(pack([{ id: 'd', size: { w: 4, h: 2 } }], 2)).toEqual([{ id: 'd', x: 0, y: 0, w: 2, h: 2 }])
  })
})

describe('kit', () => {
  test('digits are Braille, 2 cells per glyph, 2 rows tall', () => {
    const board = new Board(12, 4)
    board.tile(0, 0, 12, 4).digits(0, 0, '12:3', 'accent')
    const row = (y: number) => [...Array(8).keys()].map(x => board.cells[(y * 12 + x + 1 + 12) * 3] ?? 0)
    for (const cp of [...row(0), ...row(1)]) expect(cp >= 0x2800 && cp <= 0x28ff).toBe(true)
    expect(row(0).some(cp => cp !== 0x2800)).toBe(true)
  })

  test('text clips at the tile edge, outside-BMP characters become spaces', () => {
    const board = new Board(8, 3)
    board.tile(0, 0, 8, 3).text(0, 0, 'abcdefghij\u{1F600}', 'fg')
    const inner = [...Array(8).keys()].map(x => String.fromCharCode(board.cells[(8 + x) * 3] ?? 0)).join('')
    expect(inner).toBe(' abcdef ')
  })
})

describe('context', () => {
  const shown = (plan?: 'subscription' | 'api') => {
    const board = new Board(40, 6)
    const state = context.update(context.init(undefined, 0).state, {
      kind: 'session',
      session: { window: 200_000, contextTokens: 120_000, compactAt: 160_000, usd: 4.81, turns: 9, tokensPerTurn: 8_000, history: [], plan },
    }).state
    context.draw(state, board.tile(0, 0, 40, 6), 0)
    return [...Array(40 * 6).keys()].map(i => String.fromCharCode(board.cells[i * 3] ?? 32)).join('')
  }

  test('money shows for API keys only: not on a subscription, not before the plan is known', () => {
    expect(shown('api')).toContain('$4.81')
    expect(shown('subscription')).not.toContain('$')
    expect(shown(undefined)).not.toContain('$')
  })

  test('no big number: the share sits at the end of the bar label', () => {
    const text = shown('api')
    expect(text).toContain('120k / 160k to compaction')
    expect(text).toContain('75%')
    expect(text).toContain('~5 turns at 8.0k/turn')
  })
})

describe('safeHref', () => {
  test('https passes, @ is encoded, anything Link would refuse becomes undefined', () => {
    expect(safeHref('https://news.ycombinator.com/item?id=1')).toBe('https://news.ycombinator.com/item?id=1')
    expect(safeHref('https://medium.com/@someone/a-post')).toBe('https://medium.com/%40someone/a-post')
    expect(safeHref('https://example.com/caf\u00e9 menu')).toBe('https://example.com/caf%C3%A9%20menu')
    expect(safeHref('http://example.com/')).toBeUndefined()
    expect(safeHref('https://user:pw@example.com/')).toBeUndefined()
    expect(safeHref('javascript:alert(1)')).toBeUndefined()
    expect(safeHref('not a url')).toBeUndefined()
  })
})

describe('clock', () => {
  test('time and date sit centred as one block, both ways', () => {
    for (const [cols, rows] of [[31, 9], [31, 6], [40, 14]] as const) {
      const board = new Board(cols + 2, rows + 2)
      clock.draw(clock.init(undefined, Date.UTC(2026, 9, 2, 13, 26, 18)).state, board.tile(0, 0, cols + 2, rows + 2), 0)
      const lit = (x: number, y: number) => {
        const cp = board.cells[((y + 1) * (cols + 2) + x + 1) * 3] ?? 32
        return cp !== 32 && cp !== 0x2800
      }
      const used = [...Array(rows).keys()].filter(y => [...Array(cols).keys()].some(x => lit(x, y)))
      const above = used[0] ?? 0
      const below = rows - 1 - (used[used.length - 1] ?? 0)
      expect({ cols, rows, off: Math.abs(above - below) <= 1 }).toEqual({ cols, rows, off: true })
    }
  })
})

describe('context centring', () => {
  test('its lines sit centred as one block', () => {
    for (const rows of [4, 7, 12]) {
      const board = new Board(36, rows + 2)
      const state = context.update(context.init(undefined, 0).state, {
        kind: 'session',
        session: { window: 200_000, contextTokens: 120_000, compactAt: 160_000, usd: 1, turns: 3, tokensPerTurn: 8_000, history: [1, 2, 3], plan: 'api' },
      }).state
      context.draw(state, board.tile(0, 0, 36, rows + 2), 0)
      const lit = (y: number) => [...Array(34).keys()].some(x => (board.cells[((y + 1) * 36 + x + 1) * 3] ?? 32) !== 32)
      const used = [...Array(rows).keys()].filter(lit)
      const above = used[0] ?? 0
      const below = rows - 1 - (used[used.length - 1] ?? 0)
      expect({ rows, off: Math.abs(above - below) <= 1 }).toEqual({ rows, off: true })
    }
  })
})
