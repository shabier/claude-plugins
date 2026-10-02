// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

import { defineWidget, type GitFile, type GitSnapshot, type Tile, type Tone } from '../contract'
import { ago, fit, padStart } from '../format'

type Git = { git: GitSnapshot | null }

// Powerline branch symbol, in every Nerd Font and Powerline font; Ghostty
// ships it built in. A font without it shows a box.
const BRANCH = '\ue0a0'

// sem's semantic marks: added, modified, deleted.
const MARK: Record<GitFile['status'], { glyph: string; tone: Tone }> = {
  added: { glyph: '⊕', tone: 'add' },
  modified: { glyph: '∆', tone: 'mod' },
  deleted: { glyph: '⊖', tone: 'del' },
  renamed: { glyph: '→', tone: 'info' },
  untracked: { glyph: '?', tone: 'faint' },
}

const header = (tile: Tile, git: GitSnapshot) => {
  let x = 0
  const put = (s: string, tone: Tone) => {
    tile.text(x, 0, s, tone)
    x += [...s].length + 2
  }
  put(`${BRANCH} ${git.branch === '(detached)' ? 'detached' : fit(git.branch, Math.max(8, tile.cols - 26))}`, 'info')
  if (git.ahead > 0) put(`↑${git.ahead}`, 'accent')
  if (git.behind > 0) put(`↓${git.behind}`, 'mod')
  const adds = git.files.reduce((n, f) => n + f.adds, 0)
  const dels = git.files.reduce((n, f) => n + f.dels, 0)
  if (git.files.length === 0) {
    put('clean', 'faint')
    return
  }
  put(`${git.files.length} changed`, 'dim')
  if (adds > 0) put(`+${adds}`, 'add')
  if (dels > 0) put(`-${dels}`, 'del')
}

const commits = (tile: Tile, git: GitSnapshot, x: number, y: number, width: number, rows: number, now: number) => {
  git.commits.slice(0, rows).forEach((c, i) => {
    const age = ago(c.at, now)
    tile.text(x, y + i, '●', i === 0 ? 'accent' : 'faint')
    tile.text(x + 2, y + i, c.hash.slice(0, 7), 'faint')
    tile.text(x + 10, y + i, fit(c.subject, width - 10 - age.length - 1), i === 0 ? 'fg' : 'dim')
    tile.text(x + width - age.length, y + i, age, 'faint')
  })
}

const files = (tile: Tile, git: GitSnapshot, x: number, y: number, width: number, rows: number) => {
  const shown = [...git.files].sort((a, b) => b.adds + b.dels - (a.adds + a.dels)).slice(0, rows)
  const most = Math.max(1, ...shown.map(f => f.adds + f.dels))
  const bar = Math.max(4, Math.min(10, Math.floor(width / 4)))
  shown.forEach((f, i) => {
    const mark = MARK[f.status]
    const counts = `${f.adds > 0 ? `+${f.adds}` : ''}${f.dels > 0 ? ` -${f.dels}` : ''}`.trim()
    // Untracked folders end in a slash: name them by their last segment.
    const name = f.path.replace(/\/$/, '').split('/').pop() || f.path
    const nameWidth = width - 2 - bar - 1 - 9
    tile.text(x, y + i, mark.glyph, mark.tone)
    tile.text(x + 2, y + i, fit(name, nameWidth), f.isStaged ? 'fg' : 'dim')
    const total = f.adds + f.dels
    const scale = total / most
    if (total > 0) {
      tile.meter(x + 2 + nameWidth + 1, y + i, bar, [
        { share: (f.adds / total) * scale, tone: 'add' },
        { share: (f.dels / total) * scale, tone: 'del' },
      ])
    }
    tile.text(x + width - 8, y + i, padStart(counts, 8), 'dim')
  })
  if (git.files.length > rows) tile.text(x + 2, y + rows, `+${git.files.length - rows} more`, 'faint')
}

export const git = defineWidget<Git>({
  contract: 1,
  id: 'git',
  title: 'Git',
  sizes: [
    { w: 2, h: 2 },
    { w: 4, h: 2 },
    { w: 2, h: 1 },
  ],
  needs: ['git'],
  init: () => ({ state: { git: null } }),
  update: (state, input) => (input.kind === 'git' ? { state: { git: input.git } } : { state }),
  draw: (state, tile, now) => {
    const g = state.git
    if (g === null) {
      tile.text(0, 0, 'reading git...', 'faint')
      return
    }
    if (!g.isRepo) {
      tile.text(0, 0, fit(`${g.cwd ?? 'this folder'} is not a git repo`, tile.cols), 'faint')
      return
    }
    header(tile, g)
    const body = tile.rows - 2
    if (body <= 0) return

    // Wide tiles: commits left, files right. Narrow: stacked.
    if (tile.cols >= 70) {
      const left = Math.floor((tile.cols - 2) * 0.58)
      commits(tile, g, 0, 2, left, body, now)
      files(tile, g, left + 2, 2, tile.cols - left - 2, body - 1)
      return
    }
    const commitRows = Math.min(g.commits.length, g.files.length === 0 ? body : Math.ceil(body / 2) - 1)
    commits(tile, g, 0, 2, tile.cols, commitRows, now)
    files(tile, g, 0, 2 + commitRows + 1, tile.cols, body - commitRows - 2)
  },
})
