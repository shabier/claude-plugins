// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

// Pure text helpers widgets share. ASCII out.

export const fit = (s: string, width: number): string => {
  if (width <= 0) return ''
  const chars = [...s]
  if (chars.length <= width) return s
  return width <= 2 ? chars.slice(0, width).join('') : `${chars.slice(0, width - 2).join('')}..`
}

export const padStart = (s: string, width: number): string => ' '.repeat(Math.max(0, width - [...s].length)) + s

// 41234 -> 41.2k, 1250000 -> 1.3M.
export const compact = (n: number): string => {
  const a = Math.abs(n)
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`
  if (a >= 1e3) return `${(n / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`
  return `${Math.round(n)}`
}

export const ago = (at: number, now: number): string => {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}
