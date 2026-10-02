// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ArcadePick } from '../types'
import type { Cartridge, Game } from './cartridge'
import { blockDrop } from './games/blocks'
import { flap } from './games/flap'
import { roadHopper } from './games/hopper'
import { railRunner } from './games/rail'
import { twenty48 } from './games/twenty48'
import { menuWords } from './menu'
import { encode } from './screen'

const PANE = 'arcade'
const TITLE = 'Arcade'
// Dock floor. Below it the engine seats panes inline, above the prompt.
const DOCK_COLUMNS = 110
const WATCH_MS = 250
// Fallback only, before the pane reports its body height.
const CHROME_ROWS = 6

const CARTS: readonly Cartridge[] = [railRunner, roadHopper, blockDrop, flap, twenty48]

const ALIASES: Readonly<Record<string, string>> = {
  subway: 'rail',
  crossy: 'hopper',
  road: 'hopper',
  tetris: 'blocks',
  block: 'blocks',
  flappy: 'flap',
}

// Pick lives in $.state: survives hot reload, and a write redraws the pane.
// The run is module-local; a reload restarts it. Best scores: $.store.
const pick = atom({ plugin: 'arcade', key: 'pick' } as const, null as ArcadePick)

let cart: Cartridge | undefined
let game: Game | undefined
let best: Record<string, number> = {}
let size = { columns: 0, rows: 0 }
let clock: { cancel: () => void } | undefined
let lastTick = 0
// Keys only arrive while the pane is focused. Unfocused run = unplayable
// run, so it pauses.
let isActive = false
let placement: 'dock' | 'inline' | undefined
let isHiddenByWidth = false
let viewport = { columns: 0, isFullscreen: false }

const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, Math.floor(n)))

const frame = (columns: number, rows: number): string =>
  encode(
    game !== undefined && cart !== undefined
      ? game.frame(columns, rows, best[cart.id] ?? 0)
      : menuWords(CARTS, best, columns, rows),
  )

const find = (name: string): Cartridge | undefined => {
  const wanted = name.trim().toLowerCase()
  const id = ALIASES[wanted] ?? wanted

  return CARTS.find(one => one.id === id || one.title.toLowerCase().startsWith(id))
}

