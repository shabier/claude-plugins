// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'

import type { DashSlot } from '../types'
import type { GitSnapshot, Input, Json, SessionSnapshot, Step, Widget } from './contract'
import { GIT_READS, NOT_A_REPO, snapshot } from './gitparse'
import { pack, parseSize, showSize, UNIT_ROWS, unitsFor } from './grid'
import { safeHref } from './href'
import { Board, encode, PALETTE } from './kit'
import { WIDGETS } from './widgets'

const PANE = 'dashboard'
const TITLE = 'Dashboard'
// Dock floor. Below it the engine seats panes inline, above the prompt.
const DOCK_COLUMNS = 110
// A request, not a grant: 72 fits 4 grid units. A hand-dragged width wins.
const WANT_COLUMNS = 72
const TICK_MS = 1000
const WATCH_MS = 250
const GIT_MS = 10_000
// Fallback only, before the pane reports its body height.
const CHROME_ROWS = 6
const GIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'])

// The list needs the height; the context bar does not.
const DEFAULT_LAYOUT: DashSlot[] = [
  { id: 'clock', size: { w: 2, h: 1 } },
  { id: 'todo', size: { w: 2, h: 2 } },
  { id: 'context', size: { w: 2, h: 1 } },
  { id: 'git', size: { w: 4, h: 2 } },
  { id: 'hn', size: { w: 4, h: 2 } },
]

const layoutRef = atom({ plugin: 'dashboard', key: 'layout' } as const, DEFAULT_LAYOUT)
const focusRef = atom({ plugin: 'dashboard', key: 'focus' } as const, '')

// The host's mirror of the layout, for work outside a render.
let slots: DashSlot[] = DEFAULT_LAYOUT
const states = new Map<string, unknown>()
const failures = new Map<string, string>()
const ticked = new Map<string, number>()
let session: SessionSnapshot = { window: 0, turns: 0, history: [] }
let lastGit: GitSnapshot | undefined
let gitTimer: { cancel: () => void } | undefined
let breakdownAt = 0
// Where git runs, for the "not a git repo" line.
let where: string | undefined
let size = { columns: 0, rows: 0 }
let isVisible = false
let placement: 'dock' | 'inline' | undefined
let isHiddenByWidth = false
let viewport = { columns: 0, isFullscreen: false }

const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, Math.floor(n)))
const widgetOf = (id: string) => WIDGETS.find(w => w.id === id)
const active = () => slots.flatMap(s => widgetOf(s.id) ?? [])
// Only tiles with keys take focus: focusing a clock does nothing.
const focusable = () => active().filter(w => (w.keys ?? []).length > 0).map(w => w.id)

// Stored layouts come from an older build or a hand edit: check every field.
const isSlot = (v: unknown): v is DashSlot => {
  if (typeof v !== 'object' || v === null) return false
  const s = v as { id?: unknown; size?: { w?: unknown; h?: unknown } }
  return typeof s.id === 'string' && widgetOf(s.id) !== undefined && parseSize(`${String(s.size?.w)}x${String(s.size?.h)}`) !== undefined
}

// Tiles stretch to fill `rows` exactly, rows shared out evenly per grid unit.
// Below UNIT_ROWS a unit the grid keeps UNIT_ROWS and the pane scrolls.
const geometry = (columns: number, rows: number) => {
  const units = unitsFor(columns)
  const placed = pack(slots, units)
  const unitCols = Math.floor(columns / units)
  const high = Math.max(1, ...placed.map(p => p.y + p.h))
  const unitRows = Math.max(UNIT_ROWS, rows / high)
  const at = (u: number) => Math.round(u * unitRows)

  return {
    rows: Math.max(rows, at(high)),
    tiles: placed.map(p => {
      const x = p.x * unitCols
      // The last column takes the remainder; others leave a 1-cell gutter.
      const w = p.x + p.w === units ? columns - x : p.w * unitCols - 1
      return { id: p.id, x, y: at(p.y), w, h: at(p.y + p.h) - at(p.y) }
    }),
  }
}

type Span = Board['links'][number]

