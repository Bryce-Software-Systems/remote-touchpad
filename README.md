# Remote Touchpad (Velarium fork)

Control a TV box from your phone: touchpad, keyboard, remote control keys, and (on a Velarium box) the launcher
itself. Open the displayed URL or scan the QR code.

This is a fork of [Unrud/remote-touchpad](https://github.com/Unrud/remote-touchpad) with a rebuilt web UI and a
Velarium integration. Standalone (without Velarium) it is still a touchpad/keyboard remote for X11, Wayland (portal),
uinput and Windows; the Apps tab simply disappears.

## The phone UI

| Screen | What it does |
|---|---|
| **Apps** | Velarium's own menus on your phone (real icons): tap an app to launch it, folders open like on the TV, and a banner offers **Close app** while something is open. The search box is a **universal search**: apps match instantly; Cinema, Live TV channels and programmes, finished recordings and YouTube follow a moment later. Tapping a result opens it on the TV. |
| **Remote** | A **Now Playing** card when something is playing (title, seek bar, previous / -10 s / play-pause / +10 s / next, audio and subtitle pickers, Stop), then a D-pad with a big OK, Back, Home and media keys. Arrows repeat while held. |
| **Touchpad** | Drag to move, tap to click, two fingers to scroll, left/right click buttons. A desktop mouse works too (pointer lock). |
| **Keyboard** | Type on the phone, **Send** to the TV (or **Type live** to send each letter as you type), plus Enter / Backspace / arrows / Home / End. |
| **More** | **Cast a link** (web pages open in the browser, YouTube links in YouTube), **Recordings** (the DVR: play, stop, delete, and schedule from the guide) and **Set up** (Wi-Fi and Cinema sign-in typed on the phone). |

The top bar always shows **Home** (return to the Velarium home screen, closing whatever app is in front) and **Power**
(sleep, restart, shut down; restart and shut down ask for a second tap). A one-line **Now Playing** bar sits above the tab
bar on every screen except Remote. The tab bar is always visible, so there is never a dead end. If the connection drops
(the box restarts, Wi-Fi blips, the phone is locked) a "Reconnecting…" screen appears and the app reconnects by itself, as
soon as the page is visible or the network is back; there is no button to press.

The **Set up** screen sends passwords over the same plain HTTP connection as everything else here, so it shows a warning:
use it on a network you trust.

## How it talks to Velarium

The server (`velarium.go`) connects to the launcher's control socket, `$XDG_RUNTIME_DIR/velarium/control.sock` (or
`-velarium-socket PATH`; an empty path turns the integration off). The socket is user-only, so only this user's
processes can reach it, and the phone must pass the websocket authentication first. The phone can only ask for the
operations below, with exactly these fields (each type- and size-checked in Go, see `velariumOps`); everything else is
dropped before it reaches the launcher:

| op | fields | meaning |
|---|---|---|
| `ping`, `status` | | is a launcher there / current menu, whether an app runs, and what is playing |
| `menus` | | the launcher's menus; icons come back as small inline PNGs |
| `launch` | `menu`, `index` | open a menu entry (PIN prompts and licence lock still apply, on the TV) |
| `home` | | close the running app and show the home screen |
| `power` | `mode`: `sleep`/`restart`/`shutdown` | power action |
| `nowplaying`, `player` | `app`, `action`, `value` | what is playing / transport control (toggle, play, pause, seek, seekto, next, prev, stop, audio, subtitle) |
| `search` | `q` | one query over apps, Cinema, Live TV, recordings, YouTube |
| `open` | `kind` (cinema, channel, programme, recording, youtube), `ref`, `at` | open a search result on the TV |
| `cast` | `url` | open a link on the TV |
| `dvr`, `dvr_cancel`, `dvr_delete`, `dvr_channels`, `dvr_programs`, `dvr_schedule` | ids, `q`, `streamId`, `startTs` | the DVR |
| `setup_status`, `wifi_list`, `wifi_connect` | `ssid`, `password` | first-run setup |

Slow operations (Wi-Fi, sign-in, search) are given longer than a menu fetch. On the websocket these are
`v{"id":N,"op":...}` messages; the answer is `{"id":N,...}`. The launcher side is `htpc/control_server.py` and
`htpc/phone_ops.py` in the Velarium repository.

## Develop the web UI without a Velarium box

```sh
python3 dev/fake_velarium.py /tmp/velarium.sock /path/to/velarium
go run -tags null . -bind 127.0.0.1:8099 -secret test -velarium-socket /tmp/velarium.sock
# open http://127.0.0.1:8099/#test in a phone-sized browser window
go test -tags null ./...
NODE_PATH=$(npm root -g) node dev/e2e.js   # drives the UI in headless Chromium (needs Playwright)
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