// Timer and press callbacks have no caller to throw to. Failures go to
// `claude --debug`.
function report($: EngineInterface, error: unknown) {
  $.ui.log(`arcade: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
}

async function paint($: EngineInterface) {
  if (size.columns === 0) return
  await $.ui.blit({ requestId: PANE, key: 'view', columns: size.columns, rows: size.rows, cells: frame(size.columns, size.rows) })
}

async function record($: EngineInterface) {
  if (game === undefined || cart === undefined || game.phase !== 'over') return
  if (game.score <= (best[cart.id] ?? 0)) return
  best = { ...best, [cart.id]: game.score }
  await $.store.set('best', best)
}

async function tick($: EngineInterface) {
  if (game === undefined || cart === undefined) return
  const now = await $.clock.now()
  const ms = lastTick === 0 ? cart.tickMs : now - lastTick
  lastTick = now

  if (game.phase === 'play' && !isActive) {
    game.pause()
    await paint($)
    return
  }
  if (game.step(ms)) {
    await record($)
    await paint($)
  }
}

// The pane subscribes to the pick. Writing it swaps the control row.
async function load($: EngineInterface, next: Cartridge | undefined) {
  clock?.cancel()
  clock = undefined
  cart = next
  game = next?.start(Math.floor(await $.clock.now()))
  lastTick = 0
  if (next !== undefined && next.tickMs > 0) {
    clock = $.clock.every(next.tickMs, () => void tick($).catch(error => report($, error)))
  }
  await update($, pick, () => next?.id ?? null)
}

async function press($: EngineInterface, action: string) {
  // A press proves focus. Without this the next tick can pause the run
  // before watch() catches up.
  isActive = true
  if (game === undefined) return
  game.act(action)
  await record($)
  await paint($)
}

// Below DOCK_COLUMNS the engine moves the pane above the prompt instead of
// hiding it. Close it there, reopen once the window is wide again.
async function watch($: EngineInterface) {
  const pane = (await $.ui.panes()).find(one => one.id === PANE)
  isActive = pane !== undefined && pane.isShown && pane.isPlaced && pane.isFocused

  if (pane !== undefined && placement === 'inline') {
    isHiddenByWidth = true
    placement = undefined
    size = { columns: 0, rows: 0 }
    game?.pause()
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
  else if (value !== '') return 'Usage: /arcade autostart on|off'
  return (await $.store.get('autostart')) === true
    ? 'The arcade opens at session start. /arcade autostart off undoes it.'
    : 'The arcade opens on /arcade only. /arcade autostart on opens it at session start.'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const stored = await $.store.get('best')
    best = typeof stored === 'object' && stored !== null ? { ...(stored as Record<string, number>) } : {}
    await $.command.register({
      name: 'arcade',
      description: 'Open or close the arcade in the side pane; /arcade <game> starts one; /arcade autostart on|off',
      argumentHint: '[rail|hopper|blocks|flap|2048|autostart]',
    })
    // Hot reload: resume the picked game.
    const picked = await read($, pick)
    if (picked !== null) await load($, CARTS.find(one => one.id === picked))
    // Opt-in only. Unasked, the engine seats it from 144 columns, 110 once asked for.
    if ((await $.store.get('autostart')) === true) void $.ui.open({ id: PANE, title: TITLE })
    $.clock.every(WATCH_MS, () => void watch($).catch(error => report($, error)))

    return next(e)
  })

  on('command.run', { command: 'arcade' }, async ($, e) => {
    const [verb = '', value = ''] = e.args.trim().split(/\s+/)
    if (verb === 'autostart') return { text: await autostart($, value) }
    const wanted = e.args.trim() === '' ? undefined : find(e.args)
    if (e.args.trim() !== '' && wanted === undefined) {
      return { text: `No game called "${e.args.trim()}". Try: ${CARTS.map(one => one.id).join(', ')}.` }
    }

    const isOpen = (await $.ui.panes()).some(one => one.id === PANE)
    if (isOpen && wanted === undefined) {
      isHiddenByWidth = false
      game?.pause()
      await $.ui.close({ id: PANE })
      return { text: 'Arcade closed.' }
    }
    if (!e.presentation.isFullscreen) {
      return { text: 'The arcade needs the fullscreen layout, where panes dock beside the transcript.' }
    }
    if (e.presentation.columns < DOCK_COLUMNS) {
      return { text: `The arcade needs a window of ${DOCK_COLUMNS} columns or more. This one has ${e.presentation.columns}.` }
    }

    isHiddenByWidth = false
    if (wanted !== undefined) await load($, wanted)
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: wanted === undefined ? 'Arcade opened. Click the pane, then pick a number.' : `${wanted.title} is up. Click the pane, then press w.` }
  })

  on('ui.close', ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') {
      // Closed by hand: stays closed until /arcade.
      isHiddenByWidth = false
      game?.pause()
    }

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
      return <Text dimColor>The arcade plays in the terminal.</Text>
    }

    const { Box, Button, Raster, Text } = $.ui.resolve(e)
    placement = e.props.placement
    if (e.viewport !== undefined) {
      viewport = { columns: e.viewport.columns, isFullscreen: e.viewport.isFullscreen === true }
    }

    if (e.props.placement === 'inline') {
      return <Text dimColor>The arcade hides: the window is too narrow for the dock.</Text>
    }

    const columns = clamp(e.props.bodyColumns, 1, 512)
    // The pane reports its body height; the button row under the Raster takes one.
    const body = e.props.scroll.bodyRows > 0 ? e.props.scroll.bodyRows : (e.viewport?.rows ?? 30) - CHROME_ROWS
    const rows = clamp(body - 1, 8, 256)
    size = { columns, rows }

    // Subscribes this render to the pick.
    const picked = await read($, pick)
    const shown = CARTS.find(one => one.id === picked)
    const buttons =
      shown === undefined || cart !== shown
        ? CARTS.map((one, i) => (
            <Button key={`pick-${one.id}`} hotkey={`${i + 1}`} label={one.title} plain onPress={() => void load($, one).catch(error => report($, error))} />
          ))
        : [
            ...shown.controls.map(control => (
              <Button
                key={control.action}
                hotkey={control.hotkey}
                label={control.label}
                plain
                onPress={() => void press($, control.action).catch(error => report($, error))}
              />
            )),
            <Button key="menu" hotkey="q" label="menu" plain onPress={() => void load($, undefined).catch(error => report($, error))} />,
          ]

    return (
      <Box flexDirection="column">
        <Raster key="view" columns={columns} rows={rows} cells={frame(columns, rows)} />
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {buttons}
        </Box>
      </Box>
    )
  })
}
