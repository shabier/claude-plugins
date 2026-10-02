// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AmbientScene } from '../types'
import { cyberpunk } from './scenes/cyberpunk'
import { koi } from './scenes/koi'
import { metropolis } from './scenes/metropolis'
import { mountains } from './scenes/mountains'
import { encodeCells, label, Pixels, type Scene } from './screen'

const PANE = 'ambient'
const TITLE = 'Ambient'
// Dock floor. Below it the engine seats panes inline, above the prompt.
const DOCK_COLUMNS = 110
// ~12fps. Smooth enough for drifting water, half the arcade's blit traffic.
const TICK_MS = 83
const WATCH_MS = 250
// Fallback only, before the pane reports its body height.
const CHROME_ROWS = 6
const LABEL_S = 2.5

const SCENES: readonly (Scene & { short: string })[] = [
  { ...koi, short: 'koi' },
  { ...mountains, short: 'peaks' },
  { ...metropolis, short: 'city' },
  { ...cyberpunk, short: 'neon' },
]

const ALIASES: Readonly<Record<string, string>> = {
  pond: 'koi',
  peaks: 'mountains',
  city: 'metropolis',
  neon: 'cyberpunk',
}

const scene = atom({ plugin: 'ambient', key: 'scene' } as const, 'koi' as AmbientScene)

let shown: Scene = koi
let size = { columns: 0, rows: 0 }
let startedAt = 0
let switchedAt = -LABEL_S
let isVisible = false
let placement: 'dock' | 'inline' | undefined
let isHiddenByWidth = false
let viewport = { columns: 0, isFullscreen: false }

const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, Math.floor(n)))

const find = (name: string): (typeof SCENES)[number] | undefined => {
  const wanted = name.trim().toLowerCase()
  const id = ALIASES[wanted] ?? wanted

  return SCENES.find(one => one.id === id || one.short === id)
}

const frame = (columns: number, rows: number, t: number): string => {
  const p = new Pixels(columns, rows)
  shown.draw(p, t)
  const cells = p.cells()
  if (t - switchedAt < LABEL_S) label(cells, columns, rows - 2, 2, shown.title, 0xf3e6d8)

  return encodeCells(cells)
}

