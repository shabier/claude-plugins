// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

import { defineWidget, digitsHeight, digitsWidth } from '../contract'

type Clock = { now: number }

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const

const two = (n: number) => String(n).padStart(2, '0')

export const clock = defineWidget<Clock>({
  contract: 1,
  id: 'clock',
  title: 'Time',
  sizes: [
    { w: 2, h: 1 },
    { w: 1, h: 1 },
  ],
  tickMs: 1000,
  init: (_saved, now) => ({ state: { now } }),
  update: (state, input) => (input.kind === 'tick' ? { state: { now: input.now } } : { state }),
  draw: (state, tile) => {
    const d = new Date(state.now)
    // The colon blinks on odd seconds, so a frozen clock is obvious.
    const time = `${two(d.getHours())}${d.getSeconds() % 2 === 0 ? ':' : ' '}${two(d.getMinutes())}`
    const date = `${DAYS[d.getDay()]} ${two(d.getDate())} ${MONTHS[d.getMonth()]}`
    // Big digits when the tile has the room, small ones otherwise.
    const scale = tile.rows >= digitsHeight(2) + 1 && tile.cols >= digitsWidth(time, 2) ? 2 : 1
    // Each glyph carries a blank dot column on its right; the last one would
    // push the time left of centre. At scale 2 that column is a whole cell.
    const wide = digitsWidth(time, scale) - (scale === 2 ? 1 : 0)
    const tall = digitsHeight(scale)
    const line = `${date}  ${two(d.getSeconds())}s`
    // Digits, a blank row, the date: centred as one block, both ways.
    const hasDate = tile.rows > tall
    const gap = hasDate && tile.rows >= tall + 3 ? 1 : 0
    const top = Math.max(0, Math.floor((tile.rows - (tall + (hasDate ? gap + 1 : 0))) / 2))
    tile.digits(Math.max(0, Math.floor((tile.cols - wide) / 2)), top, time, 'accent', scale)
    if (hasDate) {
      const x = Math.max(0, Math.floor((tile.cols - line.length) / 2))
      tile.text(x, top + tall + gap, date, 'dim')
      tile.text(x + date.length + 2, top + tall + gap, `${two(d.getSeconds())}s`, 'faint')
    }
  },
})
