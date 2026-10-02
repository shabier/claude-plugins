// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Shabier. Claude Code exception: see NOTICE.

import { CONTRACT, type Widget } from '../contract'
import { clock } from './clock'
import { context } from './context'
import { git } from './git'
import { hn } from './hn'
import { todo } from './todo'

// The registry. A widget built against another contract version is refused.
export const WIDGETS: readonly Widget<unknown>[] = [clock, context, git, todo, hn].filter(w => w.contract === CONTRACT)
