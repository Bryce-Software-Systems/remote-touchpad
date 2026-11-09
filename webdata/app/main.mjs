/*
 *    Copyright (c) 2018-2019, 2023 Unrud <unrud@outlook.com>
 *
 *    This file is part of Remote-Touchpad.
 *
 *    Remote-Touchpad is free software: you can redistribute it and/or modify
 *    it under the terms of the GNU General Public License as published by
 *    the Free Software Foundation, either version 3 of the License, or
 *    (at your option) any later version.
 *
 *    Remote-Touchpad is distributed in the hope that it will be useful,
 *    but WITHOUT ANY WARRANTY; without even the implied warranty of
 *    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *    GNU General Public License for more details.
 *
 *    You should have received a copy of the GNU General Public License
 *    along with Remote-Touchpad.  If not, see <http://www.gnu.org/licenses/>.
 */

import InputController, * as inputcontrollerModule from "./inputcontroller.mjs";
import Socket from "./socket.mjs";
import UI from "./ui.mjs";
import Velarium from "./velarium.mjs";

const url = new URL("ws", location.href);
url.protocol = url.protocol == "http:" ? "ws:" : "wss:";

// The secret travels in the address: "/#SECRET" (what the server prints) or "/?secret=SECRET" (what the Velarium
// launcher builds for its QR code when Remote Touchpad is already running).
const secret = window.location.hash.substr(1) || new URLSearchParams(window.location.search).get("secret") || "";
const socket = new Socket(url, secret);
const inputController = new InputController(socket);
const velarium = new Velarium(socket);
const ui = new UI(inputController, velarium);

socket.addEventListener("config", (event) => {
    const config = event.detail;
    inputController.configure(config);
    ui.configure(config);
});

socket.addEventListener("close", (event) => {
    ui.close(Boolean(event.detail?.rejected));
});

window.app = {
    key: inputController.keyboardKey.bind(inputController),
    text: inputController.keyboardText.bind(inputController),
    toggleFullscreen: ui.toggleFullscreen.bind(ui),
};
for (const name in inputcontrollerModule) {
    if (name.startsWith("KEY_")) {
        window.app[name] = inputcontrollerModule[name];
    }
}
