// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

// Layout order is packing order. Focus is a widget id; '' when none.
export type DashSlot = { id: string; size: { w: 1 | 2 | 3 | 4; h: 1 | 2 | 3 } }

declare module 'claude-code' {
  interface PluginState {
    dashboard: { layout: DashSlot[]; focus: string }
  }
}
