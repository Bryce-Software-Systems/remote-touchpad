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

import jsSHA from "./sha256.mjs"

const challengeResponse = (message, secret) => {
    const shaObj = new jsSHA("SHA-256", "TEXT");
    shaObj.setHMACKey(message, "TEXT");
    shaObj.update(secret);
    return btoa(shaObj.getHMAC("BYTES"));
};

const REQUEST_TIMEOUT = 8000; // milliseconds

export default class Socket extends EventTarget {
    #secret;
    #authenticated;
    #configured = false;
    #ws;
    #nextRequestId = 1;
    #pending = new Map();

    constructor(url, secret) {
        super();
        this.#secret = secret;
        this.#authenticated = false;
        this.#ws = new WebSocket(url);
        this.#ws.addEventListener("message", this.#handle_ws_message.bind(this));
        this.#ws.addEventListener("close", this.#handle_ws_close.bind(this));
    }

    #handle_ws_message(event) {
        if (!this.#authenticated) {
            this.#ws.send(challengeResponse(event.data, this.#secret));
            this.#authenticated = true;
            return;
        }
        let message;
        try {
            message = JSON.parse(event.data);
        } catch (e) {
            this.#ws.close();
            throw (e);
        }
        if (!this.#configured) {
            this.#configured = true;
            this.dispatchEvent(new CustomEvent("config", {detail: message}));
            return;
        }
        // Everything after the config is the answer to a request() (see velarium.mjs).
        const pending = this.#pending.get(message.id);
        if (pending) {
            this.#pending.delete(message.id);
            clearTimeout(pending.timer);
            pending.resolve(message);
        }
    }

    #handle_ws_close() {
        for (const [, pending] of this.#pending) {
            clearTimeout(pending.timer);
            pending.reject(new Error("Disconnected"));
        }
        this.#pending.clear();
        this.dispatchEvent(new CustomEvent("close"));
    }

    send(message) {
        this.#ws.send(message);
    }

    // Sends a Velarium request ("v" + JSON) and resolves with the launcher's reply.
    request(payload) {
        return new Promise((resolve, reject) => {
            const id = this.#nextRequestId++;
            const timer = setTimeout(() => {
                this.#pending.delete(id);
                reject(new Error("The TV box did not answer in time"));
            }, REQUEST_TIMEOUT);
            this.#pending.set(id, {resolve, reject, timer});
            try {
                this.#ws.send("v" + JSON.stringify({...payload, id}));
            } catch (e) {
                this.#pending.delete(id);
                clearTimeout(timer);
                reject(e);
            }
        });
    }
}