// Timer and press callbacks have no caller to throw to. Failures go to
// `claude --debug`.
function report($: EngineInterface, error: unknown) {
  $.ui.log(`ambient: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
}

async function seconds($: EngineInterface): Promise<number> {
  return ((await $.clock.now()) - startedAt) / 1000
}

async function paint($: EngineInterface) {
  if (size.columns === 0) return
  const cells = frame(size.columns, size.rows, await seconds($))
  await $.ui.blit({ requestId: PANE, key: 'view', columns: size.columns, rows: size.rows, cells })
}

async function tick($: EngineInterface) {
  if (isVisible) await paint($)
}

async function pick($: EngineInterface, next: Scene) {
  shown = next
  switchedAt = await seconds($)
  await update($, scene, () => next.id)
  await $.store.set('scene', next.id)
  await paint($)
}

// Below DOCK_COLUMNS the engine moves the pane above the prompt instead of
// hiding it. Close it there, reopen once the window is wide again.
async function watch($: EngineInterface) {
  const pane = (await $.ui.panes()).find(one => one.id === PANE)
  isVisible = pane !== undefined && pane.isShown && pane.isPlaced

  if (pane !== undefined && placement === 'inline') {
    isHiddenByWidth = true
    placement = undefined
    size = { columns: 0, rows: 0 }
    await $.ui.close({ id: PANE })
    return
  }

  const isWide = viewport.isFullscreen && viewport.columns >= DOCK_COLUMNS
  if (pane === undefined && isHiddenByWidth && isWide) {
    isHiddenByWidth = false
    await $.ui.open({ id: PANE, title: TITLE })
  }
}

// Off by default: no pane opens by itself unless the person turned this on.
async function autostart($: EngineInterface, value: string): Promise<string> {
  if (value === 'on' || value === 'off') await $.store.set('autostart', value === 'on')
  else if (value !== '') return 'Usage: /ambient autostart on|off'
  return (await $.store.get('autostart')) === true
    ? 'Ambient opens at session start. /ambient autostart off undoes it.'
    : 'Ambient opens on /ambient only. /ambient autostart on opens it at session start.'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    startedAt = await $.clock.now()
    const stored = await $.store.get('scene')
    shown = (typeof stored === 'string' ? find(stored) : undefined) ?? koi
    await update($, scene, () => shown.id)
    await $.command.register({
      name: 'ambient',
      description: 'Open or close the ambient pane; /ambient <scene> switches scene; /ambient autostart on|off',
      argumentHint: '[koi|mountains|metropolis|cyberpunk|autostart]',
    })
    // Opt-in only. Unasked, the engine seats it from 144 columns, 110 once asked for.
    if ((await $.store.get('autostart')) === true) void $.ui.open({ id: PANE, title: TITLE })
    $.clock.every(TICK_MS, () => void tick($).catch(error => report($, error)))
    $.clock.every(WATCH_MS, () => void watch($).catch(error => report($, error)))

    return next(e)
  })

  on('command.run', { command: 'ambient' }, async ($, e) => {
    const args = e.args.trim()
    const [verb = '', value = ''] = args.split(/\s+/)
    if (verb === 'autostart') return { text: await autostart($, value) }
    const wanted = args === '' ? undefined : find(args)
    if (args !== '' && wanted === undefined) {
      return { text: `No scene called "${args}". Try: ${SCENES.map(one => one.id).join(', ')}.` }
    }

    const isOpen = (await $.ui.panes()).some(one => one.id === PANE)
    if (isOpen && wanted === undefined) {
      isHiddenByWidth = false
      await $.ui.close({ id: PANE })
      return { text: 'Ambient closed.' }
    }
    if (!e.presentation.isFullscreen) {
      return { text: 'Ambient needs the fullscreen layout, where panes dock beside the transcript.' }
    }
    if (e.presentation.columns < DOCK_COLUMNS) {
      return { text: `Ambient needs a window of ${DOCK_COLUMNS} columns or more. This one has ${e.presentation.columns}.` }
    }

    isHiddenByWidth = false
    await $.ui.open({ id: PANE, title: TITLE })
    if (wanted !== undefined) await pick($, wanted)

    return { text: `Ambient: ${shown.title}.` }
  })

  on('ui.close', ($, e, next) => {
    // Closed by hand: stays closed until /ambient.
    if (e.id === PANE && e.origin.kind === 'person') isHiddenByWidth = false

    return next(e)
  })

  // Width probe. The band re-renders on every resize, even with the pane
  // closed. Returns the engine's band untouched.
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (e.surface === 'terminal' && e.viewport !== undefined) {
      viewport = { columns: e.viewport.columns, isFullscreen: e.viewport.isFullscreen === true }
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>Ambient draws in the terminal.</Text>
    }

    const { Box, Button, Raster, Text } = $.ui.resolve(e)
    placement = e.props.placement
    if (e.viewport !== undefined) {
      viewport = { columns: e.viewport.columns, isFullscreen: e.viewport.isFullscreen === true }
    }
    if (e.props.placement === 'inline') {
      return <Text dimColor>Ambient hides: the window is too narrow for the dock.</Text>
    }

    const columns = clamp(e.props.bodyColumns, 1, 512)
    // The pane reports its body height; the button row under the Raster takes one.
    const body = e.props.scroll.bodyRows > 0 ? e.props.scroll.bodyRows : (e.viewport?.rows ?? 30) - CHROME_ROWS
    const rows = clamp(body - 1, 8, 256)
    size = { columns, rows }
    // Subscribes this render to the pick: a switch relabels the buttons.
    const current = await read($, scene)

    return (
      <Box flexDirection="column">
        <Raster key="view" columns={columns} rows={rows} cells={frame(columns, rows, await seconds($))} />
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {SCENES.map((one, i) => (
            <Button
              key={`scene-${one.id}`}
              hotkey={`${i + 1}`}
              label={one.short}
              plain
              dimColor={one.id !== current}
              onPress={() => void pick($, one).catch(error => report($, error))}
            />
          ))}
        </Box>
      </Box>
    )
  })
}
