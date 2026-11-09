/*
 *    This file is part of Remote-Touchpad (Velarium fork).
 *
 *    Remote-Touchpad is free software: you can redistribute it and/or modify
 *    it under the terms of the GNU General Public License as published by
 *    the Free Software Foundation, either version 3 of the License, or
 *    (at your option) any later version.
 */

// The Velarium launcher as seen from the phone: its menus (apps), launching, Home / close app, status, power.
// All of it goes through the websocket to the Go server, which forwards a small fixed set of operations to the
// launcher's control socket. `available` is false when this app runs without Velarium.

export default class Velarium {
    #socket;
    available = false;
    home = "Main";
    menus = {};
    loaded = false;

    constructor(socket) {
        this.#socket = socket;
    }

    configure(config) {
        this.available = Boolean(config.velarium);
    }

    async #call(payload) {
        const reply = await this.#socket.request(payload);
        if (!reply.ok) {
            throw new Error(reply.error || "The TV box refused that");
        }
        return reply;
    }

    async loadMenus() {
        const reply = await this.#call({op: "menus"});
        this.home = reply.home || "Main";
        this.menus = reply.menus || {};
        this.loaded = true;
        return this.menus;
    }

    entries(menu) {
        return (this.menus[menu] || []).filter((entry) => entry.kind !== "back");
    }

    // Every launchable entry in every menu, with the path to reach it (for search).
    allEntries() {
        const found = [];
        const seen = new Set();
        const walk = (menu, trail) => {
            if (seen.has(menu)) {
                return;
            }
            seen.add(menu);
            for (const entry of this.entries(menu)) {
                if (entry.kind === "menu") {
                    walk(entry.target, [...trail, entry.title]);
                } else {
                    found.push({entry, menu, trail});
                }
            }
        };
        walk(this.home, []);
        return found;
    }

    launch(menu, index) {
        return this.#call({op: "launch", menu, index});
    }

    goHome() {
        return this.#call({op: "home"});
    }

    status() {
        return this.#call({op: "status"});
    }

    power(mode) {
        return this.#call({op: "power", mode});
    }
}