const spansKey = (spans: readonly Span[]) => spans.map(l => `${l.x},${l.y},${l.url},${l.text}`).join('|')
// The spans the last render laid Link elements over.
let drawnSpans = ''

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`

const frame = (columns: number, rows: number, focus: string, now: number): { cells: string; links: Span[] } => {
  const board = new Board(columns, rows)
  // A lit frame says "focus is here, not there". With one focusable tile
  // there is no "there": every frame stays the same.
  const canMove = focusable().length > 1
  for (const t of geometry(columns, rows).tiles) {
    const widget = widgetOf(t.id)
    if (widget === undefined) continue
    board.frame(t.x, t.y, t.w, t.h, widget.title, canMove && t.id === focus)
    const tile = board.tile(t.x, t.y, t.w, t.h, t.id === focus)
    const failure = failures.get(widget.id)
    // Contract guarantee: draw never sees a widget that has not started.
    if (!states.has(widget.id) && failure === undefined) {
      tile.text(0, 0, 'starting...', 'faint')
      continue
    }
    if (failure !== undefined) {
      tile.text(0, 0, 'widget failed', 'del')
      tile.text(0, 1, failure.slice(0, tile.cols * 2), 'dim')
      continue
    }
    try {
      widget.draw(states.get(widget.id), tile, now)
    } catch (error) {
      failures.set(widget.id, error instanceof Error ? error.message : String(error))
    }
  }

  return { cells: encode(board.cells), links: board.links }
}

// Timer, press and fetch callbacks have no caller to throw to. Failures go to
// `claude --debug`.
function report($: EngineInterface, error: unknown) {
  $.ui.log(`dashboard: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
}

async function paint($: EngineInterface) {
  if (!isVisible || size.columns === 0) return
  const focus = await read($, focusRef)
  const { cells, links } = frame(size.columns, size.rows, focus, await $.clock.now())
  await $.ui.blit({ requestId: PANE, key: 'view', columns: size.columns, rows: size.rows, cells })
  // Links are elements over the Raster, not cells: new spans need a render.
  if (spansKey(links) !== drawnSpans) $.ui.invalidate('ui.render')
}

// Applies one step: new state, then its effects, then persistence. A widget
// that throws is parked with its message; the others keep running.
async function apply($: EngineInterface, widget: Widget<unknown>, step: Step<unknown>) {
  states.set(widget.id, step.state)
  for (const effect of step.effects ?? []) {
    if (effect.kind === 'toast') $.ui.toast(effect.text)
    if (effect.kind === 'fetch') {
      // Network failure becomes ok: false; a throw inside feed is reported, never re-fed.
      void $.http
        .fetch(effect.url)
        .then(
          res => ({ ok: res.ok, status: res.status, text: res.text }),
          () => ({ ok: false, status: 0, text: '' }),
        )
        .then(r => feed($, widget, { kind: 'fetched', tag: effect.tag, ...r }))
        .catch(error => report($, error))
    }
  }
  if (widget.persist !== undefined) await $.store.set(`state:${widget.id}`, widget.persist(step.state))
}

async function feed($: EngineInterface, widget: Widget<unknown>, input: Input) {
  if (failures.has(widget.id) || !states.has(widget.id)) return
  let step: Step<unknown>
  try {
    step = widget.update(states.get(widget.id), input)
  } catch (error) {
    failures.set(widget.id, error instanceof Error ? error.message : String(error))
    return
  }
  await apply($, widget, step)
}

async function start($: EngineInterface, widget: Widget<unknown>) {
  failures.delete(widget.id)
  const saved = (await $.store.get(`state:${widget.id}`)) as Json | undefined
  try {
    await apply($, widget, widget.init(saved, await $.clock.now()))
  } catch (error) {
    failures.set(widget.id, error instanceof Error ? error.message : String(error))
    return
  }
  ticked.set(widget.id, await $.clock.now())
  if (widget.needs?.includes('session')) await feed($, widget, { kind: 'session', session })
  if (widget.needs?.includes('git') && lastGit !== undefined) await feed($, widget, { kind: 'git', git: lastGit })
}

