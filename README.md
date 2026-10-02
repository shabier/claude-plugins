# claude-plugins

Mods for Claude Code. They live in the side pane.

## Install

```
/plugin marketplace add shabier/claude-plugins
/plugin install dashboard@shabier
/plugin install ambient@shabier
/plugin install arcade@shabier
```

Restart Claude Code. Nothing opens by itself: run the command, or `/<command> autostart on` once.

## Plugins

| Plugin | Command | What |
|---|---|---|
| [dashboard](plugins/dashboard) | `/dash` | bento grid: clock, todo, context forecast, git, Hacker News |
| [ambient](plugins/ambient) | `/ambient` | animated 8-bit wallpapers |
| [arcade](plugins/arcade) | `/arcade` | five small games |

## Needs

- Claude Code 2.1.287 or later. Built on function hooks, which are early access; the API moves between releases.
- The fullscreen layout, the default outside tmux.
- 110 columns or more. Narrower and a pane closes; widen and it comes back.
- A Nerd Font or a Powerline font for the git branch icon. Ghostty ships one; anything else shows a box.

## The side pane

All three share it. Two open at once become tabs. Click a pane or `ctrl+x tab` to give it the keys, `Esc` to hand them back.

## Develop

```
claude --plugin-dir plugins/dashboard
claude plugin validate plugins/dashboard
claude plugin test plugins/dashboard
```

`--plugin-dir` reloads on save. Disable an installed copy first, or both register the command.

New dashboard widgets go through a small pure contract: [writing a widget](plugins/dashboard/README.md#writing-a-widget).

## Credits

Original code throughout. Two borrowed colour palettes (MIT) and a few public-domain algorithms, listed per plugin in `CREDITS.md`.

## Licence

GPL-3.0-or-later, with one extra permission: running it inside Claude Code, which isn't free software, is fine. Terms in [NOTICE](NOTICE), full text in [LICENSE](LICENSE).

Fork it, change it, ship it. Keep it GPL and keep the notice.
