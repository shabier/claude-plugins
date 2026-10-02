# ambient

Animated 8-bit wallpapers for the side pane. `/ambient` opens it.

| Key | Scene | Moves |
|---|---|---|
| 1 | koi pond | koi, ripples, drifting petals, caustics |
| 2 | mountains at dusk | 4 parallax ridges, pines, clouds, the odd flock |
| 3 | metropolis | office lights, beacons, a train every 18s, river reflection |
| 4 | neon district | rain, hover traffic, flickering signs, wet street |

Keys work after a click on the pane or `ctrl+x tab`.

## Commands

| Command | Does |
|---|---|
| `/ambient` | open or close |
| `/ambient <scene>` | switch: `koi`, `mountains`, `metropolis`, `cyberpunk` |
| `/ambient autostart on\|off` | open at session start. Off by default |

The last scene sticks across restarts.

## Cost

12 fps while the pane is on screen. Nothing while it's hidden or behind another tab. About 28 KB a frame at 44x40 cells.

No music. A generated lofi loop got as far as `$.audio.play`; on macOS nothing played, and Linux and Windows terminals have no player. Cut.

Credits: [CREDITS.md](CREDITS.md).
