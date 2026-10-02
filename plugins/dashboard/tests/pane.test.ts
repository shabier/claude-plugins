// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

import { expect, mock, test } from 'claude-code/testing'

// Real session start, mocked world: git answers from fixtures, HN from a
// stub. The pane then carries every glyph the widgets draw through the
// engine's Raster validation, which refuses any cell that is not width 1.

const GIT: Record<string, string> = {
  'git status --porcelain=v2 --branch': [
    '# branch.head main',
    '# branch.ab +1 -0',
    '1 .M N... 100644 100644 100644 aaaa bbbb hooks/register.tsx',
    '1 A. N... 000000 100644 100644 0000 cccc hooks/kit.ts',
    '1 D. N... 100644 000000 000000 dddd 0000 hooks/lofi.ts',
    '? plugins/dashboard/',
  ].join('\n'),
  'git log -n 12 --format=%h%x1f%an%x1f%at%x1f%s': '4f2c1e0\x1fS\x1f1759406400\x1fdrop ambient music',
  'git diff --numstat': '42\t7\thooks/register.tsx\n0\t328\thooks/lofi.ts',
  'git diff --cached --numstat': '210\t0\thooks/kit.ts',
}

const PANE = {
  plugin: 'dashboard',
  surface: 'terminal' as const,
  component: 'Pane' as const,
  requestId: 'dashboard',
  viewport: { columns: 200, rows: 60, isFullscreen: true },
  props: { title: 'Dashboard', isFocused: true, bodyColumns: 72, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 54 }, view: {} },
}

test('a started dashboard draws every widget into a valid Raster, and + adds a todo', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on, { 'state:todo': [{ text: 'fix pane height', isDone: false }, { text: 'shipped', isDone: true }] })
  on('process.run', (_$, e) => ({
    value: { exitCode: 0, stdout: GIT[e.argv.join(' ')] ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  // Three kinds of story: a Medium path with @, plain http, an Ask HN without url.
  // All three must link to their HN thread, never the story itself.
  const HN: Record<string, string> = {
    'https://hacker-news.firebaseio.com/v0/topstories.json': '[1,2,3]',
    'https://hacker-news.firebaseio.com/v0/item/1.json': '{"id":1,"title":"On @ in paths","score":10,"descendants":2,"url":"https://medium.com/@a/b"}',
    'https://hacker-news.firebaseio.com/v0/item/2.json': '{"id":2,"title":"Plain http","score":5,"descendants":1,"url":"http://example.com/"}',
    'https://hacker-news.firebaseio.com/v0/item/3.json': '{"id":3,"title":"Ask HN: links?","score":3,"descendants":9}',
  }
  on('http.fetch', (_$, e) => ({ value: { status: 200, ok: true, headers: {}, text: HN[e.url] ?? '[]' } }))
  on('ui.blit', () => ({ value: {} }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  // The engine's own session start, beneath the plugin.
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  // The engine's own prompt entry, beneath the plugin: echoes what reached it.
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('session.usage', () => ({ deny: 'no usage in tests' }))
  mock.env(on, { HOME: '/Users/t' })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  // Let the HN fetch chain (top list, then each item) finish.
  await clock.advance(0)
  const ui = await $.ui.mount(PANE)
  const view = await ui.find({ type: 'Raster', key: 'view' })
  // Fills the reported body: 54 rows less the key row under the grid.
  expect(view?.props.rows).toBe(53)
  // The git header's branch icon (U+E0A0) made it through Raster validation.
  const bytes = Uint8Array.from(atob(String(view?.props.cells)), c => c.charCodeAt(0))
  const words = new Uint32Array(bytes.buffer)
  const codepoints = words.filter((_, i) => i % 3 === 0)
  expect(codepoints.includes(0xe0a0)).toBe(true)
  // Focus starts on the only tile with keys: the todo's keys show without any `n`.
  expect(await ui.find({ key: 'key-toggle' })).toBeDefined()
  expect(await ui.find({ key: 'next' })).toBeUndefined()

  const hrefs = (await ui.findAll({ type: 'Link' })).map(l => l.props.href)
  expect([...new Set(hrefs)].sort()).toEqual([1, 2, 3].map(id => `https://news.ycombinator.com/item?id=${id}`))

  const dropped = await $.prompt.submit({ text: '+ buy milk', origin: { kind: 'composer' }, wait: false })
  expect(dropped).toEqual({ drop: 'dashboard: handled by todo' })
  // A pasted diff starts with "+ " too; it must reach the model untouched.
  const diff = '+ added line\n- removed line'
  expect(await $.prompt.submit({ text: diff, origin: { kind: 'composer' }, wait: false })).toEqual({ text: diff })
  await ui.unmount()
})
