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

const DEFAULT_REQUEST_TIMEOUT = 8000; // milliseconds
const RETRY_DELAYS = [400, 800, 1500, 3000, 5000]; // then every 5 seconds

// A websocket to the Remote Touchpad server that reconnects by itself: when the connection drops (the box restarted,
// Wi-Fi blipped, the phone was locked) it keeps trying -- immediately when the page becomes visible again or the
// network returns -- and tells the UI via "close" (connection lost) and "config" (connected again).
export default class Socket extends EventTarget {
    #url;
    #secret;
    #ws = null;
    #authenticated = false;
    #rejected = 0;            // connections in a row that were closed right after we answered the challenge
    #configured = false;
    #attempt = 0;
    #retryTimer = null;
    #nextRequestId = 1;
    #pending = new Map();

    constructor(url, secret) {
        super();
        this.#url = url;
        this.#secret = secret;
        window.addEventListener("online", () => this.#retryNow());
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") {
                this.#retryNow();
            }
        });
        this.#connect();
    }

    get connected() {
        return this.#configured && this.#ws?.readyState === WebSocket.OPEN;
    }

    #connect() {
        if (this.#ws && this.#ws.readyState <= WebSocket.OPEN) {
            return;
        }
        this.#authenticated = false;
        this.#configured = false;
        let ws;
        try {
            ws = new WebSocket(this.#url);
        } catch (e) {
            this.#scheduleRetry();
            return;
        }
        this.#ws = ws;
        ws.addEventListener("message", (event) => this.#handleMessage(ws, event));
        ws.addEventListener("close", () => this.#handleClose(ws));
        ws.addEventListener("error", () => {}); // always followed by "close"
    }

    #scheduleRetry() {
        clearTimeout(this.#retryTimer);
        const delay = RETRY_DELAYS[Math.min(this.#attempt, RETRY_DELAYS.length - 1)];
        this.#attempt += 1;
        this.#retryTimer = setTimeout(() => this.#connect(), delay);
    }

    #retryNow() {
        if (!this.#ws || this.#ws.readyState > WebSocket.OPEN) {
            clearTimeout(this.#retryTimer);
            this.#connect();
        }
    }

    #handleMessage(ws, event) {
        if (ws !== this.#ws) {
            return;
        }
        if (!this.#authenticated) {
            ws.send(challengeResponse(event.data, this.#secret));
            this.#authenticated = true;
            return;
        }
        let message;
        try {
            message = JSON.parse(event.data);
        } catch (e) {
            ws.close();
            throw (e);
        }
        if (!this.#configured) {
            this.#configured = true;
            this.#attempt = 0;
            this.#rejected = 0;
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

    #handleClose(ws) {
        if (ws !== this.#ws) {
            return;
        }
        this.#ws = null;
        this.#rejected = this.#authenticated && !this.#configured ? this.#rejected + 1 : this.#rejected;
        this.#configured = false;
        for (const [, pending] of this.#pending) {
            clearTimeout(pending.timer);
            pending.reject(new Error("Disconnected"));
        }
        this.#pending.clear();
        this.dispatchEvent(new CustomEvent("close", {detail: {rejected: this.#rejected >= 2}}));
        this.#scheduleRetry();
    }

    // Input events are dropped while disconnected (the UI shows the reconnecting screen); they are never queued, so a
    // stale key press cannot fire minutes later.
    send(message) {
        if (this.connected) {
            this.#ws.send(message);
        }
    }

    // Sends a Velarium request ("v" + JSON) and resolves with the launcher's reply.
    request(payload, timeout = DEFAULT_REQUEST_TIMEOUT) {
        return new Promise((resolve, reject) => {
            if (!this.connected) {
                reject(new Error("Not connected"));
                return;
            }
            const id = this.#nextRequestId++;
            const timer = setTimeout(() => {
                this.#pending.delete(id);
                reject(new Error("The TV box did not answer in time"));
            }, timeout);
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
