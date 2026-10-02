// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

// No pane opens by itself. Autostart is opt-in, per plugin, saved in $.store.

const world = (on: On, stored: Record<string, unknown>): string[] => {
  mock.clock(on)
  mock.store(on, stored)
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: '[]' } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  return opened
}

const START = { cwd: '/repo', surface: 'terminal' as const, isInteractive: true }
// What the engine stamps on a typed command.
const TYPED = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }

describe('autostart', () => {
  test('off by default: nothing opens at session start', async ($, on) => {
    const opened = world(on, {})
    await $.session.start(START)
    expect(opened).toEqual([])
  })

  test('on: the pane opens at session start', async ($, on) => {
    const opened = world(on, { autostart: true })
    await $.session.start(START)
    expect(opened).toEqual(['ambient'])
  })

  test('/ambient autostart flips it and refuses anything but on and off', async ($, on) => {
    world(on, {})
    await $.session.start(START)
    expect((await $.command.run({ command: 'ambient', args: 'autostart on', ...TYPED })).text).toMatch(/opens at session start/)
    expect((await $.command.run({ command: 'ambient', args: 'autostart off', ...TYPED })).text).toMatch(/only/)
    expect((await $.command.run({ command: 'ambient', args: 'autostart maybe', ...TYPED })).text).toMatch(/^Usage/)
  })
})
