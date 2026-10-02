// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

// Scene id on screen.
export type AmbientScene = string

declare module 'claude-code' {
  interface PluginState {
    ambient: { scene: AmbientScene }
  }
}
