// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

import { defineWidget, type Effect, type Json } from '../contract'
import { fit, padStart } from '../format'

type Story = { id: number; title: string; score: number; comments: number }
type Hn = { ids: number[]; stories: Story[]; error?: string }

const API = 'https://hacker-news.firebaseio.com/v0'
const COUNT = 10

const top: Effect = { kind: 'fetch', tag: 'top', url: `${API}/topstories.json` }

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const isStory = (v: unknown): v is { id: number; title: string; score?: number; descendants?: number } =>
  typeof v === 'object' && v !== null && typeof (v as { id?: unknown }).id === 'number' && typeof (v as { title?: unknown }).title === 'string'

const toStory = (s: { id: number; title: string; score?: number; descendants?: number }): Story => ({
  id: s.id,
  title: s.title,
  score: s.score ?? 0,
  comments: s.descendants ?? 0,
})

const thread = (id: number) => `https://news.ycombinator.com/item?id=${id}`

const restore = (saved: Json | undefined): Story[] =>
  Array.isArray(saved) ? saved.flatMap(s => (isStory(s) ? [toStory(s)] : [])) : []

export const hn = defineWidget<Hn>({
  contract: 1,
  id: 'hn',
  title: 'Hacker News',
  sizes: [
    { w: 2, h: 2 },
    { w: 4, h: 2 },
    { w: 2, h: 1 },
  ],
  tickMs: 300_000,
  // Last fetch shows at once on start; the fresh one replaces it.
  init: saved => ({ state: { ids: [], stories: restore(saved) }, effects: [top] }),
  update: (state, input) => {
    if (input.kind === 'tick') return { state, effects: [top] }
    if (input.kind !== 'fetched') return { state }
    if (!input.ok) return { state: { ...state, error: `HN unreachable (${input.status})` } }

    const data = parse(input.text)
    if (input.tag === 'top') {
      const ids = Array.isArray(data) ? data.filter((n): n is number => typeof n === 'number').slice(0, COUNT) : []
      return { state: { ...state, ids, error: undefined }, effects: ids.map(id => ({ kind: 'fetch', tag: `item:${id}`, url: `${API}/item/${id}.json` })) }
    }
    if (!isStory(data)) return { state }
    const story = toStory(data)
    // Keep top-list order; drop stories that fell off the list.
    const byId = new Map([...state.stories, story].map(s => [s.id, s]))
    const stories = state.ids.length === 0 ? [...byId.values()] : state.ids.flatMap(id => byId.get(id) ?? [])

    return { state: { ...state, stories } }
  },
  draw: (state, tile) => {
    if (state.stories.length === 0) {
      tile.text(0, 0, state.error ?? 'fetching...', state.error === undefined ? 'faint' : 'del')
      return
    }
    state.stories.slice(0, tile.rows).forEach((s, i) => {
      const comments = `${s.comments}`
      tile.text(0, i, padStart(`${s.score}`, 4), s.score >= 300 ? 'mod' : 'dim')
      // Everything goes to the thread; the story's own link is one click on from there.
      tile.link(5, i, fit(s.title, tile.cols - 5 - comments.length - 1), thread(s.id), 'fg')
      tile.link(tile.cols - comments.length, i, comments, thread(s.id), 'faint')
    })
  },
  persist: state => state.stories.map(s => ({ id: s.id, title: s.title, score: s.score, descendants: s.comments })),
})
