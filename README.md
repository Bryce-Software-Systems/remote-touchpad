# Remote Touchpad (Velarium fork)

Control a TV box from your phone: touchpad, keyboard, remote control keys, and (on a Velarium box) the launcher
itself. Open the displayed URL or scan the QR code.

This is a fork of [Unrud/remote-touchpad](https://github.com/Unrud/remote-touchpad) with a rebuilt web UI and a
Velarium integration. Standalone (without Velarium) it is still a touchpad/keyboard remote for X11, Wayland (portal),
uinput and Windows; the Apps tab simply disappears.

## The phone UI

| Screen | What it does |
|---|---|
| **Apps** | Velarium's own menus on your phone: tap an app to launch it, folders open like on the TV, search finds any app, a banner appears while an app is open on the TV with a **Close app** button. |
| **Remote** | D-pad with a big OK, **Back**, **Home**, media and volume keys. Arrows and volume repeat while held. |
| **Touchpad** | Drag to move, tap to click, two fingers to scroll, left/right click buttons. A desktop mouse works too (pointer lock). |
| **Keyboard** | Type on the phone, **Send** to the TV (or **Type live** to send each letter as you type), plus Enter / Backspace / arrows / Home / End. |

The top bar always shows **Home** (return to the Velarium home screen, closing whatever app is in front) and **Power**
(sleep, restart, shut down; restart and shut down ask for a second tap). The bottom tab bar is always visible, so there
is never a dead end.

## How it talks to Velarium

The server (`velarium.go`) connects to the launcher's control socket, `$XDG_RUNTIME_DIR/velarium/control.sock` (or
`-velarium-socket PATH`; an empty path turns the integration off). The socket is user-only, so only this user's
processes can reach it, and the phone must pass the websocket authentication first. The phone can only ask for these
operations, with these fields; everything else is dropped before it reaches the launcher:

| op | fields | meaning |
|---|---|---|
| `ping` | | is a launcher there? (decides whether the Apps tab is shown) |
| `menus` | | the launcher's menus; icons come back as small inline PNGs |
| `launch` | `menu`, `index` | open a menu entry (PIN prompts and licence lock still apply, on the TV) |
| `home` | | close the running app and show the home screen |
| `status` | | current menu and whether an app is running |
| `power` | `mode`: `sleep`/`restart`/`shutdown` | power action |

On the websocket these are `v{"id":N,"op":...}` messages; the answer is `{"id":N,...}`. The launcher side is
`htpc/control_server.py` in the Velarium repository.

## Develop the web UI without a Velarium box

```sh
python3 dev/fake_velarium.py /tmp/velarium.sock /path/to/velarium
go run -tags null . -bind 127.0.0.1:8099 -secret test -velarium-socket /tmp/velarium.sock
# open http://127.0.0.1:8099/#test in a phone-sized browser window
go test -tags null ./...
```

## Getting it onto a Velarium box

Velarium does **not** download this app at run time. It ships the prebuilt binaries inside its own repository
(`assets/launchers/remote_touchpad/remote-touchpad` for x86_64 and `remote-touchpad-linux-arm64` for aarch64) and its
normal update (the App Store / daily self-update) delivers them to devices. To publish a change:

1. Merge your change here and tag it: `git tag v1.6.1 && git push origin v1.6.1`. The **Release** workflow builds both
   binaries (portal + uinput + x11) and attaches them, with `SHA256SUMS`, to the GitHub release.
2. In the Velarium repository run `scripts/update_remote_touchpad.sh v1.6.1`. It downloads the release, verifies the
   checksums and replaces the two binaries.
3. Commit and merge that in Velarium. Devices pick it up with their next Velarium update.

## Installation (standalone)

* Golang (Portal, uinput and X11 controllers): `go install -tags portal,uinput,x11 github.com/Bryce-Software-Systems/remote-touchpad@latest`
* Upstream packages (without the Velarium features): [Flatpak](https://flathub.org/apps/details/com.github.unrud.RemoteTouchpad), [Snap](https://snapcraft.io/remote-touchpad), [Windows](https://github.com/Unrud/remote-touchpad/releases/latest)
