// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

// Cartridge id of the shown game. null = menu.
export type ArcadePick = string | null

declare module 'claude-code' {
  interface PluginState {
    arcade: { pick: ArcadePick }
  }
}