async function setLayout($: EngineInterface, next: DashSlot[]) {
  const added = next.filter(s => !slots.some(old => old.id === s.id))
  slots = next
  await update($, layoutRef, () => next)
  await $.store.set('layout', next)
  for (const s of added) {
    const widget = widgetOf(s.id)
    if (widget !== undefined) await start($, widget)
  }
}

async function tick($: EngineInterface) {
  const now = await $.clock.now()
  for (const widget of active()) {
    if (widget.tickMs === undefined) continue
    if (now - (ticked.get(widget.id) ?? 0) < widget.tickMs) continue
    ticked.set(widget.id, now)
    await feed($, widget, { kind: 'tick', now })
  }
  await paint($)
}

// The fixed read list in gitparse.ts is all the git the host ever runs.
async function refreshGit($: EngineInterface) {
  const [status, log, unstaged, staged] = await Promise.all([
    $.process.run(GIT_READS.status),
    $.process.run(GIT_READS.log),
    $.process.run(GIT_READS.unstaged),
    $.process.run(GIT_READS.staged),
  ])
  const found = status.exitCode !== 0 ? NOT_A_REPO : snapshot(status.stdout, log.exitCode === 0 ? log.stdout : '', unstaged.stdout, staged.stdout)
  lastGit = { ...found, cwd: where }
  for (const widget of active()) {
    if (widget.needs?.includes('git')) await feed($, widget, { kind: 'git', git: lastGit })
  }
  await paint($)
}

// Edits land in bursts: one refresh 400ms after the last one.
function scheduleGit($: EngineInterface) {
  gitTimer?.cancel()
  gitTimer = $.clock.after(400, () => void refreshGit($).catch(error => report($, error)))
}

// One mapping from the engine's usage shape to the contract's: for the read at
// start (a resumed session already has context) and every measure after.
async function takeUsage($: EngineInterface, usage: Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>) {
  const now = await $.clock.now()
  session = {
    ...session,
    window: usage.context.window,
    contextTokens: usage.context.tokens ?? session.contextTokens,
    usd: usage.cost?.usd ?? session.usd,
    // Usage windows mean a subscription; a gateway's spend_limit is money.
    plan: usage.rateLimits.some(r => r.kind === 'five_hour' || r.kind === 'seven_day')
      ? 'subscription'
      : usage.context.tokens !== undefined
        ? 'api'
        : session.plan,
  }
  // The compaction point needs a breakdown, which costs a count: once per 15s.
  if (now - breakdownAt > 15_000) {
    breakdownAt = now
    const b = (await $.session.usage({ breakdown: 'summary' })).context.breakdown
    session = { ...session, compactAt: b?.isAutoCompactEnabled === true ? b.autoCompactThreshold : undefined }
  }
  await pushSession($)
}

async function pushSession($: EngineInterface) {
  for (const widget of active()) {
    if (widget.needs?.includes('session')) await feed($, widget, { kind: 'session', session })
  }
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
    await $.ui.open({ id: PANE, title: TITLE, columns: WANT_COLUMNS })
  }
}

async function press($: EngineInterface, action: string) {
  const focus = await read($, focusRef)
  const widget = widgetOf(focus)
  if (widget !== undefined) await feed($, widget, { kind: 'key', action })
  await paint($)
}

async function cycleFocus($: EngineInterface) {
  const ids = focusable()
  const focus = await read($, focusRef)
  await update($, focusRef, () => ids[(ids.indexOf(focus) + 1) % ids.length] ?? '')
}

const HELP = 'Usage: /dash, /dash list, /dash add <widget> [WxH], /dash rm <widget>, /dash size <widget> <WxH>, /dash reset, /dash autostart on|off'

