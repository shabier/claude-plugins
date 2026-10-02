// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

import { describe, expect, mock, test } from 'claude-code/testing'

import { cyberpunk } from '../hooks/scenes/cyberpunk'
import { koi } from '../hooks/scenes/koi'
import { metropolis } from '../hooks/scenes/metropolis'
import { mountains } from '../hooks/scenes/mountains'
import { Pixels } from '../hooks/screen'

const SCENES = [koi, mountains, metropolis, cyberpunk]

describe('scenes', () => {
  test('every scene fills every pixel at three pane sizes and three times', () => {
    for (const scene of SCENES) {
      for (const [columns, rows] of [[20, 12], [44, 40], [90, 60]] as const) {
        for (const t of [0, 7.3, 3600.5]) {
          const p = new Pixels(columns, rows)
          scene.draw(p, t)
          expect({ scene: scene.id, columns, t, unpainted: p.px.filter(c => c === 0).length }).toEqual({
            scene: scene.id,
            columns,
            t,
            unpainted: 0,
          })
        }
      }
    }
  })

  test('every scene moves', () => {
    for (const scene of SCENES) {
      const a = new Pixels(44, 40)
      const b = new Pixels(44, 40)
      scene.draw(a, 10)
      scene.draw(b, 11)
      expect({ scene: scene.id, moves: a.px.some((c, i) => c !== b.px[i]) }).toEqual({ scene: scene.id, moves: true })
    }
  })
})

const PANE = {
  plugin: 'ambient',
  surface: 'terminal' as const,
  component: 'Pane' as const,
  requestId: 'ambient',
  viewport: { columns: 160, rows: 46, isFullscreen: true },
  props: {
    title: 'Ambient',
    isFocused: true,
    bodyColumns: 44,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
}

describe('the pane', () => {
  test('one button per scene; a press switches and repaints', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const blits: string[] = []
    on('ui.blit', (_$, e) => {
      blits.push(e.key)
      return { value: {} }
    })

    const ui = await $.ui.mount(PANE)
    expect(await ui.find({ type: 'Raster', key: 'view' })).toBeDefined()
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(4)

    await ui.press({ key: 'scene-cyberpunk' })
    expect(blits).toContain('view')
    expect((await ui.find({ key: 'scene-cyberpunk' }))?.props.dimColor).toBe(false)
    await ui.unmount()
  })
})
