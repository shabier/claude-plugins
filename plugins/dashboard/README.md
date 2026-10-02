# dashboard

A bento grid in the side pane: clock, todo, context forecast, git, Hacker News. `/dash` opens it.

## Commands

| Command | Does |
|---|---|
| `/dash` | open or close |
| `/dash list` | every widget, its size, the sizes it takes |
| `/dash add <widget> [WxH]` | add one, default size unless given |
| `/dash rm <widget>` | remove one; its data stays |
| `/dash size <widget> <WxH>` | resize |
| `/dash reset` | back to the default layout |
| `/dash autostart on\|off` | open at session start. Off by default |

## Keys

Click the pane or `ctrl+x tab` to give it the keys, `Esc` to hand them back.

The todo tile owns them: `j` `k` move, `x` done, `d` delete. Its last row says so too. `n` moves focus once a second tile has keys.

`+ buy milk` in the prompt adds a todo and never reaches Claude. Single lines only, so a pasted diff still does.

## Widgets

| Widget | Sizes | Shows |
|---|---|---|
| `clock` | 2x1, 1x1 | time in dot-matrix, date, seconds |
| `todo` | 2x2, 2x1, 4x1 | the list |
| `context` | 2x1, 2x2 | share of the compaction point, tokens left, turns left at the current pace. Cost on API keys; hidden on subscriptions, where it means nothing |
| `git` | 2x2, 4x2, 2x1 | branch, ahead/behind, recent commits, changed files with +/- bars |
| `hn` | 2x2, 4x2, 2x1 | top 10 stories, every 5 min. Click a title for the thread |

Layout order is packing order. Tiles stretch to fill the pane.

Git is read-only by construction: the host runs 4 fixed read commands and nothing else, after every edit Claude makes and every 10s. The tile follows the folder Claude runs in.

## Writing a widget

1. `hooks/widgets/<id>.ts`, built with `defineWidget` from `hooks/contract.ts`.
2. Add it to `hooks/widgets/index.ts`.
3. `claude plugin test plugins/dashboard`.

Widgets are pure: `init`, `update`, `draw`, `persist`. No `$`, no timers. The host owns every effect (ticks, session numbers, git, fetches, storage) and hands the data in. Colours are tones, never hex: `fg dim faint accent add mod del info link`. Links go through `tile.link`, https only.

The suite runs every registered widget through 19 inputs at every size: no throws, under 50ms a draw, nothing outside its tile, state through a JSON round trip. A widget that throws at runtime gets an error tile; the rest carry on.

`contract: 1`. Additions only. A break would be v2, and the host refuses versions it doesn't know.

## Limits

- Height-only window resizes don't refit; Claude Code redraws on width. Toggle `/dash`.
- A fresh session shows context after its first response.
- Turns left needs 2 answered turns to have a pace.

Credits: [CREDITS.md](CREDITS.md).
