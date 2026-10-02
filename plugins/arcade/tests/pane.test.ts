// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'arcade',
  surface: 'terminal' as const,
  component: 'Pane' as const,
  requestId: 'arcade',
  viewport: { columns: 160, rows: 46, isFullscreen: true },
}

const PROPS = {
  title: 'Arcade',
  isFocused: true,
  bodyColumns: 44,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

test('the menu lists five games, a pick swaps in its controls, q goes back', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const blits: string[] = []
  on('ui.blit', (_$, e) => {
    blits.push(e.key)
    return { value: {} }
  })

  const ui = await $.ui.mount({ ...PANE, props: PROPS })
  const view = await ui.find({ type: 'Raster', key: 'view' })
  expect(view?.props.columns).toBe(44)
  // Fills the reported body: 40 rows less the button row.
  expect(view?.props.rows).toBe(39)
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(5)

  await ui.press({ key: 'pick-blocks' })
  expect(await ui.find({ key: 'rotate' })).toBeDefined()
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(7)

  await ui.press({ key: 'rotate' })
  expect(blits).toContain('view')

  await ui.press({ key: 'menu' })
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(5)
  await ui.unmount()
})

test('seated above the prompt, it draws no game', async $ => {
  const ui = await $.ui.mount({
    ...PANE,
    props: { ...PROPS, placement: 'inline' },
    viewport: { columns: 90, rows: 46, isFullscreen: true },
  })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect((await ui.find({ type: 'Text' }))?.text).toMatch(/too narrow/)
  await ui.unmount()
})
