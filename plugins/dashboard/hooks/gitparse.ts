// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

import type { GitCommit, GitFile, GitSnapshot } from './contract'

// Read-only, by construction: the only git the host ever runs. No widget can
// add to this list.
export const GIT_READS = {
  status: ['git', 'status', '--porcelain=v2', '--branch'],
  log: ['git', 'log', '-n', '12', '--format=%h%x1f%an%x1f%at%x1f%s'],
  unstaged: ['git', 'diff', '--numstat'],
  staged: ['git', 'diff', '--cached', '--numstat'],
} as const

export const NOT_A_REPO: GitSnapshot = { isRepo: false, branch: '', ahead: 0, behind: 0, commits: [], files: [] }

type Status = { branch: string; upstream?: string; ahead: number; behind: number; files: GitFile[] }

const kindOf = (xy: string): GitFile['status'] => {
  if (xy.includes('A')) return 'added'
  if (xy.includes('D')) return 'deleted'
  if (xy.includes('R') || xy.includes('C')) return 'renamed'
  return 'modified'
}

// `git status --porcelain=v2 --branch`.
export const parseStatus = (text: string): Status => {
  const out: Status = { branch: '', ahead: 0, behind: 0, files: [] }
  for (const line of text.split('\n')) {
    if (line.startsWith('# branch.head ')) out.branch = line.slice(14)
    else if (line.startsWith('# branch.upstream ')) out.upstream = line.slice(18)
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line)
      out.ahead = Number(m?.[1] ?? 0)
      out.behind = Number(m?.[2] ?? 0)
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const parts = line.split(' ')
      const xy = parts[1] ?? '..'
      // Ordinary entries have 8 fields before the path; renames 9, then "path\torig".
      const path = parts.slice(line.startsWith('1 ') ? 8 : 9).join(' ').split('\t')[0] ?? ''
      out.files.push({ path, status: kindOf(xy), adds: 0, dels: 0, isStaged: xy[0] !== '.' })
    } else if (line.startsWith('? ')) {
      out.files.push({ path: line.slice(2), status: 'untracked', adds: 0, dels: 0, isStaged: false })
    }
  }

  return out
}

// `git diff --numstat`: adds, dels, path. Binary files report "-".
export const parseNumstat = (text: string): Map<string, { adds: number; dels: number }> => {
  const out = new Map<string, { adds: number; dels: number }>()
  for (const line of text.split('\n')) {
    const [adds, dels, ...rest] = line.split('\t')
    if (rest.length === 0) continue
    // Renames print "old => new" or "dir/{old => new}"; key on the new path.
    const path = rest.join('\t').replace(/\{[^}]* => ([^}]*)\}/, '$1').replace(/^.* => /, '')
    const prev = out.get(path) ?? { adds: 0, dels: 0 }
    out.set(path, { adds: prev.adds + (Number(adds) || 0), dels: prev.dels + (Number(dels) || 0) })
  }

  return out
}

export const parseLog = (text: string): GitCommit[] =>
  text
    .split('\n')
    .filter(line => line.includes('\x1f'))
    .map(line => {
      const [hash = '', author = '', at = '0', ...subject] = line.split('\x1f')
      return { hash, author, at: Number(at) * 1000, subject: subject.join('\x1f') }
    })

export const snapshot = (status: string, log: string, unstaged: string, staged: string): GitSnapshot => {
  const s = parseStatus(status)
  const counts = parseNumstat(`${unstaged}\n${staged}`)
  const files = s.files.map(f => ({ ...f, ...(counts.get(f.path) ?? {}) }))

  return { isRepo: true, branch: s.branch, upstream: s.upstream, ahead: s.ahead, behind: s.behind, commits: parseLog(log), files }
}
