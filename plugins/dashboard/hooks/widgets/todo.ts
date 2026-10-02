// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

import { defineWidget, type Json } from '../contract'
import { fit } from '../format'

type Item = { text: string; isDone: boolean }
type Todo = { items: Item[]; cursor: number }

const restore = (saved: Json | undefined): Item[] => {
  if (!Array.isArray(saved)) return []
  return saved.flatMap(one =>
    typeof one === 'object' && one !== null && !Array.isArray(one) && typeof one.text === 'string'
      ? [{ text: one.text, isDone: one.isDone === true }]
      : [],
  )
}

const clampCursor = (items: readonly Item[], cursor: number) => Math.max(0, Math.min(items.length - 1, cursor))

export const todo = defineWidget<Todo>({
  contract: 1,
  id: 'todo',
  title: 'Todo',
  sizes: [
    { w: 2, h: 2 },
    { w: 2, h: 1 },
    { w: 4, h: 1 },
  ],
  prefix: '+',
  keys: [
    { hotkey: 'j', label: 'down', action: 'down' },
    { hotkey: 'k', label: 'up', action: 'up' },
    { hotkey: 'x', label: 'done', action: 'toggle' },
    { hotkey: 'd', label: 'delete', action: 'delete' },
  ],
  init: saved => ({ state: { items: restore(saved), cursor: 0 } }),
  update: (state, input) => {
    if (input.kind === 'prompt') {
      const text = input.text.trim()
      if (text === '') return { state }
      const items = [...state.items, { text, isDone: false }]
      return { state: { items, cursor: items.length - 1 } }
    }
    if (input.kind !== 'key' || state.items.length === 0) return { state }

    const { items, cursor } = state
    switch (input.action) {
      case 'down':
        return { state: { items, cursor: clampCursor(items, cursor + 1) } }
      case 'up':
        return { state: { items, cursor: clampCursor(items, cursor - 1) } }
      case 'toggle':
        return { state: { items: items.map((it, i) => (i === cursor ? { ...it, isDone: !it.isDone } : it)), cursor } }
      case 'delete': {
        const next = items.filter((_, i) => i !== cursor)
        return { state: { items: next, cursor: clampCursor(next, cursor) } }
      }
      default:
        return { state }
    }
  },
  draw: (state, tile) => {
    if (state.items.length === 0) {
      tile.text(0, 0, 'type "+ something" in the prompt', 'faint')
      return
    }
    // The last row says how to work the list: the focus model is not obvious.
    const long = 'click pane, then x done  j k move  d delete'
    const hint = !tile.isFocused ? 'n: focus this list' : long.length <= tile.cols ? long : 'x done  j k move  d delete'
    tile.text(0, tile.rows - 1, fit(hint, tile.cols), 'faint')
    const rows = tile.rows - 1
    // Keep the cursor in view on long lists.
    const first = Math.max(0, Math.min(state.cursor - rows + 1, state.items.length - rows))
    state.items.slice(first, first + rows).forEach((it, i) => {
      const at = first + i
      const isCursor = at === state.cursor
      tile.text(0, i, isCursor ? '›' : ' ', 'accent')
      tile.text(2, i, it.isDone ? '●' : '○', it.isDone ? 'add' : 'dim')
      tile.text(4, i, fit(it.text, tile.cols - 4), it.isDone ? 'faint' : isCursor ? 'accent' : 'fg')
    })
  },
  persist: state => state.items.map(it => ({ text: it.text, isDone: it.isDone })),
})