// Off by default: no pane opens by itself unless the person turned this on.
async function autostart($: EngineInterface, value: string): Promise<string> {
  if (value === 'on' || value === 'off') await $.store.set('autostart', value === 'on')
  else if (value !== '') return 'Usage: /dash autostart on|off'
  return (await $.store.get('autostart')) === true
    ? 'The dashboard opens at session start. /dash autostart off undoes it.'
    : 'The dashboard opens on /dash only. /dash autostart on opens it at session start.'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const home = await $.env.get('HOME')
    where = home !== undefined && e.cwd.startsWith(home) ? `~${e.cwd.slice(home.length)}` : e.cwd
    const stored = await $.store.get('layout')
    slots = Array.isArray(stored) && stored.every(isSlot) ? (stored as DashSlot[]) : DEFAULT_LAYOUT
    await update($, layoutRef, () => slots)
    states.clear()
    failures.clear()
    for (const widget of active()) await start($, widget)
    const focus = await read($, focusRef)
    if (!focusable().includes(focus)) await update($, focusRef, () => focusable()[0] ?? '')

    await $.command.register({
      name: 'dash',
      description: 'Open or close the dashboard; /dash add|rm|size|list|reset edits its widgets; /dash autostart on|off',
      argumentHint: '[list|add|rm|size|reset|autostart]',
    })
    $.clock.every(TICK_MS, () => void tick($).catch(error => report($, error)))
    $.clock.every(WATCH_MS, () => void watch($).catch(error => report($, error)))
    $.clock.every(GIT_MS, () => void refreshGit($).catch(error => report($, error)))
    void refreshGit($).catch(error => report($, error))
    void $.session
      .usage()
      .then(usage => takeUsage($, usage))
      .catch(error => report($, error))
    // Opt-in only. Unasked, the engine seats it from 144 columns, 110 once asked for.
    if ((await $.store.get('autostart')) === true) void $.ui.open({ id: PANE, title: TITLE, columns: WANT_COLUMNS })

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await takeUsage($, e)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const tokens = session.contextTokens
    if (tokens !== undefined) {
      const history = [...session.history, tokens].slice(-40)
      const deltas = history.slice(1).map((v, i) => v - (history[i] ?? v)).filter(d => d > 0).slice(-5)
      const tokensPerTurn = deltas.length === 0 ? undefined : Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length)
      session = { ...session, turns: session.turns + 1, history, tokensPerTurn }
    } else {
      session = { ...session, turns: session.turns + 1 }
    }
    await pushSession($)

    return result
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (GIT_TOOLS.has(String(e.tool))) scheduleGit($)

    return result
  })

  // `+ milk` goes to the todo widget and never reaches the model.
  on('prompt.submit', async ($, e, next) => {
    // Single lines only: a pasted diff starts with "+ " too, and belongs to Claude.
    if (e.origin.kind !== 'composer' || e.text.includes('\n')) return next(e)
    const widget = active().find(w => w.prefix !== undefined && e.text.startsWith(`${w.prefix} `))
    if (widget?.prefix === undefined) return next(e)

    await feed($, widget, { kind: 'prompt', text: e.text.slice(widget.prefix.length + 1) })
    await paint($)
    $.ui.toast(`${widget.title}: added`)

    return { drop: `dashboard: handled by ${widget.id}` }
  })

  on('command.run', { command: 'dash' }, async ($, e) => {
    const [verb = '', id = '', arg = ''] = e.args.trim().split(/\s+/)
    const known = WIDGETS.map(w => w.id).join(', ')
    if (verb === 'autostart') return { text: await autostart($, id) }

    if (verb === 'list') {
      const lines = WIDGETS.map(w => {
        const slot = slots.find(s => s.id === w.id)
        return `${w.id.padEnd(8)} ${slot === undefined ? 'off' : showSize(slot.size)}  sizes ${w.sizes.map(showSize).join(' ')}`
      })
      return { text: lines.join('\n') }
    }
    if (verb === 'add' || verb === 'size') {
      const widget = widgetOf(id)
      if (widget === undefined) return { text: `No widget "${id}". Known: ${known}.` }
      const want = arg === '' ? widget.sizes[0] : parseSize(arg)
      if (want === undefined || !widget.sizes.some(s => s.w === want.w && s.h === want.h)) {
        return { text: `${widget.id} draws at ${widget.sizes.map(showSize).join(', ')}.` }
      }
      const exists = slots.some(s => s.id === id)
      if (verb === 'size' && !exists) return { text: `${id} is not on the dashboard. /dash add ${id}` }
      await setLayout($, exists ? slots.map(s => (s.id === id ? { id, size: want } : s)) : [...slots, { id, size: want }])
      return { text: `${id} at ${showSize(want)}.` }
    }
    if (verb === 'rm') {
      if (!slots.some(s => s.id === id)) return { text: `${id} is not on the dashboard.` }
      await setLayout($, slots.filter(s => s.id !== id))
      states.delete(id)
      return { text: `${id} removed.` }
    }
    if (verb === 'reset') {
      await setLayout($, DEFAULT_LAYOUT)
      return { text: 'Dashboard reset.' }
    }
    if (verb !== '') return { text: HELP }

    const isOpen = (await $.ui.panes()).some(one => one.id === PANE)
    if (isOpen) {
      isHiddenByWidth = false
      await $.ui.close({ id: PANE })
      return { text: 'Dashboard closed.' }
    }
    if (!e.presentation.isFullscreen) return { text: 'The dashboard needs the fullscreen layout.' }
    if (e.presentation.columns < DOCK_COLUMNS) {
      return { text: `The dashboard needs ${DOCK_COLUMNS} columns or more. This window has ${e.presentation.columns}.` }
    }
    isHiddenByWidth = false
    await $.ui.open({ id: PANE, title: TITLE, columns: WANT_COLUMNS })

    return { text: 'Dashboard opened.' }
  })

  on('ui.close', ($, e, next) => {
    // Closed by hand: stays closed until /dash.
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
      return <Text dimColor>The dashboard draws in the terminal.</Text>
    }

    const { Box, Button, Link, Raster, Text } = $.ui.resolve(e)
    placement = e.props.placement
    if (e.viewport !== undefined) {
      viewport = { columns: e.viewport.columns, isFullscreen: e.viewport.isFullscreen === true }
    }
    if (e.props.placement === 'inline') {
      return <Text dimColor>The dashboard hides: the window is too narrow for the dock.</Text>
    }

    // Subscribes this render to layout and focus: either change redraws it.
    await read($, layoutRef)
    const focus = await read($, focusRef)
    const columns = clamp(e.props.bodyColumns, 1, 512)
    const focused = widgetOf(focus)
    const hasKeyRow = (focused?.keys ?? []).length > 0 || focusable().length > 1
    // The pane reports its body height; the key row under the grid takes one.
    const body = e.props.scroll.bodyRows > 0 ? e.props.scroll.bodyRows : (e.viewport?.rows ?? 30) - CHROME_ROWS
    const grid = geometry(columns, clamp(body - (hasKeyRow ? 1 : 0), 8, 256))
    const rows = clamp(grid.rows, 8, 256)
    size = { columns, rows }
    const view = frame(columns, rows, focus, await $.clock.now())
    drawnSpans = spansKey(view.links)

    return (
      <Box flexDirection="column" backgroundColor={`#${PALETTE.bg.toString(16).padStart(6, '0')}`}>
        <Box key="grid">
          <Raster key="view" columns={columns} rows={rows} cells={view.cells} />
          {view.links.flatMap(span => {
            const href = safeHref(span.url)
            if (href === undefined) return []
            // Laid exactly over the cells the widget drew, same colours, so
            // the only visible change is the underline on hover.
            return [
              <Box key={`link-${span.x}-${span.y}`} position="absolute" top={span.y} left={span.x}>
                <Link href={href}>
                  <Text color={hex(PALETTE[span.tone])} backgroundColor={hex(PALETTE.surface)} hover={{ underline: true }}>
                    {span.text}
                  </Text>
                </Link>
              </Box>,
            ]
          })}
        </Box>
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {focusable().length > 1 && (
            <Button key="next" hotkey="n" label={`next (${focused?.title ?? 'none'})`} plain onPress={() => void cycleFocus($).catch(error => report($, error))} />
          )}
          {(focused?.keys ?? []).map(k => (
            <Button key={`key-${k.action}`} hotkey={k.hotkey} label={k.label} plain onPress={() => void press($, k.action).catch(error => report($, error))} />
          ))}
        </Box>
      </Box>
    )
  })
}
