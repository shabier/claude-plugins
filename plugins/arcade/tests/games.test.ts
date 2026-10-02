// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

import { describe, expect, test } from 'claude-code/testing'

import * as blocks from '../hooks/games/blocks'
import * as flap from '../hooks/games/flap'
import * as hopper from '../hooks/games/hopper'
import * as rail from '../hooks/games/rail'
import * as twenty48 from '../hooks/games/twenty48'

const repeat = (times: number, body: (i: number) => void) => {
  for (let i = 0; i < times; i++) body(i)
}

describe('Rail Runner', () => {
  const runAt = (kind: rail.Kind, z: number): rail.Run => {
    const g = rail.newRun(1, 'play')
    g.things = [{ kind, lane: 1, z, tint: 0 }]
    g.untilRow = 10_000

    return g
  }
  const runFor = (g: rail.Run, ms: number) => repeat(Math.ceil(ms / 50), () => rail.step(g, 50))

  test('a train in the lane ends the run, a lane switch dodges it', () => {
    const stays = runAt('train', 5)
    runFor(stays, 1000)
    expect(stays.phase).toBe('over')

    const dodges = runAt('train', 5)
    rail.act(dodges, 'left')
    runFor(dodges, 2000)
    expect(dodges.phase).toBe('play')
  })

  test('a jump clears a low barrier, a roll clears a high one', () => {
    const jumper = runAt('low', 4)
    rail.act(jumper, 'jump')
    runFor(jumper, 800)
    expect(jumper.phase).toBe('play')

    const roller = runAt('high', 4)
    rail.act(roller, 'roll')
    runFor(roller, 600)
    expect(roller.phase).toBe('play')

    const stander = runAt('low', 4)
    runFor(stander, 800)
    expect(stander.phase).toBe('over')
  })

  test('a coin in the lane is collected', () => {
    const g = runAt('coin', 3)
    runFor(g, 500)
    expect(g.coins).toBe(1)
  })
})

describe('Road Hopper', () => {
  const ready = (lane: hopper.Lane): hopper.Hop => {
    const h = hopper.newHop(1, 'play')
    h.lanes[1 - h.base] = lane
    h.x = 4

    return h
  }
  const runFor = (h: hopper.Hop, ms: number) => repeat(Math.ceil(ms / 50), () => hopper.step(h, 50))

  test('a car in the next lane squashes you', () => {
    const h = ready({ kind: 'road', dir: 1, speed: 0, movers: [{ x: 4, len: 1, tint: 0 }] })
    hopper.act(h, 'forward')
    runFor(h, 100)
    expect(h.death).toBe('squashed')
  })

  test('a tree blocks the hop', () => {
    const h = ready({ kind: 'grass', trees: [4] })
    hopper.act(h, 'forward')
    expect(h.lane).toBe(0)
  })

  test('water takes you, a log carries you', () => {
    const wet = ready({ kind: 'river', dir: 1, speed: 1, movers: [{ x: -4, len: 2, tint: 0 }] })
    hopper.act(wet, 'forward')
    runFor(wet, 300)
    expect(wet.death).toBe('splash')

    const dry = ready({ kind: 'river', dir: 1, speed: 1, movers: [{ x: 3, len: 4, tint: 0 }] })
    hopper.act(dry, 'forward')
    runFor(dry, 600)
    expect(dry.phase).toBe('play')
    expect(dry.x).toBeGreaterThan(4.3)
  })

  test('standing still lets the view catch you', () => {
    const h = ready({ kind: 'grass', trees: [] })
    hopper.act(h, 'forward')
    runFor(h, 25_000)
    expect(h.death).toBe('eagle')
  })

  test('the score is the furthest lane reached', () => {
    const h = ready({ kind: 'grass', trees: [] })
    hopper.act(h, 'forward')
    runFor(h, 200)
    hopper.act(h, 'back')
    expect(h.score).toBe(1)
  })
})

describe('Block Drop', () => {
  test('a hard drop lands on the floor', () => {
    const w = blocks.newWell(1, 'play')
    blocks.act(w, 'drop')
    const floor = w.board.slice(-blocks.WIDTH)
    expect(floor.some(v => v !== 0)).toBe(true)
  })

  test('a full row clears', () => {
    const w = blocks.newWell(1, 'play')
    const floor = w.board.length - blocks.WIDTH
    for (const x of [0, 1, 2, 7, 8, 9]) w.board[floor + x] = 1
    w.piece = { kind: 0, rot: 0, x: 3, y: 1 }
    blocks.act(w, 'drop')
    expect(w.lines).toBe(1)
    expect(w.board.slice(floor).every(v => v === 0)).toBe(true)
  })

  test('four turns bring a piece back', () => {
    const piece = { kind: 2, rot: 0, x: 3, y: 5 }
    expect(blocks.cellsOf({ ...piece, rot: 4 })).toEqual(blocks.cellsOf(piece))
  })

  test('drops with no steering top out the well', () => {
    const w = blocks.newWell(1, 'play')
    repeat(200, () => {
      if (w.phase === 'play') blocks.act(w, 'drop')
    })
    expect(w.phase).toBe('over')
  })
})

describe('Flap', () => {
  const runFor = (f: flap.Flight, ms: number, flapEvery = 0) =>
    repeat(Math.ceil(ms / 33), i => {
      if (flapEvery > 0 && (i * 33) % flapEvery < 33) flap.act(f, 'flap')
      flap.step(f, 33)
    })

  test('without a flap the bird hits the ground', () => {
    const f = flap.newFlight(1, 'play')
    runFor(f, 3000)
    expect(f.phase).toBe('over')
  })

  test('flapping keeps it up, and a pipe passed scores', () => {
    const f = flap.newFlight(1, 'play')
    f.pipes = [{ x: 0.3, gap: 0.3, isPassed: false }]
    repeat(60, () => {
      if (f.y > 0.48) flap.act(f, 'flap')
      flap.step(f, 33)
    })
    expect(f.phase).toBe('play')
    expect(f.score).toBe(1)
  })
})

describe('2048', () => {
  test('a slide merges each pair once', () => {
    expect(twenty48.slideLine([2, 2, 2, 0])).toEqual({ values: [4, 2, 0, 0], gained: 4 })
    expect(twenty48.slideLine([2, 2, 2, 2])).toEqual({ values: [4, 4, 0, 0], gained: 8 })
    expect(twenty48.slideLine([0, 4, 0, 4])).toEqual({ values: [8, 0, 0, 0], gained: 8 })
  })

  test('the last move that fills a locked board ends it', () => {
    const b = twenty48.newBoard(1)
    b.tiles = [2, 4, 2, 4, 4, 2, 4, 2, 8, 4, 2, 4, 32, 16, 32, 0]
    expect(twenty48.slide(b, 'right')).toBe(true)
    expect(b.phase).toBe('over')
  })

  test('a slide that moves nothing does not spawn a tile', () => {
    const b = twenty48.newBoard(1)
    b.tiles = [2, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    expect(twenty48.slide(b, 'left')).toBe(false)
    expect(b.tiles.filter(v => v !== 0)).toHaveLength(2)
  })
})
