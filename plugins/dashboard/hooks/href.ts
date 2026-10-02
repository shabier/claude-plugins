// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

// Link refuses the whole tree over one bad href. Anything that is not a clean
// https URL stays plain text: no credentials, `@` encoded (Medium paths have
// one), printable ASCII only, spelled the way `new URL` spells it.
export const safeHref = (url: string): string | undefined => {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return undefined
  }
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '') return undefined
  const href = u.href.replace(/@/g, '%40')
  return href.length <= 2048 && /^[\x21-\x7e]+$/.test(href) && new URL(href).href === href ? href : undefined
}
