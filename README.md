<div align="center">

# Poxel UserScript

**A single-file browser userscript for poxel.io - wall ESP, aim assist, damage/headshot/weapon packet spoofing, and quality-of-life extras, all controlled from an in-page menu.**

[![Tampermonkey](https://img.shields.io/badge/tampermonkey-compatible-00485B?style=flat-square)](https://www.tampermonkey.net/)
[![Violentmonkey](https://img.shields.io/badge/violentmonkey-compatible-6C4EB6?style=flat-square)](https://violentmonkey.github.io/)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

</div>

---

## Overview

`poxel.user.js` is a Tampermonkey/Violentmonkey userscript for [poxel.io](https://poxel.io/), a Unity/WebGL browser shooter. It runs at `document-start` and hooks the game's WebGL context, WebSocket connection, and a handful of `window` globals before the game's own code initializes. Everything is driven from a single `cfg` object and a draggable in-page menu (`Insert` to open) - no build step, no dependencies.

## Features

| Feature | Description |
|---|---|
| **Wall ESP** | Patches player shaders at runtime so players render through walls up to a configurable depth threshold |
| **Aim Assist** | Reads a small box of pixels around the crosshair and nudges the mouse toward the ESP highlight color |
| **Damage Multiplier** | Rewrites the `amount` field of outgoing hit packets before they're sent |
| **Headshot Spoof** | Rewrites the `hitName` field of outgoing hit packets |
| **Weapon Spoof** | Rewrites the `gunID` field of outgoing hit packets, with a session-only discovered-ID list pulled from the game's own kill-tracking log |
| **Spacebar Spam** | Rapid Space keydown/keyup while pointer-locked (in-game) |
| **FPS Boost** | Disables antialiasing and requests a high-performance GPU on WebGL context creation |
| **Anti-AFK** | Periodically resets the game's inactivity timer while in a match |
| **Instant Reward** | Bypasses the rewarded-ad-video flow so rewards grant immediately |
| **Ad Blocker** | Hides the static banner ad containers |
| **Custom Crosshair** | Overlay marker (dot / line / X / ring) independent of the in-game crosshair |

All toggles live in the in-page menu (`Insert`) and take effect immediately - no page reload needed. `Alt+E` toggles ESP directly.

## Installation

1. Install a userscript manager: [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Open [`poxel.user.js`](poxel.user.js) in this repo and click **Raw**.
3. Your userscript manager should prompt to install it automatically. If not, copy the file's contents into a new script in the manager's dashboard.
4. Visit [poxel.io](https://poxel.io/) and press `Insert` to open the menu.

## Menu

```
+-------------------------------------------------+
|  ESP           Wall ESP                         |
|  AIM ASSIST    Aim Assist                        |
|  DAMAGE        Damage Multiplier / Headshot /    |
|                Weapon Spoof / Weapon ID          |
|  EXTRAS        Spacebar Spam / FPS Boost /       |
|                Anti-AFK                          |
|  CROSSHAIR     Custom Crosshair + style picker   |
|  REWARDS       Instant Reward / Ad Blocker       |
+-------------------------------------------------+
Insert - toggle menu    Alt+E - toggle ESP
```

## Notes on the packet-spoofing features

The damage multiplier, headshot spoof, and weapon spoof all work by locating a msgpack field key inside the outgoing WebSocket hit packet and splicing in a new integer value, sized to the smallest fitting msgpack int type. The packet layout and the `hitName`/`gunID` values used as defaults were confirmed from live capture, not guessed - see the comments in `patchHitName`/`patchWeapon` in the source for the exact values observed.

## Disclaimer

This script modifies game client behavior and outgoing network traffic for poxel.io. Using it almost certainly violates poxel.io's Terms of Service and may result in a ban. It is provided for personal/educational use only, as-is, with no warranty. This project is not affiliated with or endorsed by poxel.io.

## Get the Code

Clone with git:

```bash
git clone https://github.com/drew-codes-things/PoxelUserScript.git
```

Or with the [GitHub CLI](https://cli.github.com/):

```bash
gh repo clone drew-codes-things/PoxelUserScript
```

## License

MIT - made by [Drew](https://github.com/drew-codes-things)
